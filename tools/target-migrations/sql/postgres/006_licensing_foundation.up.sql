CREATE SCHEMA licensing AUTHORIZATION pos_schema_owner;

CREATE TABLE licensing.plans (
  id uuid PRIMARY KEY CONSTRAINT licensing_plans_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  code text NOT NULL CONSTRAINT licensing_plans_code_ck CHECK (btrim(code) <> ''),
  name text NOT NULL CONSTRAINT licensing_plans_name_ck CHECK (btrim(name) <> ''),
  billing_model text NOT NULL CONSTRAINT licensing_plans_billing_model_ck CHECK (billing_model IN ('MONTHLY','ANNUAL','PERPETUAL')),
  deployment_mode text NOT NULL CONSTRAINT licensing_plans_deployment_mode_ck CHECK (deployment_mode IN ('HYBRID','LOCAL_PERPETUAL')),
  currency_code text NOT NULL CONSTRAINT licensing_plans_currency_ck CHECK (currency_code ~ '^[A-Z]{3}$'),
  price_minor bigint NOT NULL CONSTRAINT licensing_plans_price_ck CHECK (price_minor >= 0),
  status text NOT NULL CONSTRAINT licensing_plans_status_ck CHECK (status IN ('DRAFT','ACTIVE','RETIRED')),
  version bigint NOT NULL DEFAULT 1 CONSTRAINT licensing_plans_version_ck CHECK (version >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL CONSTRAINT licensing_plans_timestamps_ck CHECK (updated_at >= created_at),
  UNIQUE (code, version)
);

CREATE TABLE licensing.plan_entitlements (
  id uuid PRIMARY KEY CONSTRAINT licensing_plan_entitlements_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  plan_id uuid NOT NULL REFERENCES licensing.plans(id) ON DELETE NO ACTION,
  capability_code text NOT NULL CONSTRAINT licensing_plan_entitlements_capability_ck CHECK (btrim(capability_code) <> ''),
  enabled boolean NOT NULL,
  limit_type text NOT NULL CONSTRAINT licensing_plan_entitlements_limit_type_ck CHECK (limit_type IN ('FINITE','UNLIMITED','NOT_APPLICABLE')),
  limit_value bigint,
  created_at timestamptz NOT NULL,
  CONSTRAINT licensing_plan_entitlements_limit_ck CHECK (
    (limit_type = 'FINITE' AND limit_value IS NOT NULL AND limit_value >= 0)
    OR (limit_type IN ('UNLIMITED','NOT_APPLICABLE') AND limit_value IS NULL)
  ),
  UNIQUE (plan_id, capability_code)
);

CREATE TABLE licensing.licenses (
  id uuid PRIMARY KEY CONSTRAINT licensing_licenses_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  plan_id uuid NOT NULL REFERENCES licensing.plans(id) ON DELETE NO ACTION,
  deployment_mode text NOT NULL CONSTRAINT licensing_licenses_deployment_mode_ck CHECK (deployment_mode IN ('HYBRID','LOCAL_PERPETUAL')),
  contract_status text NOT NULL CONSTRAINT licensing_licenses_contract_status_ck CHECK (contract_status IN ('TRIAL','ACTIVE','PAST_DUE','SUSPENDED','CANCELLED','TERMINATED')),
  not_before timestamptz NOT NULL,
  expires_at timestamptz,
  grace_policy_reference text,
  policy_version text NOT NULL CONSTRAINT licensing_licenses_policy_version_ck CHECK (btrim(policy_version) <> ''),
  commercial_reference text,
  current_version bigint NOT NULL DEFAULT 1 CONSTRAINT licensing_licenses_current_version_ck CHECK (current_version >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL CONSTRAINT licensing_licenses_timestamps_ck CHECK (updated_at >= created_at),
  version bigint NOT NULL DEFAULT 1 CONSTRAINT licensing_licenses_version_ck CHECK (version >= 1),
  CONSTRAINT licensing_licenses_expiry_ck CHECK (expires_at IS NULL OR expires_at > not_before),
  CONSTRAINT licensing_licenses_perpetual_ck CHECK (
    (deployment_mode = 'LOCAL_PERPETUAL' AND expires_at IS NULL)
    OR deployment_mode = 'HYBRID'
    OR expires_at IS NOT NULL
  ),
  CONSTRAINT licensing_licenses_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenancy.tenants(id) ON DELETE NO ACTION
);

CREATE TABLE licensing.license_entitlements (
  id uuid PRIMARY KEY CONSTRAINT licensing_license_entitlements_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  license_id uuid NOT NULL REFERENCES licensing.licenses(id) ON DELETE NO ACTION,
  capability_code text NOT NULL CONSTRAINT licensing_license_entitlements_capability_ck CHECK (btrim(capability_code) <> ''),
  enabled boolean NOT NULL,
  limit_type text NOT NULL CONSTRAINT licensing_license_entitlements_limit_type_ck CHECK (limit_type IN ('FINITE','UNLIMITED','NOT_APPLICABLE')),
  limit_value bigint,
  source_plan_version bigint NOT NULL CONSTRAINT licensing_license_entitlements_plan_version_ck CHECK (source_plan_version >= 1),
  created_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1 CONSTRAINT licensing_license_entitlements_version_ck CHECK (version >= 1),
  CONSTRAINT licensing_license_entitlements_limit_ck CHECK (
    (limit_type = 'FINITE' AND limit_value IS NOT NULL AND limit_value >= 0)
    OR (limit_type IN ('UNLIMITED','NOT_APPLICABLE') AND limit_value IS NULL)
  ),
  UNIQUE (license_id, capability_code)
);

CREATE UNIQUE INDEX licensing_plans_active_code_uq ON licensing.plans(code) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX licensing_licenses_commercial_reference_uq
  ON licensing.licenses(commercial_reference)
  WHERE commercial_reference IS NOT NULL;
CREATE INDEX licensing_licenses_tenant_status_idx ON licensing.licenses(tenant_id, contract_status, id);
CREATE INDEX licensing_licenses_plan_idx ON licensing.licenses(plan_id, id);
CREATE INDEX licensing_license_entitlements_license_idx ON licensing.license_entitlements(license_id, capability_code);

ALTER TABLE licensing.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE licensing.plans FORCE ROW LEVEL SECURITY;
ALTER TABLE licensing.plan_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE licensing.plan_entitlements FORCE ROW LEVEL SECURITY;
ALTER TABLE licensing.licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE licensing.licenses FORCE ROW LEVEL SECURITY;
ALTER TABLE licensing.license_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE licensing.license_entitlements FORCE ROW LEVEL SECURITY;

CREATE POLICY licensing_plans_platform_context
  ON licensing.plans FOR ALL TO pos_platform_app, pos_platform_admin
  USING (true) WITH CHECK (true);

CREATE POLICY licensing_plan_entitlements_platform_context
  ON licensing.plan_entitlements FOR ALL TO pos_platform_app, pos_platform_admin
  USING (true) WITH CHECK (true);

CREATE POLICY licensing_licenses_tenant_isolation
  ON licensing.licenses FOR ALL TO pos_app, pos_worker, pos_platform_app, pos_platform_admin
  USING (tenant_id = platform.current_tenant_id() OR current_user IN ('pos_platform_app','pos_platform_admin'))
  WITH CHECK (tenant_id = platform.current_tenant_id() OR current_user IN ('pos_platform_app','pos_platform_admin'));

CREATE POLICY licensing_license_entitlements_tenant_isolation
  ON licensing.license_entitlements FOR ALL TO pos_app, pos_worker, pos_platform_app, pos_platform_admin
  USING (
    EXISTS (
      SELECT 1 FROM licensing.licenses l
      WHERE l.id = license_id
        AND (l.tenant_id = platform.current_tenant_id() OR current_user IN ('pos_platform_app','pos_platform_admin'))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM licensing.licenses l
      WHERE l.id = license_id
        AND (l.tenant_id = platform.current_tenant_id() OR current_user IN ('pos_platform_app','pos_platform_admin'))
    )
  );

REVOKE ALL ON SCHEMA licensing FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA licensing FROM PUBLIC;
GRANT USAGE ON SCHEMA licensing TO pos_app, pos_worker, pos_platform_app, pos_platform_admin;

GRANT SELECT ON licensing.plans, licensing.plan_entitlements TO pos_app, pos_worker;
GRANT SELECT, INSERT, UPDATE ON licensing.plans, licensing.plan_entitlements TO pos_platform_app;
GRANT SELECT, INSERT, UPDATE ON licensing.licenses, licensing.license_entitlements TO pos_platform_app;
GRANT SELECT ON licensing.plans, licensing.plan_entitlements, licensing.licenses, licensing.license_entitlements TO pos_platform_admin;

GRANT SELECT ON licensing.licenses, licensing.license_entitlements TO pos_app, pos_worker;
