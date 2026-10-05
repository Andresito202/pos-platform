DROP POLICY IF EXISTS onboarding_operations_update ON tenancy.onboarding_operations;
DROP POLICY IF EXISTS onboarding_operations_bootstrap_write ON tenancy.onboarding_operations;
DROP POLICY IF EXISTS onboarding_operations_actor_select ON tenancy.onboarding_operations;
ALTER TABLE tenancy.onboarding_operations NO FORCE ROW LEVEL SECURITY;
ALTER TABLE tenancy.onboarding_operations DISABLE ROW LEVEL SECURITY;
