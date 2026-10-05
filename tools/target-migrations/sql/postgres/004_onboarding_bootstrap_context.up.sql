-- Onboarding bootstrap context: permits the platform onboarding service to resolve
-- its own idempotency records before a tenant context exists, then requires
-- normal tenant RLS once tenant_id is materialized.
-- No BYPASSRLS, SECURITY DEFINER, or global tenant visibility is introduced.

ALTER TABLE tenancy.onboarding_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenancy.onboarding_operations FORCE ROW LEVEL SECURITY;

CREATE POLICY onboarding_operations_actor_select
  ON tenancy.onboarding_operations
  FOR SELECT TO pos_platform_app
  USING (actor_id::text = current_setting('app.actor_id', true));

CREATE POLICY onboarding_operations_bootstrap_write
  ON tenancy.onboarding_operations
  FOR INSERT TO pos_platform_app
  WITH CHECK (
    tenant_id IS NULL
    AND actor_id::text = current_setting('app.actor_id', true)
  );

CREATE POLICY onboarding_operations_update
  ON tenancy.onboarding_operations
  FOR UPDATE TO pos_platform_app
  USING (
    actor_id::text = current_setting('app.actor_id', true)
    AND (
      tenant_id IS NULL
      OR tenant_id = platform.current_tenant_id()
    )
  )
  WITH CHECK (
    actor_id::text = current_setting('app.actor_id', true)
    AND (
      tenant_id IS NULL
      OR tenant_id = platform.current_tenant_id()
    )
  );

COMMENT ON POLICY onboarding_operations_actor_select ON tenancy.onboarding_operations IS
  'Allows the authenticated platform onboarding actor to resolve its own idempotency record without global tenant visibility.';
COMMENT ON POLICY onboarding_operations_bootstrap_write ON tenancy.onboarding_operations IS
  'Allows only a pre-tenant onboarding record owned by the current platform actor; tenant-scoped writes require tenant context.';
COMMENT ON POLICY onboarding_operations_update ON tenancy.onboarding_operations IS
  'Allows bootstrap completion by the same actor and then enforces the materialized tenant context.';
