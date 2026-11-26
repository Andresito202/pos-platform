-- Read pending reservations under the same tenant/company scope and owner
-- policies as the 039 ledger. The ledger remains the only writer of balances.
CREATE FUNCTION fiscal.pending_document_package_reconciliation(
  p_purchase uuid,
  p_after_document uuid DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  document_id uuid,
  document_type text,
  document_status text,
  internal_reference text,
  authority_reference text,
  reconciliation_action text,
  package_expired boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $body$
  SELECT
    doc.id, doc.document_type, doc.status, doc.internal_reference, doc.authority_reference,
    CASE
      WHEN doc.status='ACCEPTED' AND doc.legal_identifier IS NOT NULL THEN 'CONSUME_WITH_EVIDENCE'
      WHEN doc.status='VOIDED_BEFORE_SUBMISSION' THEN 'REVIEW_RELEASE'
      WHEN doc.status IN ('DRAFT','READY') THEN 'AWAIT_SUBMISSION'
      ELSE 'HOLD_FOR_RECONCILIATION'
    END,
    statement_timestamp() >= package.expires_at
  FROM fiscal.document_package_reservations reservation
  JOIN fiscal.document_package_purchases package
    ON package.tenant_id=reservation.tenant_id AND package.company_id=reservation.company_id
    AND package.id=reservation.purchase_id
  JOIN fiscal.electronic_documents doc
    ON doc.tenant_id=reservation.tenant_id AND doc.company_id=reservation.company_id
    AND doc.id=reservation.document_id
  JOIN organization.companies company
    ON company.tenant_id=package.tenant_id AND company.id=package.company_id
    AND company.tax_id_normalized=package.tax_id
  WHERE reservation.purchase_id=p_purchase AND reservation.state='RESERVED'
    AND (p_after_document IS NULL OR doc.id>p_after_document)
  ORDER BY doc.id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
$body$;
REVOKE ALL ON FUNCTION fiscal.pending_document_package_reconciliation(uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fiscal.pending_document_package_reconciliation(uuid,uuid,integer) TO pos_platform_app;
