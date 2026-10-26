DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM identity.session_refresh_tokens WHERE client_id IS NOT NULL) THEN
  RAISE EXCEPTION 'Cannot discard bound refresh family history';
 END IF;
END; $guard$;
DROP TRIGGER commercial_refresh_binding_guard ON identity.session_refresh_tokens;
DROP FUNCTION identity.guard_commercial_refresh_binding();
DROP INDEX identity.commercial_refresh_family_root_uq;
ALTER TABLE identity.session_refresh_tokens
 DROP CONSTRAINT commercial_refresh_binding_complete,
 DROP CONSTRAINT commercial_refresh_family_expiry,
 DROP CONSTRAINT commercial_refresh_client,
 DROP CONSTRAINT commercial_refresh_audience,
 DROP COLUMN client_id,DROP COLUMN credential_id,DROP COLUMN installation_id,DROP COLUMN device_id,
 DROP COLUMN tenant_id,DROP COLUMN issuer_origin,DROP COLUMN audience,DROP COLUMN family_expires_at,
 DROP COLUMN password_credential_id,DROP COLUMN password_credential_version;
