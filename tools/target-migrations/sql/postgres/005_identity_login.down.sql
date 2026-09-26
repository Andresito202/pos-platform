-- Reversión de 005. Falla, a propósito, si ya hay datos que 001 no admitiría
-- (usuarios sin correo, sesiones o eventos con equipo): revertir en silencio
-- perdería datos o dejaría filas que violan 001.
REVOKE UPDATE (must_change_at_next_login, last_failed_at) ON identity.user_credentials FROM pos_platform_app;

DROP TABLE IF EXISTS identity.mfa_recovery_codes;

ALTER TABLE identity.security_events
  DROP CONSTRAINT IF EXISTS security_events_device_fk,
  ADD CONSTRAINT security_events_device_deferred_ck CHECK (device_id IS NULL);
ALTER TABLE identity.sessions
  DROP CONSTRAINT IF EXISTS sessions_device_fk,
  ADD CONSTRAINT sessions_device_deferred_ck CHECK (device_id IS NULL);

ALTER TABLE identity.user_credentials
  DROP CONSTRAINT IF EXISTS user_credentials_failure_time_ck,
  DROP COLUMN IF EXISTS last_failed_at,
  DROP COLUMN IF EXISTS must_change_at_next_login;

DROP TABLE IF EXISTS identity.user_login_names;

ALTER TABLE identity.users
  DROP CONSTRAINT IF EXISTS users_email_pair_ck,
  ALTER COLUMN email SET NOT NULL,
  ALTER COLUMN email_normalized SET NOT NULL;
