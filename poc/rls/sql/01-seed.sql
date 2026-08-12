\set ON_ERROR_STOP on

INSERT INTO poc.tenants (tenant_id, display_name) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Tenant A'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Tenant B');

INSERT INTO poc.companies (company_id, tenant_id, legal_name) VALUES
  ('aaaaaaaa-0001-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Company A'),
  ('bbbbbbbb-0001-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Company B');

INSERT INTO poc.branches (branch_id, tenant_id, company_id, branch_name) VALUES
  ('aaaaaaaa-0002-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-0001-4000-8000-000000000001', 'Branch A'),
  ('bbbbbbbb-0002-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-0001-4000-8000-000000000001', 'Branch B');

INSERT INTO poc.test_sales (sale_id, tenant_id, company_id, branch_id, description) VALUES
  ('aaaaaaaa-0003-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-0001-4000-8000-000000000001', 'aaaaaaaa-0002-4000-8000-000000000001', 'Sale A'),
  ('bbbbbbbb-0003-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-0001-4000-8000-000000000001', 'bbbbbbbb-0002-4000-8000-000000000001', 'Sale B');
