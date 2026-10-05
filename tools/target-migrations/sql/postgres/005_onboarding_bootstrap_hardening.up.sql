ALTER TABLE tenancy.onboarding_operations
  ADD COLUMN commercial_reference text NULL
    CONSTRAINT onboarding_operations_commercial_reference_ck CHECK (commercial_reference IS NULL OR btrim(commercial_reference) <> '');

CREATE UNIQUE INDEX onboarding_operations_commercial_reference_uq
  ON tenancy.onboarding_operations (commercial_reference)
  WHERE commercial_reference IS NOT NULL
    AND status NOT IN ('FAILED','CANCELLED');

ALTER TABLE tenancy.onboarding_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenancy.onboarding_operations FORCE ROW LEVEL SECURITY;

CREATE POLICY onboarding_operations_actor_select
  ON tenancy.onboarding_operations
  FOR SELECT TO pos_platform_app
  USING (actor_id::text = current_setting('app.actor_id', true));

CREATE POLICY onboarding_operations_bootstrap_insert
  ON tenancy.onboarding_operations
  FOR INSERT TO pos_platform_app
  WITH CHECK (
    tenant_id IS NULL
    AND actor_id::text = current_setting('app.actor_id', true)
  );

CREATE POLICY onboarding_operations_actor_update
  ON tenancy.onboarding_operations
  FOR UPDATE TO pos_platform_app
  USING (
    actor_id::text = current_setting('app.actor_id', true)
    AND (tenant_id IS NULL OR tenant_id = platform.current_tenant_id())
  )
  WITH CHECK (
    actor_id::text = current_setting('app.actor_id', true)
    AND (tenant_id IS NULL OR tenant_id = platform.current_tenant_id())
  );

GRANT UPDATE (commercial_reference) ON tenancy.onboarding_operations TO pos_platform_app;
