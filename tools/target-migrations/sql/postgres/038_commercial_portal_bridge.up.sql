-- Commercial portal bridge durable custody (sessions, JTI replay, trials, provisioning).
-- Does not invent users or tenants; binds portal Bearer tokens to identity.sessions.

CREATE TABLE identity.commercial_bridge_sessions (
  token_hash text PRIMARY KEY CONSTRAINT commercial_bridge_sessions_hash_ck CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  session_id uuid NOT NULL REFERENCES identity.sessions(id) ON DELETE NO ACTION,
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE NO ACTION,
  role text NOT NULL CONSTRAINT commercial_bridge_sessions_role_ck CHECK (role = 'SUPERADMIN_GLOBAL'),
  authority text NOT NULL CONSTRAINT commercial_bridge_sessions_authority_ck CHECK (authority = 'GLOBAL'),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT commercial_bridge_sessions_expiry_ck CHECK (expires_at > created_at),
  CONSTRAINT commercial_bridge_sessions_revoked_ck CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX commercial_bridge_sessions_session_idx
  ON identity.commercial_bridge_sessions(session_id)
  WHERE revoked_at IS NULL;

CREATE TABLE identity.commercial_bridge_jtis (
  purpose text NOT NULL CONSTRAINT commercial_bridge_jtis_purpose_ck CHECK (btrim(purpose) <> '' AND char_length(purpose) <= 64),
  jti text NOT NULL CONSTRAINT commercial_bridge_jtis_jti_ck CHECK (btrim(jti) <> '' AND char_length(jti) <= 128),
  used_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT commercial_bridge_jtis_pk PRIMARY KEY (purpose, jti),
  CONSTRAINT commercial_bridge_jtis_expiry_ck CHECK (expires_at > used_at)
);

CREATE FUNCTION identity.guard_commercial_bridge_jti()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $guard$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'commercial bridge jti cannot be changed or deleted';
  END IF;
  RETURN NEW;
END;
$guard$;

CREATE TRIGGER commercial_bridge_jti_guard
BEFORE INSERT OR UPDATE OR DELETE ON identity.commercial_bridge_jtis
FOR EACH ROW EXECUTE FUNCTION identity.guard_commercial_bridge_jti();

CREATE TABLE licensing.commercial_trial_grants (
  trial_id text PRIMARY KEY CONSTRAINT commercial_trial_grants_id_ck CHECK (btrim(trial_id) <> '' AND char_length(trial_id) <= 128),
  license_id uuid NOT NULL,
  email_normalized text NOT NULL CONSTRAINT commercial_trial_grants_email_ck CHECK (btrim(email_normalized) <> ''),
  tenant_id uuid REFERENCES tenancy.tenants(id) ON DELETE NO ACTION,
  plan_id uuid REFERENCES licensing.plans(id) ON DELETE NO ACTION,
  contract_status text NOT NULL CONSTRAINT commercial_trial_grants_status_ck
    CHECK (contract_status IN ('TRIAL','EXPIRED','REVOKED')),
  starts_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  commercial_api_origin text NOT NULL CONSTRAINT commercial_trial_grants_origin_ck CHECK (btrim(commercial_api_origin) <> ''),
  activation_delivery text NOT NULL CONSTRAINT commercial_trial_grants_delivery_ck
    CHECK (activation_delivery IN ('PENDING','ACTIVATED','CALLBACK_FAILED')),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT commercial_trial_grants_window_ck CHECK (expires_at = starts_at + INTERVAL '120 hours'),
  CONSTRAINT commercial_trial_grants_no_grace_ck CHECK (expires_at > starts_at),
  CONSTRAINT commercial_trial_grants_license_uq UNIQUE (license_id)
);

CREATE INDEX commercial_trial_grants_expire_idx
  ON licensing.commercial_trial_grants(expires_at)
  WHERE contract_status = 'TRIAL' AND revoked_at IS NULL;

CREATE TABLE licensing.commercial_provisioning_receipts (
  idempotency_key text PRIMARY KEY CONSTRAINT commercial_provisioning_key_ck
    CHECK (btrim(idempotency_key) <> '' AND char_length(idempotency_key) >= 16 AND char_length(idempotency_key) <= 128),
  provisioning_id text NOT NULL CONSTRAINT commercial_provisioning_id_ck CHECK (btrim(provisioning_id) <> ''),
  order_id text NOT NULL,
  tenant_id uuid REFERENCES tenancy.tenants(id) ON DELETE NO ACTION,
  license_units integer NOT NULL CONSTRAINT commercial_provisioning_units_ck CHECK (license_units > 0 AND license_units <= 10000),
  payload_hash text NOT NULL CONSTRAINT commercial_provisioning_hash_ck CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  payload jsonb NOT NULL,
  license_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  fulfillment text NOT NULL CONSTRAINT commercial_provisioning_fulfillment_ck
    CHECK (fulfillment IN ('QUEUED','ISSUED','ALREADY_QUEUED','ALREADY_ISSUED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT commercial_provisioning_id_uq UNIQUE (provisioning_id)
);

ALTER TABLE identity.commercial_bridge_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.commercial_bridge_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE identity.commercial_bridge_jtis ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.commercial_bridge_jtis FORCE ROW LEVEL SECURITY;
ALTER TABLE licensing.commercial_trial_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE licensing.commercial_trial_grants FORCE ROW LEVEL SECURITY;
ALTER TABLE licensing.commercial_provisioning_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE licensing.commercial_provisioning_receipts FORCE ROW LEVEL SECURITY;

CREATE POLICY commercial_bridge_sessions_central ON identity.commercial_bridge_sessions
  FOR ALL TO pos_platform_app USING (true) WITH CHECK (true);
CREATE POLICY commercial_bridge_jtis_central ON identity.commercial_bridge_jtis
  FOR ALL TO pos_platform_app USING (true) WITH CHECK (true);
CREATE POLICY commercial_trial_grants_central ON licensing.commercial_trial_grants
  FOR ALL TO pos_platform_app USING (true) WITH CHECK (true);
CREATE POLICY commercial_provisioning_receipts_central ON licensing.commercial_provisioning_receipts
  FOR ALL TO pos_platform_app USING (true) WITH CHECK (true);

REVOKE ALL ON identity.commercial_bridge_sessions FROM PUBLIC, pos_app, pos_worker, pos_platform_admin;
REVOKE ALL ON identity.commercial_bridge_jtis FROM PUBLIC, pos_app, pos_worker, pos_platform_admin;
REVOKE ALL ON licensing.commercial_trial_grants FROM PUBLIC, pos_app, pos_worker, pos_platform_admin;
REVOKE ALL ON licensing.commercial_provisioning_receipts FROM PUBLIC, pos_app, pos_worker, pos_platform_admin;
REVOKE ALL ON FUNCTION identity.guard_commercial_bridge_jti() FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE ON identity.commercial_bridge_sessions TO pos_platform_app;
GRANT SELECT, INSERT ON identity.commercial_bridge_jtis TO pos_platform_app;
GRANT EXECUTE ON FUNCTION identity.guard_commercial_bridge_jti() TO pos_platform_app;
GRANT SELECT, INSERT, UPDATE ON licensing.commercial_trial_grants TO pos_platform_app;
GRANT SELECT, INSERT, UPDATE ON licensing.commercial_provisioning_receipts TO pos_platform_app;
