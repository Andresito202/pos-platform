CREATE TABLE integrations.factus_pay_webhook_keys (
  id uuid PRIMARY KEY CONSTRAINT factus_pay_webhook_keys_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  integration_id uuid NOT NULL,
  secret_sha256 text NOT NULL CONSTRAINT factus_pay_webhook_keys_secret_sha_ck CHECK (secret_sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CONSTRAINT factus_pay_webhook_keys_status_ck CHECK (status IN ('ACTIVE','REVOKED')),
  created_at timestamptz NOT NULL,
  revoked_at timestamptz NULL,
  version bigint NOT NULL DEFAULT 1 CONSTRAINT factus_pay_webhook_keys_version_ck CHECK (version >= 1),
  CONSTRAINT factus_pay_webhook_keys_integration_fk FOREIGN KEY (tenant_id,company_id,integration_id)
    REFERENCES integrations.external_integrations(tenant_id,company_id,id) ON DELETE NO ACTION,
  CONSTRAINT factus_pay_webhook_keys_lifecycle_ck CHECK (
    (status='ACTIVE' AND revoked_at IS NULL) OR (status='REVOKED' AND revoked_at IS NOT NULL)
  ),
  CONSTRAINT factus_pay_webhook_keys_tenant_company_integration_id_uq UNIQUE (tenant_id,company_id,integration_id,id)
);

CREATE UNIQUE INDEX factus_pay_webhook_keys_active_secret_uq
  ON integrations.factus_pay_webhook_keys(secret_sha256) WHERE status='ACTIVE';
CREATE INDEX factus_pay_webhook_keys_integration_status_idx
  ON integrations.factus_pay_webhook_keys(tenant_id,company_id,integration_id,status);

CREATE TABLE integrations.factus_pay_webhook_inbox (
  id uuid PRIMARY KEY CONSTRAINT factus_pay_webhook_inbox_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  integration_id uuid NOT NULL,
  webhook_key_id uuid NOT NULL,
  external_transaction_id text NOT NULL CONSTRAINT factus_pay_webhook_inbox_external_id_ck CHECK (btrim(external_transaction_id) <> ''),
  amount numeric(19,6) NOT NULL CONSTRAINT factus_pay_webhook_inbox_amount_ck CHECK (amount > 0 AND amount <= 12100000),
  currency_code char(3) NOT NULL CONSTRAINT factus_pay_webhook_inbox_currency_ck CHECK (currency_code = 'COP'),
  provider_status text NOT NULL CONSTRAINT factus_pay_webhook_inbox_status_ck CHECK (provider_status = 'paid'),
  payer_display_name text NULL,
  payer_reference text NULL,
  observed_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  processing_status text NOT NULL DEFAULT 'PENDING'
    CONSTRAINT factus_pay_webhook_inbox_processing_ck CHECK (processing_status IN ('PENDING','PROCESSING','PROCESSED','RETRY_SCHEDULED','DEAD_LETTER')),
  attempt_count integer NOT NULL DEFAULT 0 CONSTRAINT factus_pay_webhook_inbox_attempt_ck CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NULL,
  last_error_code text NULL,
  processed_at timestamptz NULL,
  correlation_id uuid NOT NULL CONSTRAINT factus_pay_webhook_inbox_correlation_ck CHECK (platform.is_uuid_v7(correlation_id)),
  created_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1 CONSTRAINT factus_pay_webhook_inbox_version_ck CHECK (version >= 1),
  CONSTRAINT factus_pay_webhook_inbox_integration_fk FOREIGN KEY (tenant_id,company_id,integration_id)
    REFERENCES integrations.external_integrations(tenant_id,company_id,id) ON DELETE NO ACTION,
  CONSTRAINT factus_pay_webhook_inbox_key_fk FOREIGN KEY (tenant_id,company_id,integration_id,webhook_key_id)
    REFERENCES integrations.factus_pay_webhook_keys(tenant_id,company_id,integration_id,id) ON DELETE NO ACTION,
  CONSTRAINT factus_pay_webhook_inbox_dedup_uq UNIQUE (tenant_id,integration_id,external_transaction_id)
);

CREATE INDEX factus_pay_webhook_inbox_pending_idx
  ON integrations.factus_pay_webhook_inbox(processing_status,next_attempt_at,received_at)
  WHERE processing_status IN ('PENDING','RETRY_SCHEDULED');

CREATE TRIGGER factus_pay_webhook_key_immutable_guard BEFORE UPDATE ON integrations.factus_pay_webhook_keys
  FOR EACH ROW EXECUTE FUNCTION integrations.guard_allowed_update_columns('status,revoked_at,version');
CREATE TRIGGER factus_pay_webhook_key_state_guard BEFORE UPDATE OF status ON integrations.factus_pay_webhook_keys
  FOR EACH ROW EXECUTE FUNCTION integrations.guard_state_transition('status','DEFAULT','ACTIVE>REVOKED');
CREATE TRIGGER factus_pay_webhook_inbox_immutable_guard BEFORE UPDATE ON integrations.factus_pay_webhook_inbox
  FOR EACH ROW EXECUTE FUNCTION integrations.guard_allowed_update_columns('processing_status,attempt_count,next_attempt_at,last_error_code,processed_at,version');
CREATE TRIGGER factus_pay_webhook_inbox_state_guard BEFORE UPDATE OF processing_status ON integrations.factus_pay_webhook_inbox
  FOR EACH ROW EXECUTE FUNCTION integrations.guard_state_transition('processing_status','DEFAULT','PENDING>PROCESSING,PROCESSING>PROCESSED,PROCESSING>RETRY_SCHEDULED,PROCESSING>DEAD_LETTER,RETRY_SCHEDULED>PROCESSING,RETRY_SCHEDULED>DEAD_LETTER');

ALTER TABLE integrations.factus_pay_webhook_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations.factus_pay_webhook_keys FORCE ROW LEVEL SECURITY;
ALTER TABLE integrations.factus_pay_webhook_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations.factus_pay_webhook_inbox FORCE ROW LEVEL SECURITY;

CREATE POLICY factus_pay_webhook_keys_platform_only
  ON integrations.factus_pay_webhook_keys FOR ALL TO pos_platform_app, pos_platform_admin
  USING (true) WITH CHECK (true);
CREATE POLICY factus_pay_webhook_inbox_platform_only
  ON integrations.factus_pay_webhook_inbox FOR ALL TO pos_platform_app, pos_platform_admin
  USING (true) WITH CHECK (true);

-- The owner must see retained evidence when evaluating the destructive down guard.
CREATE POLICY factus_pay_webhook_keys_owner_read ON integrations.factus_pay_webhook_keys FOR SELECT TO pos_schema_owner USING (true);
CREATE POLICY factus_pay_webhook_inbox_owner_read ON integrations.factus_pay_webhook_inbox FOR SELECT TO pos_schema_owner USING (true);

REVOKE ALL ON integrations.factus_pay_webhook_keys, integrations.factus_pay_webhook_inbox FROM PUBLIC,pos_app,pos_worker,pos_reporting;
GRANT SELECT,INSERT ON integrations.factus_pay_webhook_keys TO pos_platform_app;
GRANT UPDATE (status,revoked_at,version) ON integrations.factus_pay_webhook_keys TO pos_platform_app;
GRANT SELECT ON integrations.factus_pay_webhook_keys TO pos_platform_admin;
GRANT SELECT,INSERT ON integrations.factus_pay_webhook_inbox TO pos_platform_app;
GRANT UPDATE (processing_status,attempt_count,next_attempt_at,last_error_code,processed_at,version) ON integrations.factus_pay_webhook_inbox TO pos_platform_app;
GRANT SELECT ON integrations.factus_pay_webhook_inbox TO pos_platform_admin;
