-- D3-R5.2c: one-to-one public WebAuthn credential material for the existing
-- identity.mfa_factors canonical factor. Not a second factor, account or session.
-- COSE keys are PUBLIC, but credential IDs are sensitive identifiers: restricted RLS.
CREATE TABLE identity.webauthn_credential_material (
  id uuid PRIMARY KEY CONSTRAINT webauthn_credential_material_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  factor_id uuid NOT NULL UNIQUE REFERENCES identity.mfa_factors(id) ON DELETE NO ACTION,
  credential_id text NOT NULL UNIQUE CONSTRAINT webauthn_credential_id_ck
    CHECK (credential_id ~ '^[A-Za-z0-9_-]{22,1366}$'),
  public_key_cose_base64url text NOT NULL CONSTRAINT webauthn_public_key_ck
    CHECK (public_key_cose_base64url ~ '^[A-Za-z0-9_-]{43,2731}$'),
  counter bigint NOT NULL DEFAULT 0 CONSTRAINT webauthn_counter_ck
    CHECK (counter BETWEEN 0 AND 4294967295),
  backup_eligible boolean NOT NULL DEFAULT false,
  backed_up boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_used_at timestamptz NULL,
  version bigint NOT NULL DEFAULT 1 CONSTRAINT webauthn_credential_material_version_ck CHECK (version >= 1),
  CONSTRAINT webauthn_backup_state_ck CHECK (NOT backed_up OR backup_eligible),
  CONSTRAINT webauthn_last_use_ck CHECK (last_used_at IS NULL OR last_used_at >= created_at)
);

-- The material is immutable except for one compare-and-swap counter/backup update.
-- Counterless credentials may legitimately continue reporting zero, but version
-- always increases to make concurrent authentications non-interchangeable.
CREATE FUNCTION identity.webauthn_credential_material_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $function$
BEGIN
  IF NEW.version <> OLD.version + 1 OR NEW.counter < OLD.counter
     OR (OLD.counter > 0 AND NEW.counter <= OLD.counter)
     OR NEW.last_used_at IS NULL OR NEW.last_used_at < OLD.created_at
     OR (OLD.last_used_at IS NOT NULL AND NEW.last_used_at < OLD.last_used_at)
     OR NEW.backup_eligible IS DISTINCT FROM OLD.backup_eligible
     OR ROW(NEW.id, NEW.factor_id, NEW.credential_id, NEW.public_key_cose_base64url,
            NEW.created_at) IS DISTINCT FROM
        ROW(OLD.id, OLD.factor_id, OLD.credential_id, OLD.public_key_cose_base64url,
            OLD.created_at)
  THEN
    RAISE EXCEPTION 'WebAuthn credential material permits only monotonic CAS update';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER webauthn_credential_material_guard
BEFORE UPDATE ON identity.webauthn_credential_material
FOR EACH ROW EXECUTE FUNCTION identity.webauthn_credential_material_guard();

REVOKE ALL ON FUNCTION identity.webauthn_credential_material_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.webauthn_credential_material_guard() TO pos_platform_app;

ALTER TABLE identity.webauthn_credential_material ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.webauthn_credential_material FORCE ROW LEVEL SECURITY;

CREATE POLICY webauthn_material_platform_only ON identity.webauthn_credential_material
  FOR ALL TO pos_platform_app USING (true) WITH CHECK (true);
CREATE POLICY webauthn_material_owner_inspect ON identity.webauthn_credential_material
  FOR SELECT TO pos_schema_owner USING (true);

REVOKE ALL ON identity.webauthn_credential_material FROM PUBLIC, pos_app, pos_worker, pos_platform_admin;
GRANT SELECT ON identity.webauthn_credential_material TO pos_platform_app;
GRANT INSERT (id, factor_id, credential_id, public_key_cose_base64url,
              counter, backup_eligible, backed_up, created_at, version)
  ON identity.webauthn_credential_material TO pos_platform_app;
GRANT UPDATE (counter, backed_up, last_used_at, version)
  ON identity.webauthn_credential_material TO pos_platform_app;
