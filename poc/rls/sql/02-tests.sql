\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.assert_true(condition boolean, test_name text)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  IF condition IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL: %', test_name;
  END IF;
  RAISE NOTICE 'PASS: %', test_name;
END
$function$;

\echo '=== Role attributes ==='
SELECT pg_temp.assert_true(
  NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole,
  'J runtime role is not superuser/BYPASSRLS/CREATEROLE'
)
FROM pg_roles WHERE rolname = 'rls_poc_app';

SELECT pg_temp.assert_true(
  NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole,
  'J worker role is not superuser/BYPASSRLS/CREATEROLE'
)
FROM pg_roles WHERE rolname = 'rls_poc_worker';

\echo '=== Runtime missing and invalid context fail closed ==='
BEGIN;
SET LOCAL ROLE rls_poc_app;
SELECT pg_temp.assert_true(count(*) = 0, 'E missing context returns zero rows') FROM poc.test_sales;
SET LOCAL app.tenant_id = '';
SELECT pg_temp.assert_true(count(*) = 0, 'E empty context returns zero rows') FROM poc.test_sales;
SET LOCAL app.tenant_id = 'not-a-uuid';
SELECT pg_temp.assert_true(count(*) = 0, 'F invalid UUID context returns zero rows') FROM poc.test_sales;
ROLLBACK;

\echo '=== Tenant A read/write isolation ==='
BEGIN;
SET LOCAL ROLE rls_poc_app;
SET LOCAL app.tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
SELECT pg_temp.assert_true(array_agg(description ORDER BY description) = ARRAY['Sale A'], 'A Tenant A SELECT sees only Sale A') FROM poc.test_sales;
INSERT INTO poc.test_sales VALUES (
  'aaaaaaaa-0003-4000-8000-000000000002',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'aaaaaaaa-0001-4000-8000-000000000001',
  'aaaaaaaa-0002-4000-8000-000000000001',
  'Sale A runtime insert'
);
SELECT pg_temp.assert_true(count(*) = 1, 'Tenant A valid INSERT succeeds') FROM poc.test_sales WHERE description = 'Sale A runtime insert';

DO $test$
BEGIN
  BEGIN
    INSERT INTO poc.test_sales VALUES (
      'bbbbbbbb-0003-4000-8000-000000000002',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'bbbbbbbb-0001-4000-8000-000000000001',
      'bbbbbbbb-0002-4000-8000-000000000001',
      'forbidden cross tenant insert'
    );
    RAISE EXCEPTION 'FAIL: B cross-tenant INSERT unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS: B/L cross-tenant INSERT rejected by WITH CHECK';
  END;
END
$test$;

UPDATE poc.test_sales SET description = 'Sale A updated' WHERE sale_id = 'aaaaaaaa-0003-4000-8000-000000000001';
SELECT pg_temp.assert_true(description = 'Sale A updated', 'Tenant A own UPDATE succeeds') FROM poc.test_sales WHERE sale_id = 'aaaaaaaa-0003-4000-8000-000000000001';

DO $test$
BEGIN
  BEGIN
    UPDATE poc.test_sales
    SET tenant_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    WHERE sale_id = 'aaaaaaaa-0003-4000-8000-000000000001';
    RAISE EXCEPTION 'FAIL: C tenant reassignment unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege OR foreign_key_violation THEN
      RAISE NOTICE 'PASS: C tenant reassignment rejected';
  END;
END
$test$;

WITH changed AS (
  UPDATE poc.test_sales SET description = 'forbidden update'
  WHERE sale_id = 'bbbbbbbb-0003-4000-8000-000000000001'
  RETURNING 1
)
SELECT pg_temp.assert_true(count(*) = 0, 'C cross-tenant UPDATE affects zero rows') FROM changed;

WITH removed AS (
  DELETE FROM poc.test_sales
  WHERE sale_id = 'bbbbbbbb-0003-4000-8000-000000000001'
  RETURNING 1
)
SELECT pg_temp.assert_true(count(*) = 0, 'D cross-tenant DELETE affects zero rows') FROM removed;
COMMIT;

\echo '=== Tenant B read isolation ==='
BEGIN;
SET LOCAL ROLE rls_poc_app;
SET LOCAL app.tenant_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
SELECT pg_temp.assert_true(array_agg(description ORDER BY description) = ARRAY['Sale B'], 'A Tenant B SELECT sees only Sale B') FROM poc.test_sales;
COMMIT;

\echo '=== Same connection reuse ==='
BEGIN;
SET LOCAL ROLE rls_poc_app;
SET LOCAL app.tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
SELECT pg_temp.assert_true(count(*) = 2, 'G transaction 1 Tenant A context') FROM poc.test_sales;
COMMIT;
BEGIN;
SET LOCAL ROLE rls_poc_app;
SELECT pg_temp.assert_true(count(*) = 0, 'G transaction 2 has no inherited tenant') FROM poc.test_sales;
COMMIT;
BEGIN;
SET LOCAL ROLE rls_poc_app;
SET LOCAL app.tenant_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
SELECT pg_temp.assert_true(count(*) = 1, 'G transaction 3 sees only Tenant B') FROM poc.test_sales;
COMMIT;

