\set ON_ERROR_STOP on

\echo '=== PostgreSQL version ==='
SELECT version();

\echo '=== Roles ==='
SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolcanlogin, rolinherit, rolbypassrls
FROM pg_roles
WHERE rolname LIKE 'rls_poc_%'
ORDER BY rolname;

\echo '=== Table owner and RLS flags ==='
SELECT n.nspname AS schema_name, c.relname, owner.rolname AS table_owner,
       c.relrowsecurity, c.relforcerowsecurity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_roles owner ON owner.oid = c.relowner
WHERE n.nspname = 'poc' AND c.relkind = 'r'
ORDER BY c.relname;

\echo '=== Policies ==='
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'poc'
ORDER BY tablename, policyname;

\echo '=== Grants ==='
SELECT grantee, table_schema, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'poc' AND grantee LIKE 'rls_poc_%'
ORDER BY grantee, table_name, privilege_type;

\echo '=== Composite constraints ==='
SELECT conrelid::regclass AS relation, conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE connamespace = 'poc'::regnamespace
ORDER BY conrelid::regclass::text, conname;
