-- Canonical Identity persistence for the already verified native binding/PKCE
-- contract. No credentials, clients, users or grants are seeded.
CREATE TABLE identity.native_authorization_codes (
  code_hash text PRIMARY KEY CHECK(code_hash ~ '^[a-f0-9]{64}$'),
  client_id text NOT NULL CHECK(client_id ~ '^[A-Za-z0-9._~-]{1,128}$'),
  redirect_uri text NOT NULL,
  code_challenge text NOT NULL CHECK(code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  state text NOT NULL CHECK(state ~ '^[A-Za-z0-9_-]{32,256}$'),
  trusted_binding_id uuid NOT NULL REFERENCES identity.device_credentials(credential_id),
  session_id uuid NOT NULL REFERENCES identity.sessions(id),
  device_id uuid NOT NULL REFERENCES identity.device_registry(device_id),
  tenant_id uuid NOT NULL REFERENCES tenancy.tenants(id),
  issued_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,consumed_at timestamptz,
  CHECK(expires_at>issued_at),CHECK(consumed_at IS NULL OR consumed_at>=issued_at)
);
CREATE TABLE identity.native_authorization_requests (
  id uuid PRIMARY KEY CHECK(platform.is_uuid_v7(id)),
  challenge_hash text NOT NULL UNIQUE CHECK(challenge_hash ~ '^[a-f0-9]{64}$'),
  client_id text NOT NULL CHECK(client_id ~ '^[A-Za-z0-9._~-]{1,128}$'),redirect_uri text NOT NULL,
  code_challenge text NOT NULL CHECK(code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  state text NOT NULL CHECK(state ~ '^[A-Za-z0-9_-]{32,256}$'),
  created_at timestamptz NOT NULL,challenge_expires_at timestamptz NOT NULL,challenge_consumed_at timestamptz,
  request_hash text UNIQUE CHECK(request_hash ~ '^[a-f0-9]{64}$'),expires_at timestamptz,consumed_at timestamptz,
  credential_id uuid REFERENCES identity.device_credentials(credential_id),
  device_id uuid REFERENCES identity.device_registry(device_id),installation_id uuid,
  tenant_id uuid REFERENCES tenancy.tenants(id),company_id uuid REFERENCES organization.companies(id),
  session_id uuid REFERENCES identity.sessions(id),
  CHECK(challenge_expires_at>created_at),
  CHECK((challenge_consumed_at IS NULL AND request_hash IS NULL AND credential_id IS NULL AND device_id IS NULL AND installation_id IS NULL AND tenant_id IS NULL AND company_id IS NULL AND expires_at IS NULL)
    OR(challenge_consumed_at IS NOT NULL AND request_hash IS NOT NULL AND credential_id IS NOT NULL AND device_id IS NOT NULL AND installation_id IS NOT NULL AND tenant_id IS NOT NULL AND company_id IS NOT NULL AND expires_at>created_at)),
  CHECK(consumed_at IS NULL OR session_id IS NOT NULL),
  CHECK(consumed_at IS NULL OR consumed_at>=created_at)
);
CREATE INDEX native_authorization_requests_client_budget ON identity.native_authorization_requests(client_id,created_at DESC);
CREATE FUNCTION identity.guard_native_authorization_history() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $body$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Native authorization history cannot be deleted'; END IF;
  IF TG_TABLE_NAME='native_authorization_codes' THEN
    IF (to_jsonb(NEW)-'consumed_at') IS DISTINCT FROM (to_jsonb(OLD)-'consumed_at') OR
      OLD.consumed_at IS NOT NULL AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at THEN
      RAISE EXCEPTION 'Native code binding/consumption is immutable';
    END IF;
  ELSE
    IF (to_jsonb(NEW)-ARRAY['request_hash','credential_id','device_id','installation_id','tenant_id','company_id','challenge_consumed_at','expires_at','consumed_at','session_id']) IS DISTINCT FROM
       (to_jsonb(OLD)-ARRAY['request_hash','credential_id','device_id','installation_id','tenant_id','company_id','challenge_consumed_at','expires_at','consumed_at','session_id']) OR
       OLD.request_hash IS NOT NULL AND (to_jsonb(NEW)-ARRAY['consumed_at','session_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['consumed_at','session_id']) OR
       OLD.consumed_at IS NOT NULL AND (NEW.consumed_at IS DISTINCT FROM OLD.consumed_at OR NEW.session_id IS DISTINCT FROM OLD.session_id) THEN
      RAISE EXCEPTION 'Native request binding/consumption is immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$body$;
CREATE TRIGGER native_code_history BEFORE UPDATE OR DELETE ON identity.native_authorization_codes FOR EACH ROW EXECUTE FUNCTION identity.guard_native_authorization_history();
CREATE TRIGGER native_request_history BEFORE UPDATE OR DELETE ON identity.native_authorization_requests FOR EACH ROW EXECUTE FUNCTION identity.guard_native_authorization_history();
ALTER TABLE identity.native_authorization_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.native_authorization_codes FORCE ROW LEVEL SECURITY;
ALTER TABLE identity.native_authorization_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.native_authorization_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY native_codes_central ON identity.native_authorization_codes TO pos_platform_app,pos_schema_owner USING(true) WITH CHECK(true);
CREATE POLICY native_requests_central ON identity.native_authorization_requests TO pos_platform_app,pos_schema_owner USING(true) WITH CHECK(true);
REVOKE ALL ON identity.native_authorization_codes,identity.native_authorization_requests FROM PUBLIC,pos_app,pos_worker,pos_platform_admin;
REVOKE ALL ON FUNCTION identity.guard_native_authorization_history() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.guard_native_authorization_history() TO pos_platform_app;
GRANT SELECT,INSERT ON identity.native_authorization_codes,identity.native_authorization_requests TO pos_platform_app;
GRANT UPDATE(consumed_at) ON identity.native_authorization_codes TO pos_platform_app;
GRANT UPDATE(request_hash,credential_id,device_id,installation_id,tenant_id,company_id,challenge_consumed_at,expires_at,consumed_at,session_id)
  ON identity.native_authorization_requests TO pos_platform_app;
