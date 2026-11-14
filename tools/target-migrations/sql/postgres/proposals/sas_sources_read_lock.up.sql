-- DEC-011 rehearsal only; no production descriptor/CLI registration.
DO $guard$ BEGIN
  IF current_database() !~ '^pos_business_session_test_[0-9a-f]{16}$' THEN
    RAISE EXCEPTION 'SAS read lock requires disposable database';
  END IF;
END $guard$;

-- Fixed lock capability only: no parameters, data access, dynamic SQL, UPDATE,
-- role switching or RLS bypass. Caller reads under its own tenant policies.
-- SHARE blocks RowExclusive writers, including INSERT phantoms, until COMMIT.
-- Coarse cross-tenant availability cost MUST be approved before production.
CREATE FUNCTION "authorization".lock_sas_sources_for_read()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $function$
BEGIN
  IF session_user <> 'pos_platform_app' OR platform.current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'SAS trusted central tenant context required';
  END IF;
  LOCK TABLE "authorization".roles, "authorization".permissions,
    "authorization".role_permission_grants, "authorization".user_role_assignments
    IN SHARE MODE;
END;
$function$;
ALTER FUNCTION "authorization".lock_sas_sources_for_read() OWNER TO pos_schema_owner;
REVOKE ALL ON FUNCTION "authorization".lock_sas_sources_for_read() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "authorization".lock_sas_sources_for_read() TO pos_platform_app;
