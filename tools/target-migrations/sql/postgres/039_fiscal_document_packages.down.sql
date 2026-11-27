BEGIN;
ALTER TABLE fiscal.document_package_purchases NO FORCE ROW LEVEL SECURITY;
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM fiscal.document_package_purchases) THEN
    RAISE EXCEPTION 'FISCAL_PACKAGE_HISTORY_REQUIRES_FORWARD_MIGRATION';
  END IF;
END;
$guard$;
DROP POLICY fiscal_package_owner_company_evidence ON organization.companies;
DROP POLICY fiscal_package_owner_document_evidence ON fiscal.electronic_documents;
DROP FUNCTION fiscal.apply_document_package_movement(uuid,uuid,uuid,text);
DROP VIEW fiscal.document_package_balances;
DROP TABLE fiscal.document_package_alerts, fiscal.document_package_movements,
  fiscal.document_package_reservations, fiscal.document_package_purchases;
DROP FUNCTION fiscal.check_document_package_holder();
DROP TABLE fiscal.document_package_offers;

COMMIT;
