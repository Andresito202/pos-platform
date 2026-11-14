-- Global platform authority is assigned explicitly. This migration creates no
-- administrator, grants no role to the first user, and stores no credentials.
CREATE UNIQUE INDEX authorization_roles_id_scope_uq
  ON "authorization".roles(id, scope_type);

CREATE TABLE "authorization".platform_role_assignments (
  id uuid PRIMARY KEY CONSTRAINT platform_role_assignments_id_v7_ck
    CHECK (platform.is_uuid_v7(id)),
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE NO ACTION,
  role_id uuid NOT NULL,
  role_scope_type text NOT NULL DEFAULT 'PLATFORM'
    CONSTRAINT platform_role_assignments_scope_ck CHECK (role_scope_type = 'PLATFORM'),
  status text NOT NULL
    CONSTRAINT platform_role_assignments_status_ck CHECK (status IN ('ACTIVE','REVOKED')),
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NULL,
  created_at timestamptz NOT NULL,
  created_by_actor_type text NOT NULL
    CONSTRAINT platform_role_assignments_creator_type_ck
    CHECK (created_by_actor_type IN ('PLATFORM_ACCOUNT','SYSTEM')),
  created_by_actor_id uuid NULL REFERENCES identity.users(id) ON DELETE NO ACTION,
  revoked_at timestamptz NULL,
  revoked_by_actor_type text NULL,
  revoked_by_actor_id uuid NULL REFERENCES identity.users(id) ON DELETE NO ACTION,
  revocation_reason text NULL,
  version bigint NOT NULL DEFAULT 1
    CONSTRAINT platform_role_assignments_version_ck CHECK (version >= 1),
  CONSTRAINT platform_role_assignments_role_scope_fk
    FOREIGN KEY (role_id, role_scope_type)
    REFERENCES "authorization".roles(id, scope_type) ON DELETE NO ACTION,
  CONSTRAINT platform_role_assignments_creator_ck CHECK (
    (created_by_actor_type = 'SYSTEM' AND created_by_actor_id IS NULL)
    OR (created_by_actor_type = 'PLATFORM_ACCOUNT' AND created_by_actor_id IS NOT NULL)
  ),
  CONSTRAINT platform_role_assignments_revocation_ck CHECK (
    (status = 'ACTIVE' AND revoked_at IS NULL AND revoked_by_actor_type IS NULL
      AND revoked_by_actor_id IS NULL AND revocation_reason IS NULL)
    OR (status = 'REVOKED' AND revoked_at IS NOT NULL
      AND revoked_by_actor_type IN ('PLATFORM_ACCOUNT','SYSTEM')
      AND btrim(revocation_reason) <> ''
      AND ((revoked_by_actor_type = 'SYSTEM' AND revoked_by_actor_id IS NULL)
        OR (revoked_by_actor_type = 'PLATFORM_ACCOUNT' AND revoked_by_actor_id IS NOT NULL))
  )),
  CONSTRAINT platform_role_assignments_range_ck
    CHECK (valid_until IS NULL OR valid_until > valid_from),
  CONSTRAINT platform_role_assignments_user_role_start_uq UNIQUE (user_id, role_id, valid_from)
);

CREATE UNIQUE INDEX platform_role_assignments_active_uq
  ON "authorization".platform_role_assignments(user_id, role_id)
  WHERE status = 'ACTIVE';

CREATE INDEX platform_role_assignments_user_status_idx
  ON "authorization".platform_role_assignments(user_id, status, valid_from, valid_until);

ALTER TABLE "authorization".platform_role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE "authorization".platform_role_assignments FORCE ROW LEVEL SECURITY;

CREATE POLICY platform_role_assignments_platform_only
  ON "authorization".platform_role_assignments
  FOR ALL TO pos_platform_app, pos_platform_admin
  USING (true) WITH CHECK (true);

REVOKE ALL ON "authorization".platform_role_assignments FROM PUBLIC, pos_app, pos_worker;
GRANT SELECT, INSERT, UPDATE ON "authorization".platform_role_assignments TO pos_platform_app;
GRANT SELECT ON "authorization".platform_role_assignments TO pos_platform_admin;


