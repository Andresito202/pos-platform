REVOKE UPDATE (commercial_reference) ON tenancy.onboarding_operations FROM pos_platform_app;
DROP POLICY IF EXISTS onboarding_operations_actor_update ON tenancy.onboarding_operations;
DROP POLICY IF EXISTS onboarding_operations_bootstrap_insert ON tenancy.onboarding_operations;
DROP POLICY IF EXISTS onboarding_operations_actor_select ON tenancy.onboarding_operations;
ALTER TABLE tenancy.onboarding_operations NO FORCE ROW LEVEL SECURITY;
ALTER TABLE tenancy.onboarding_operations DISABLE ROW LEVEL SECURITY;
DROP INDEX IF EXISTS tenancy.onboarding_operations_commercial_reference_uq;
ALTER TABLE tenancy.onboarding_operations DROP CONSTRAINT IF EXISTS onboarding_operations_commercial_reference_ck;
ALTER TABLE tenancy.onboarding_operations DROP COLUMN IF EXISTS commercial_reference;
