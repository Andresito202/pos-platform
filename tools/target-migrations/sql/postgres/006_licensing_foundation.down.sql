DROP POLICY IF EXISTS licensing_license_entitlements_tenant_isolation ON licensing.license_entitlements;
DROP POLICY IF EXISTS licensing_licenses_tenant_isolation ON licensing.licenses;
DROP POLICY IF EXISTS licensing_plan_entitlements_platform_context ON licensing.plan_entitlements;
DROP POLICY IF EXISTS licensing_plans_platform_context ON licensing.plans;
DROP TABLE IF EXISTS licensing.license_entitlements;
DROP TABLE IF EXISTS licensing.licenses;
DROP TABLE IF EXISTS licensing.plan_entitlements;
DROP TABLE IF EXISTS licensing.plans;
DROP SCHEMA IF EXISTS licensing;
