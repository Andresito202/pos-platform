-- Refuses destructive downgrade while commercial projection evidence exists.
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM sync.domain_projections LIMIT 1) THEN
    RAISE EXCEPTION 'cannot downgrade sync.domain_projections while projection evidence exists';
  END IF;
END $guard$;

DROP POLICY IF EXISTS domain_projections_owner_evidence_read ON sync.domain_projections;
DROP POLICY IF EXISTS domain_projections_tenant_isolation ON sync.domain_projections;
DROP TRIGGER IF EXISTS domain_projections_no_truncate ON sync.domain_projections;
DROP TRIGGER IF EXISTS domain_projections_no_delete ON sync.domain_projections;
DROP TABLE IF EXISTS sync.domain_projections;
