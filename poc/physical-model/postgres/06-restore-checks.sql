\set ON_ERROR_STOP on

DO $checks$
DECLARE
  rls_count integer;
  forced_count integer;
  policy_count integer;
  trigger_count integer;
BEGIN
  SELECT count(*) INTO rls_count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='poc' AND c.relkind='r' AND c.relrowsecurity;
  SELECT count(*) INTO forced_count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='poc' AND c.relkind='r' AND c.relforcerowsecurity;
  SELECT count(*) INTO policy_count FROM pg_policies WHERE schemaname='poc';
  SELECT count(*) INTO trigger_count FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='poc' AND NOT t.tgisinternal;
  IF rls_count <> 21 OR forced_count <> 21 OR policy_count <> 21 THEN
    RAISE EXCEPTION 'RLS restore mismatch rls=% force=% policies=%',rls_count,forced_count,policy_count;
  END IF;
  IF trigger_count < 8 THEN RAISE EXCEPTION 'immutability triggers missing'; END IF;
  IF NOT EXISTS(SELECT 1 FROM poc.sales WHERE id='01890f5a-0000-7000-8000-000000002201') THEN
    RAISE EXCEPTION 'restored committed business fact missing';
  END IF;
  IF pg_read_file('/tmp/physical-model-roles.sql') NOT LIKE '%CREATE ROLE physical_poc_app%' THEN
    RAISE EXCEPTION 'separate roles dump missing';
  END IF;
END
$checks$;

BEGIN;
SET LOCAL ROLE physical_poc_app;
SET LOCAL app.tenant_id='01890f5a-0000-7000-8000-000000000001';
SELECT CASE WHEN count(*)>0 THEN 'RESTORE_TENANT_A_VISIBLE=PASS' ELSE 'RESTORE_TENANT_A_VISIBLE=FAIL' END FROM poc.sales;
COMMIT;
BEGIN;
SET LOCAL ROLE physical_poc_app;
SELECT CASE WHEN count(*)=0 THEN 'RESTORE_MISSING_CONTEXT_FAIL_CLOSED=PASS' ELSE 'RESTORE_MISSING_CONTEXT_FAIL_CLOSED=FAIL' END FROM poc.sales;
COMMIT;

SELECT 'POSTGRES_RESTORE_ROLES=SEPARATE_CLUSTER_ARTIFACT';
SELECT 'POSTGRES_RESTORE_RESULT=PASS';
