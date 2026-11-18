-- Central Sync domain projection ledger (commercial consumers).
-- Additive successor: durable receive remains sync.sync_operations;
-- application writes typed outcomes here. Not a second sync engine.
-- Target: PostgreSQL 16+ via commercial runner or isolated sync lab apply.

CREATE TABLE sync.domain_projections (
  id uuid PRIMARY KEY CONSTRAINT domain_projections_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  operation_type text NOT NULL CONSTRAINT domain_projections_operation_type_ck CHECK (btrim(operation_type) <> ''),
  family text NOT NULL CONSTRAINT domain_projections_family_ck CHECK (family IN (
    'SALES','PAYMENTS','INVENTORY','PRODUCTION','AUDIT'
  )),
  aggregate_type text NOT NULL CONSTRAINT domain_projections_aggregate_type_ck CHECK (btrim(aggregate_type) <> ''),
  aggregate_id uuid NOT NULL,
  projection_status text NOT NULL CONSTRAINT domain_projections_status_ck CHECK (projection_status IN (
    'APPLIED','CONFLICT','REVIEW_REQUIRED','REJECTED'
  )),
  result_code text NOT NULL CONSTRAINT domain_projections_result_code_ck CHECK (btrim(result_code) <> ''),
  payload jsonb NOT NULL,
  payload_checksum text NOT NULL CONSTRAINT domain_projections_checksum_ck CHECK (payload_checksum ~ '^[a-f0-9]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  version bigint NOT NULL DEFAULT 1 CONSTRAINT domain_projections_version_ck CHECK (version >= 1),
  CONSTRAINT domain_projections_tenant_operation_uq UNIQUE (tenant_id, operation_id),
  CONSTRAINT domain_projections_operation_fk FOREIGN KEY (tenant_id, operation_id)
    REFERENCES sync.sync_operations(tenant_id, id) ON DELETE NO ACTION
);

CREATE INDEX domain_projections_tenant_family_idx
  ON sync.domain_projections(tenant_id, family, applied_at DESC, id DESC);
CREATE INDEX domain_projections_tenant_aggregate_idx
  ON sync.domain_projections(tenant_id, aggregate_type, aggregate_id, id);
CREATE INDEX domain_projections_company_branch_idx
  ON sync.domain_projections(tenant_id, company_id, branch_id, applied_at DESC)
  WHERE branch_id IS NOT NULL;

CREATE TRIGGER domain_projections_no_delete
  BEFORE DELETE ON sync.domain_projections
  FOR EACH ROW EXECUTE FUNCTION audit.reject_append_only_mutation();
CREATE TRIGGER domain_projections_no_truncate
  BEFORE TRUNCATE ON sync.domain_projections
  FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_append_only_mutation();

ALTER TABLE sync.domain_projections ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync.domain_projections FORCE ROW LEVEL SECURITY;

CREATE POLICY domain_projections_tenant_isolation ON sync.domain_projections
  FOR ALL TO pos_app, pos_worker, pos_platform_app
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE POLICY domain_projections_owner_evidence_read ON sync.domain_projections
  FOR SELECT TO pos_schema_owner USING (true);

REVOKE ALL ON sync.domain_projections FROM PUBLIC;
GRANT SELECT, INSERT ON sync.domain_projections TO pos_app, pos_worker, pos_platform_app;
GRANT UPDATE (projection_status, result_code, payload, payload_checksum, applied_at, version)
  ON sync.domain_projections TO pos_app, pos_worker, pos_platform_app;
GRANT SELECT ON sync.domain_projections TO pos_platform_admin, pos_reporting;
