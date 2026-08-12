\set ON_ERROR_STOP on

DROP SCHEMA IF EXISTS poc CASCADE;

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rls_poc_owner') THEN
    CREATE ROLE rls_poc_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rls_poc_app') THEN
    CREATE ROLE rls_poc_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rls_poc_worker') THEN
    CREATE ROLE rls_poc_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rls_poc_platform_admin') THEN
    CREATE ROLE rls_poc_platform_admin LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rls_poc_test_executor') THEN
    CREATE ROLE rls_poc_test_executor LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$roles$;

GRANT rls_poc_owner, rls_poc_app, rls_poc_worker, rls_poc_platform_admin
  TO rls_poc_test_executor;

CREATE SCHEMA poc AUTHORIZATION rls_poc_owner;

SET ROLE rls_poc_owner;

CREATE FUNCTION poc.current_tenant_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  raw_value text;
BEGIN
  raw_value := current_setting('app.tenant_id', true);
  IF raw_value IS NULL OR btrim(raw_value) = '' THEN
    RETURN NULL;
  END IF;
  RETURN raw_value::uuid;
EXCEPTION
  WHEN invalid_text_representation THEN
    RETURN NULL;
END
$function$;

CREATE TABLE poc.tenants (
  tenant_id uuid PRIMARY KEY,
  display_name text NOT NULL
);

CREATE TABLE poc.companies (
  company_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  legal_name text NOT NULL,
  CONSTRAINT companies_tenant_company_uq UNIQUE (tenant_id, company_id),
  CONSTRAINT companies_tenant_fk FOREIGN KEY (tenant_id)
    REFERENCES poc.tenants (tenant_id)
);

CREATE TABLE poc.branches (
  branch_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  branch_name text NOT NULL,
  CONSTRAINT branches_tenant_company_branch_uq UNIQUE (tenant_id, company_id, branch_id),
  CONSTRAINT branches_tenant_company_fk FOREIGN KEY (tenant_id, company_id)
    REFERENCES poc.companies (tenant_id, company_id)
);

CREATE TABLE poc.test_sales (
  sale_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  description text NOT NULL,
  CONSTRAINT test_sales_tenant_branch_fk FOREIGN KEY (tenant_id, company_id, branch_id)
    REFERENCES poc.branches (tenant_id, company_id, branch_id)
);

ALTER TABLE poc.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE poc.tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE poc.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE poc.companies FORCE ROW LEVEL SECURITY;
ALTER TABLE poc.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE poc.branches FORCE ROW LEVEL SECURITY;
ALTER TABLE poc.test_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE poc.test_sales FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON poc.tenants
  USING (tenant_id = poc.current_tenant_id())
  WITH CHECK (tenant_id = poc.current_tenant_id());
CREATE POLICY company_isolation ON poc.companies
  USING (tenant_id = poc.current_tenant_id())
  WITH CHECK (tenant_id = poc.current_tenant_id());
CREATE POLICY branch_isolation ON poc.branches
  USING (tenant_id = poc.current_tenant_id())
  WITH CHECK (tenant_id = poc.current_tenant_id());
CREATE POLICY sale_isolation ON poc.test_sales
  USING (tenant_id = poc.current_tenant_id())
  WITH CHECK (tenant_id = poc.current_tenant_id());

RESET ROLE;

GRANT USAGE ON SCHEMA poc TO rls_poc_app, rls_poc_worker, rls_poc_platform_admin;
GRANT EXECUTE ON FUNCTION poc.current_tenant_id() TO rls_poc_app, rls_poc_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA poc TO rls_poc_app, rls_poc_worker;
GRANT SELECT ON ALL TABLES IN SCHEMA poc TO rls_poc_platform_admin;

REVOKE CREATE ON SCHEMA poc FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA poc FROM PUBLIC;
