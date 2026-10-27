CREATE SCHEMA subscriptions AUTHORIZATION pos_schema_owner;
REVOKE ALL ON SCHEMA subscriptions FROM PUBLIC;
CREATE TABLE subscriptions.license_quotes (
  id uuid PRIMARY KEY CHECK (platform.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  merchant_tenant_id uuid NOT NULL,
  merchant_company_id uuid NOT NULL,
  integration_id uuid NOT NULL,
  provider_reference text NOT NULL CHECK (provider_reference ~ '^[0-9a-f-]{36}$'),
  plan_id uuid NOT NULL REFERENCES licensing.plans(id) ON DELETE NO ACTION,
  plan_version bigint NOT NULL CHECK (plan_version BETWEEN 1 AND 9007199254740991),
  currency_code char(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  total_minor bigint NOT NULL CHECK (total_minor BETWEEN 0 AND 9007199254740991),
  currency_exponent integer NOT NULL CHECK (currency_exponent BETWEEN 0 AND 6),
  included_registers integer NOT NULL CHECK (included_registers=1),
  additional_registers integer NOT NULL CHECK (additional_registers BETWEEN 0 AND 10000),
  pricing_snapshot jsonb NOT NULL CHECK (jsonb_typeof(pricing_snapshot)='object'),
  terms_snapshot jsonb NOT NULL CHECK (jsonb_typeof(terms_snapshot)='object'),
  entitlements_snapshot jsonb NOT NULL CHECK (jsonb_typeof(entitlements_snapshot)='array'),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 128),
  request_checksum text NOT NULL CHECK (request_checksum ~ '^[a-f0-9]{64}$'),
  quote_checksum text NOT NULL CHECK (quote_checksum ~ '^[a-f0-9]{64}$'),
  created_by_user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE NO ACTION,
  created_by_session_id uuid NOT NULL REFERENCES identity.sessions(id) ON DELETE NO ACTION,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at>created_at),
  UNIQUE (tenant_id,company_id,idempotency_key),
  UNIQUE (tenant_id,company_id,id),
  UNIQUE (merchant_tenant_id,integration_id,provider_reference),
  FOREIGN KEY (tenant_id,company_id) REFERENCES organization.companies(tenant_id,id) ON DELETE NO ACTION,
  FOREIGN KEY (merchant_tenant_id,merchant_company_id,integration_id)
    REFERENCES integrations.external_integrations(tenant_id,company_id,id) ON DELETE NO ACTION
);
-- A quote is immutable evidence, not a mutable payment/license/invoice state.
CREATE TRIGGER subscription_quote_append_only BEFORE UPDATE OR DELETE ON subscriptions.license_quotes
  FOR EACH ROW EXECUTE FUNCTION audit.reject_append_only_mutation();
CREATE TRIGGER subscription_quote_no_truncate BEFORE TRUNCATE ON subscriptions.license_quotes
  FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_append_only_mutation();
ALTER TABLE subscriptions.license_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions.license_quotes FORCE ROW LEVEL SECURITY;
CREATE POLICY subscription_quotes_central ON subscriptions.license_quotes FOR ALL TO pos_platform_app USING (true) WITH CHECK (true);
CREATE POLICY subscription_quotes_owner_read ON subscriptions.license_quotes FOR SELECT TO pos_schema_owner USING (true);
GRANT USAGE ON SCHEMA subscriptions TO pos_platform_app,pos_platform_admin;
GRANT SELECT,INSERT ON subscriptions.license_quotes TO pos_platform_app;
GRANT SELECT ON subscriptions.license_quotes TO pos_platform_admin;
