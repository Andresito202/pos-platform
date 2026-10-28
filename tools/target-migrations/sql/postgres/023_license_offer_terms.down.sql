DO $$ BEGIN IF EXISTS(SELECT 1 FROM licensing.plans WHERE offer_profile='CAMACHO_LICENSE_OFFER_V2')
  THEN RAISE EXCEPTION 'Retained V2 pricing prevents rollback'; END IF; END $$;
ALTER TABLE licensing.plans DROP CONSTRAINT licensing_offer_complete_ck;
ALTER TABLE licensing.plans DROP COLUMN currency_exponent,DROP COLUMN support_term_months,DROP COLUMN publication_scope;
-- Restore the exact predecessor constraint, without editing its historical SQL.
ALTER TABLE licensing.plans ADD CONSTRAINT licensing_offer_complete_ck CHECK (
  (offer_profile IS NULL AND included_registers IS NULL AND additional_register_price_minor IS NULL AND support_price_minor IS NULL AND support_charge IS NULL AND offer_policy_reference IS NULL)
  OR(offer_profile IS NOT NULL AND offer_profile='CAMACHO_LICENSE_OFFER_V1' AND included_registers IS NOT NULL AND included_registers=1
    AND price_minor<=9007199254740991 AND additional_register_price_minor IS NOT NULL AND additional_register_price_minor>=0
    AND support_price_minor IS NOT NULL AND support_price_minor BETWEEN 0 AND 9007199254740991 AND additional_register_price_minor<=9007199254740991
    AND support_charge IS NOT NULL AND support_charge='OPTIONAL_SAME_TERM' AND offer_policy_reference IS NOT NULL AND btrim(offer_policy_reference)<>''));
