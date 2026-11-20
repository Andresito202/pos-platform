ALTER TABLE identity.session_refresh_tokens
 ADD COLUMN client_id text,
 ADD COLUMN credential_id uuid REFERENCES identity.device_credentials(credential_id),
 ADD COLUMN installation_id uuid,
 ADD COLUMN device_id uuid REFERENCES identity.device_registry(device_id),
 ADD COLUMN tenant_id uuid REFERENCES tenancy.tenants(id),
 ADD COLUMN issuer_origin text,
 ADD COLUMN audience text,
 ADD COLUMN family_expires_at timestamptz,
 ADD COLUMN password_credential_id uuid REFERENCES identity.user_credentials(id),
 ADD COLUMN password_credential_version bigint,
 ADD CONSTRAINT commercial_refresh_binding_complete CHECK (
  num_nonnulls(client_id,credential_id,installation_id,device_id,tenant_id,issuer_origin,audience,family_expires_at,password_credential_id,password_credential_version) IN (0,10)),
 ADD CONSTRAINT commercial_refresh_family_expiry CHECK (family_expires_at IS NULL OR expires_at<=family_expires_at),
 ADD CONSTRAINT commercial_refresh_client CHECK (client_id IS NULL OR length(client_id) BETWEEN 1 AND 128),
 ADD CONSTRAINT commercial_refresh_audience CHECK (audience IS NULL OR length(audience) BETWEEN 1 AND 128);

CREATE UNIQUE INDEX commercial_refresh_family_root_uq ON identity.session_refresh_tokens(token_family_id)
 WHERE parent_token_id IS NULL AND client_id IS NOT NULL;
CREATE FUNCTION identity.guard_commercial_refresh_binding() RETURNS trigger
 LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE parent identity.session_refresh_tokens%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (NEW.client_id IS NOT NULL OR OLD.client_id IS NOT NULL) AND ROW(NEW.session_id,NEW.token_family_id,NEW.parent_token_id,NEW.token_hash,NEW.issued_at,NEW.expires_at,NEW.client_id,NEW.credential_id,NEW.installation_id,NEW.device_id,NEW.tenant_id,NEW.issuer_origin,NEW.audience,NEW.family_expires_at,NEW.password_credential_id,NEW.password_credential_version)
   IS DISTINCT FROM ROW(OLD.session_id,OLD.token_family_id,OLD.parent_token_id,OLD.token_hash,OLD.issued_at,OLD.expires_at,OLD.client_id,OLD.credential_id,OLD.installation_id,OLD.device_id,OLD.tenant_id,OLD.issuer_origin,OLD.audience,OLD.family_expires_at,OLD.password_credential_id,OLD.password_credential_version)
   THEN RAISE EXCEPTION 'Commercial refresh binding is immutable'; END IF;
  IF OLD.client_id IS NOT NULL AND (
   (OLD.consumed_at IS NOT NULL AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at) OR
   (OLD.replacement_token_id IS NOT NULL AND NEW.replacement_token_id IS DISTINCT FROM OLD.replacement_token_id) OR
   (OLD.revoked_at IS NOT NULL AND ROW(NEW.revoked_at,NEW.revocation_reason) IS DISTINCT FROM ROW(OLD.revoked_at,OLD.revocation_reason)) OR
   (OLD.reuse_detected_at IS NOT NULL AND NEW.reuse_detected_at IS DISTINCT FROM OLD.reuse_detected_at)) THEN
   RAISE EXCEPTION 'Commercial refresh consumption and revocation are irreversible';
  END IF;
 ELSIF NEW.parent_token_id IS NOT NULL THEN
  SELECT * INTO parent FROM identity.session_refresh_tokens WHERE id=NEW.parent_token_id;
  IF parent.client_id IS NOT NULL OR NEW.client_id IS NOT NULL THEN
   IF parent.id IS NULL OR ROW(NEW.session_id,NEW.token_family_id,NEW.client_id,NEW.credential_id,NEW.installation_id,NEW.device_id,NEW.tenant_id,NEW.issuer_origin,NEW.audience,NEW.family_expires_at,NEW.password_credential_id,NEW.password_credential_version)
    IS DISTINCT FROM ROW(parent.session_id,parent.token_family_id,parent.client_id,parent.credential_id,parent.installation_id,parent.device_id,parent.tenant_id,parent.issuer_origin,parent.audience,parent.family_expires_at,parent.password_credential_id,parent.password_credential_version)
    THEN RAISE EXCEPTION 'Commercial refresh child binding differs'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END; $fn$;
CREATE TRIGGER commercial_refresh_binding_guard BEFORE INSERT OR UPDATE ON identity.session_refresh_tokens
 FOR EACH ROW EXECUTE FUNCTION identity.guard_commercial_refresh_binding();
REVOKE ALL ON FUNCTION identity.guard_commercial_refresh_binding() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.guard_commercial_refresh_binding() TO pos_platform_app;
