-- 005 — Identidad para el inicio de sesión de SEC-G02 (DEC-026 §13.3–§13.4).
-- Sólo añade o reemplaza restricciones con otras nuevas; no reescribe 001.

-- G-1: un cajero puede no tener correo (A-7). El par sigue siendo coherente.
ALTER TABLE identity.users
  ALTER COLUMN email DROP NOT NULL,
  ALTER COLUMN email_normalized DROP NOT NULL,
  ADD CONSTRAINT users_email_pair_ck CHECK ((email IS NULL) = (email_normalized IS NULL));

-- G-2: nombre de usuario único por comercio (A-7). Va atado a la membresía,
-- no al usuario suelto: las dos claves compuestas impiden un nombre de
-- usuario en un comercio donde esa persona no es miembro.
CREATE TABLE identity.user_login_names (
  id uuid PRIMARY KEY CONSTRAINT user_login_names_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  tenant_membership_id uuid NOT NULL,
  user_id uuid NOT NULL,
  login_name text NOT NULL CONSTRAINT user_login_names_name_ck CHECK (btrim(login_name) <> '' AND char_length(login_name) <= 64),
  login_name_normalized text NOT NULL CONSTRAINT user_login_names_normalized_ck CHECK (
    btrim(login_name_normalized) <> '' AND login_name_normalized = lower(btrim(login_name_normalized))
  ),
  status text NOT NULL CONSTRAINT user_login_names_status_ck CHECK (status IN ('ACTIVE','RETIRED')),
  created_at timestamptz NOT NULL,
  retired_at timestamptz NULL,
  version bigint NOT NULL DEFAULT 1 CONSTRAINT user_login_names_version_ck CHECK (version >= 1),
  CONSTRAINT user_login_names_state_ck CHECK (
    (status = 'ACTIVE' AND retired_at IS NULL) OR (status = 'RETIRED' AND retired_at IS NOT NULL AND retired_at >= created_at)
  ),
  CONSTRAINT user_login_names_tenant_membership_fk FOREIGN KEY (tenant_id, tenant_membership_id)
    REFERENCES tenancy.tenant_memberships(tenant_id, id) ON DELETE NO ACTION,
  CONSTRAINT user_login_names_user_membership_fk FOREIGN KEY (user_id, tenant_membership_id)
    REFERENCES tenancy.tenant_memberships(user_id, id) ON DELETE NO ACTION
);
CREATE UNIQUE INDEX user_login_names_active_name_uq ON identity.user_login_names(tenant_id, login_name_normalized) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX user_login_names_active_membership_uq ON identity.user_login_names(tenant_membership_id) WHERE status = 'ACTIVE';

-- G-3: contraseña temporal de un solo uso (A-6, A-9).
-- G-4: el backoff de A-8 necesita la hora del último fallo.
ALTER TABLE identity.user_credentials
  ADD COLUMN must_change_at_next_login boolean NOT NULL DEFAULT false,
  ADD COLUMN last_failed_at timestamptz NULL,
  ADD CONSTRAINT user_credentials_failure_time_ck CHECK (failed_attempt_count = 0 OR last_failed_at IS NOT NULL);

-- G-5: la SSA se ata al equipo (DEC-012). 001 difería device_id a NULL hasta
-- que existiera el registro de equipos; 004 lo creó. Se sustituye el
-- aplazamiento por una clave foránea al registro.
ALTER TABLE identity.sessions
  DROP CONSTRAINT sessions_device_deferred_ck,
  ADD CONSTRAINT sessions_device_fk FOREIGN KEY (device_id) REFERENCES identity.device_registry(device_id) ON DELETE NO ACTION;
ALTER TABLE identity.security_events
  DROP CONSTRAINT security_events_device_deferred_ck,
  ADD CONSTRAINT security_events_device_fk FOREIGN KEY (device_id) REFERENCES identity.device_registry(device_id) ON DELETE NO ACTION;

-- G-6: códigos de recuperación de un solo uso del PLATFORM_OWNER (A-9).
-- Sólo el hash: el código utilizable se entrega una vez y no se guarda.
CREATE TABLE identity.mfa_recovery_codes (
  id uuid PRIMARY KEY CONSTRAINT mfa_recovery_codes_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  user_id uuid NOT NULL,
  batch_id uuid NOT NULL CONSTRAINT mfa_recovery_codes_batch_v7_ck CHECK (platform.is_uuid_v7(batch_id)),
  code_hash text NOT NULL CONSTRAINT mfa_recovery_codes_hash_ck CHECK (btrim(code_hash) <> ''),
  status text NOT NULL CONSTRAINT mfa_recovery_codes_status_ck CHECK (status IN ('ACTIVE','CONSUMED','REVOKED')),
  created_at timestamptz NOT NULL,
  consumed_at timestamptz NULL,
  revoked_at timestamptz NULL,
  version bigint NOT NULL DEFAULT 1 CONSTRAINT mfa_recovery_codes_version_ck CHECK (version >= 1),
  CONSTRAINT mfa_recovery_codes_hash_uq UNIQUE (code_hash),
  CONSTRAINT mfa_recovery_codes_state_ck CHECK (
    (status = 'ACTIVE' AND consumed_at IS NULL AND revoked_at IS NULL)
    OR (status = 'CONSUMED' AND consumed_at IS NOT NULL AND revoked_at IS NULL)
    OR (status = 'REVOKED' AND revoked_at IS NOT NULL)
  ),
  CONSTRAINT mfa_recovery_codes_user_fk FOREIGN KEY (user_id) REFERENCES identity.users(id) ON DELETE NO ACTION
);
CREATE INDEX mfa_recovery_codes_user_status_idx ON identity.mfa_recovery_codes(user_id, status);

-- Mismo régimen que 001 para identidad: sólo el rol de Identity escribe, por
-- columna; nadie más lee secretos derivados.
GRANT SELECT, INSERT ON identity.user_login_names, identity.mfa_recovery_codes TO pos_platform_app;
GRANT UPDATE (status, retired_at, version) ON identity.user_login_names TO pos_platform_app;
GRANT UPDATE (status, consumed_at, revoked_at, version) ON identity.mfa_recovery_codes TO pos_platform_app;
GRANT UPDATE (must_change_at_next_login, last_failed_at) ON identity.user_credentials TO pos_platform_app;
REVOKE ALL ON identity.user_login_names, identity.mfa_recovery_codes FROM pos_app, pos_worker, pos_platform_admin;