\echo '=== Rollback clears tenant context and data ==='
BEGIN;
SET LOCAL ROLE rls_poc_app;
SET LOCAL app.tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
INSERT INTO poc.test_sales VALUES (
  'aaaaaaaa-0003-4000-8000-000000000099',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'aaaaaaaa-0001-4000-8000-000000000001',
  'aaaaaaaa-0002-4000-8000-000000000001',
  'rolled back sale'
);
ROLLBACK;
BEGIN;
SET LOCAL ROLE rls_poc_app;
SELECT pg_temp.assert_true(count(*) = 0, 'H rollback clears context for next transaction') FROM poc.test_sales;
COMMIT;
BEGIN;
SET LOCAL ROLE rls_poc_app;
SET LOCAL app.tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
SELECT pg_temp.assert_true(count(*) = 0, 'H rollback removed inserted row') FROM poc.test_sales WHERE sale_id = 'aaaaaaaa-0003-4000-8000-000000000099';
COMMIT;

\echo '=== Sequential worker jobs and rollback ==='
BEGIN;
SET LOCAL ROLE rls_poc_worker;
SET LOCAL app.tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
SELECT pg_temp.assert_true(count(*) = 2, 'I worker job A sees Tenant A') FROM poc.test_sales;
COMMIT;
BEGIN;
SET LOCAL ROLE rls_poc_worker;
SET LOCAL app.tenant_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
SELECT pg_temp.assert_true(count(*) = 1, 'I worker job B sees Tenant B') FROM poc.test_sales;
COMMIT;
BEGIN;
SET LOCAL ROLE rls_poc_worker;
SET LOCAL app.tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
SELECT pg_temp.assert_true(count(*) = 2, 'I worker failing job A starts scoped') FROM poc.test_sales;
ROLLBACK;
BEGIN;
SET LOCAL ROLE rls_poc_worker;
SET LOCAL app.tenant_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
SELECT pg_temp.assert_true(count(*) = 1, 'I worker job B after rollback has no Tenant A leakage') FROM poc.test_sales;
COMMIT;

\echo '=== Composite FK defense in depth ==='
BEGIN;
SET LOCAL ROLE rls_poc_owner;
SET LOCAL app.tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
DO $test$
BEGIN
  BEGIN
    INSERT INTO poc.branches VALUES (
      'aaaaaaaa-0002-4000-8000-000000000099',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-0001-4000-8000-000000000001',
      'invalid branch'
    );
    RAISE EXCEPTION 'FAIL: K cross-tenant Company/Branch FK unexpectedly succeeded';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS: K cross-tenant Company/Branch FK rejected';
  END;
  BEGIN
    INSERT INTO poc.test_sales VALUES (
      'aaaaaaaa-0003-4000-8000-000000000098',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'aaaaaaaa-0001-4000-8000-000000000001',
      'bbbbbbbb-0002-4000-8000-000000000001',
      'invalid branch sale'
    );
    RAISE EXCEPTION 'FAIL: K cross-tenant operational FK unexpectedly succeeded';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS: K cross-tenant operational FK rejected';
  END;
END
$test$;
ROLLBACK;

\echo '=== FORCE RLS table owner behavior ==='
BEGIN;
SET LOCAL ROLE rls_poc_owner;
SELECT pg_temp.assert_true(count(*) = 0, 'FORCE RLS applies to table owner without context') FROM poc.test_sales;
SET LOCAL app.tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
SELECT pg_temp.assert_true(count(*) = 2, 'FORCE RLS owner sees only selected tenant') FROM poc.test_sales;
ROLLBACK;

\echo '=== Controlled platform administration ==='
BEGIN;
SET LOCAL ROLE rls_poc_platform_admin;
SELECT pg_temp.assert_true(count(*) = 3, 'M explicit platform admin BYPASSRLS read sees all tenants') FROM poc.test_sales;
DO $test$
BEGIN
  BEGIN
    UPDATE poc.test_sales SET description = description;
    RAISE EXCEPTION 'FAIL: M read-only platform admin unexpectedly updated data';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: M platform admin has no write grant';
  END;
  BEGIN
    ALTER TABLE poc.test_sales DISABLE ROW LEVEL SECURITY;
    RAISE EXCEPTION 'FAIL: runtime-like admin unexpectedly disabled RLS';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: M platform admin cannot alter/disable RLS';
  END;
END
$test$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE rls_poc_app;
DO $test$
BEGIN
  BEGIN
    ALTER TABLE poc.test_sales DISABLE ROW LEVEL SECURITY;
    RAISE EXCEPTION 'FAIL: runtime unexpectedly disabled RLS';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: runtime cannot alter/disable RLS';
  END;
END
$test$;
ROLLBACK;

\echo 'ALL_RUNTIME_TESTS_PASSED'