CREATE FUNCTION "authorization".audit_platform_role_assignment_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
DECLARE
  event_actor_type text;
  event_actor_id uuid;
  event_action text;
  event_payload jsonb;
  previous_payload jsonb;
  event_id uuid;
  event_correlation_id uuid;
BEGIN
  BEGIN
    event_id := current_setting('app.audit_id', true)::uuid;
    event_correlation_id := current_setting('app.correlation_id', true)::uuid;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'platform role assignment audit context is invalid';
  END;
  IF event_id IS NULL OR NOT platform.is_uuid_v7(event_id)
     OR event_correlation_id IS NULL OR NOT platform.is_uuid_v7(event_correlation_id) THEN
    RAISE EXCEPTION 'platform role assignment requires UUIDv7 audit and correlation context';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status <> 'ACTIVE' OR NEW.status <> 'REVOKED'
       OR NEW.id IS DISTINCT FROM OLD.id
       OR NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.role_id IS DISTINCT FROM OLD.role_id
       OR NEW.role_scope_type IS DISTINCT FROM OLD.role_scope_type
       OR NEW.valid_from IS DISTINCT FROM OLD.valid_from
       OR NEW.valid_until IS DISTINCT FROM OLD.valid_until
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.created_by_actor_type IS DISTINCT FROM OLD.created_by_actor_type
       OR NEW.created_by_actor_id IS DISTINCT FROM OLD.created_by_actor_id
       OR NEW.version <> OLD.version + 1 THEN
      RAISE EXCEPTION 'platform role assignments are immutable except for one-way revocation';
    END IF;
    IF current_user = 'pos_platform_app' THEN
      IF NEW.revoked_by_actor_type <> 'PLATFORM_ACCOUNT'
         OR NEW.revoked_by_actor_id::text IS DISTINCT FROM current_setting('app.actor_id', true) THEN
        RAISE EXCEPTION 'platform assignment revocation requires the authenticated platform actor';
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM "authorization".platform_role_assignments a
        JOIN identity.users actor_user ON actor_user.id = a.user_id AND actor_user.status = 'ACTIVE'
        JOIN "authorization".roles r ON r.id = a.role_id AND r.scope_type = 'PLATFORM' AND r.status = 'ACTIVE'
        JOIN "authorization".role_permission_grants g ON g.role_id = r.id AND g.status = 'ACTIVE'
          AND g.valid_from <= pg_catalog.clock_timestamp()
          AND (g.valid_until IS NULL OR g.valid_until > pg_catalog.clock_timestamp())
        JOIN "authorization".permissions p ON p.id = g.permission_id AND p.status = 'ACTIVE'
        WHERE a.user_id = NEW.revoked_by_actor_id
          AND a.status = 'ACTIVE'
          AND a.valid_from <= pg_catalog.clock_timestamp()
          AND (a.valid_until IS NULL OR a.valid_until > pg_catalog.clock_timestamp())
          AND p.code = 'PLATFORM_ROLE_ASSIGNMENT_MANAGE'
      ) THEN
        RAISE EXCEPTION 'platform actor lacks PLATFORM_ROLE_ASSIGNMENT_MANAGE';
      END IF;
    END IF;
    event_actor_type := NEW.revoked_by_actor_type;
    event_actor_id := NEW.revoked_by_actor_id;
    event_action := 'PLATFORM_ROLE_ASSIGNMENT_REVOKED';
    previous_payload := pg_catalog.jsonb_build_object(
      'id', OLD.id, 'userId', OLD.user_id, 'roleId', OLD.role_id,
      'status', OLD.status, 'validFrom', OLD.valid_from, 'validUntil', OLD.valid_until
    );
    event_payload := pg_catalog.jsonb_build_object(
      'id', NEW.id, 'userId', NEW.user_id, 'roleId', NEW.role_id,
      'status', NEW.status, 'validFrom', NEW.valid_from, 'validUntil', NEW.valid_until,
      'revokedAt', NEW.revoked_at, 'reason', NEW.revocation_reason, 'version', NEW.version
    );
  ELSE
    IF NEW.status <> 'ACTIVE' OR NEW.version <> 1 THEN
      RAISE EXCEPTION 'platform role assignment must begin ACTIVE at version 1';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM identity.users u WHERE u.id = NEW.user_id AND u.status = 'ACTIVE'
    ) THEN
      RAISE EXCEPTION 'platform role assignment requires an ACTIVE identity user';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "authorization".roles r
      WHERE r.id = NEW.role_id AND r.scope_type = 'PLATFORM' AND r.status = 'ACTIVE'
    ) THEN
      RAISE EXCEPTION 'platform role assignment requires an ACTIVE PLATFORM role';
    END IF;
    IF current_user = 'pos_platform_app' THEN
      IF NEW.created_by_actor_type <> 'PLATFORM_ACCOUNT'
         OR NEW.created_by_actor_id::text IS DISTINCT FROM current_setting('app.actor_id', true)
         OR NEW.user_id::text = current_setting('app.actor_id', true) THEN
        RAISE EXCEPTION 'platform assignment requires a distinct authenticated platform actor';
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM "authorization".platform_role_assignments a
        JOIN identity.users actor_user ON actor_user.id = a.user_id AND actor_user.status = 'ACTIVE'
        JOIN "authorization".roles r ON r.id = a.role_id AND r.scope_type = 'PLATFORM' AND r.status = 'ACTIVE'
        JOIN "authorization".role_permission_grants g ON g.role_id = r.id AND g.status = 'ACTIVE'
          AND g.valid_from <= pg_catalog.clock_timestamp()
          AND (g.valid_until IS NULL OR g.valid_until > pg_catalog.clock_timestamp())
        JOIN "authorization".permissions p ON p.id = g.permission_id AND p.status = 'ACTIVE'
        WHERE a.user_id = NEW.created_by_actor_id
          AND a.status = 'ACTIVE'
          AND a.valid_from <= pg_catalog.clock_timestamp()
          AND (a.valid_until IS NULL OR a.valid_until > pg_catalog.clock_timestamp())
          AND p.code = 'PLATFORM_ROLE_ASSIGNMENT_MANAGE'
      ) THEN
        RAISE EXCEPTION 'platform actor lacks PLATFORM_ROLE_ASSIGNMENT_MANAGE';
      END IF;
    END IF;
    event_actor_type := NEW.created_by_actor_type;
    event_actor_id := NEW.created_by_actor_id;
    event_action := 'PLATFORM_ROLE_ASSIGNMENT_CREATED';
    previous_payload := NULL;
    event_payload := pg_catalog.jsonb_build_object(
      'id', NEW.id, 'userId', NEW.user_id, 'roleId', NEW.role_id,
      'status', NEW.status, 'validFrom', NEW.valid_from, 'validUntil', NEW.valid_until,
      'createdAt', NEW.created_at, 'createdByActorType', NEW.created_by_actor_type,
      'createdByActorId', NEW.created_by_actor_id, 'version', NEW.version
    );
  END IF;

  INSERT INTO audit.audit_events (
    id, tenant_id, company_id, branch_id, actor_type, actor_id, session_id, device_id,
    action_code, resource_type, resource_reference_kind, resource_id, operation_id,
    correlation_id, schema_version, reported_at, server_recorded_at, result, reason_code,
    previous_value, new_value, payload_checksum
  ) VALUES (
    event_id, NULL, NULL, NULL, event_actor_type, event_actor_id, NULL, NULL,
    event_action, 'PlatformRoleAssignment', 'INSTANCE', NEW.id, NULL,
    event_correlation_id, 1, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp(),
    'SUCCESS', CASE WHEN TG_OP = 'UPDATE' THEN 'EXPLICIT_REVOCATION' ELSE NULL END,
    previous_payload, event_payload,
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(event_payload::text, 'UTF8')), 'hex')
  );

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION "authorization".audit_platform_role_assignment_change() FROM PUBLIC, pos_app, pos_worker, pos_platform_admin;
GRANT EXECUTE ON FUNCTION "authorization".audit_platform_role_assignment_change() TO pos_platform_app;

CREATE TRIGGER platform_role_assignment_audit_guard
BEFORE INSERT OR UPDATE ON "authorization".platform_role_assignments
FOR EACH ROW EXECUTE FUNCTION "authorization".audit_platform_role_assignment_change();
