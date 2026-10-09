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
  created_by_actor_id uuid NULL,
  revoked_at timestamptz NULL,
  revoked_by_actor_type text NULL,
  revoked_by_actor_id uuid NULL,
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
  ),
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
  FOR ALL TO pos_platform_app
  USING (true) WITH CHECK (true);

REVOKE ALL ON "authorization".platform_role_assignments FROM PUBLIC, pos_app, pos_worker;
GRANT SELECT, INSERT, UPDATE ON "authorization".platform_role_assignments TO pos_platform_app;
GRANT SELECT ON "authorization".platform_role_assignments TO pos_platform_admin;
