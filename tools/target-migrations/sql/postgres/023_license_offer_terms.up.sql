-- Additive successor: legacy prices retain their original unknown scale/profile.
ALTER TABLE licensing.plans ADD COLUMN currency_exponent integer,ADD COLUMN support_term_months integer,ADD COLUMN publication_scope text;
ALTER TABLE licensing.plans DROP CONSTRAINT licensing_offer_complete_ck;
ALTER TABLE licensing.plans ADD CONSTRAINT licensing_offer_complete_ck CHECK (
  (offer_profile IS NULL AND included_registers IS NULL AND additional_register_price_minor IS NULL AND support_price_minor IS NULL AND support_charge IS NULL AND offer_policy_reference IS NULL
    AND currency_exponent IS NULL AND support_term_months IS NULL AND publication_scope IS NULL)
  OR (offer_profile IN ('CAMACHO_LICENSE_OFFER_V1','CAMACHO_LICENSE_OFFER_V2') AND included_registers=1 AND included_registers IS NOT NULL
    AND price_minor BETWEEN 0 AND 9007199254740991 AND additional_register_price_minor BETWEEN 0 AND 9007199254740991
    AND support_price_minor BETWEEN 0 AND 9007199254740991 AND additional_register_price_minor IS NOT NULL AND support_price_minor IS NOT NULL
    AND offer_policy_reference IS NOT NULL AND btrim(offer_policy_reference)<>'' AND support_charge IS NOT NULL
    AND ((offer_profile='CAMACHO_LICENSE_OFFER_V1' AND support_charge='OPTIONAL_SAME_TERM' AND currency_exponent IS NULL AND support_term_months IS NULL AND publication_scope IS NULL)
      OR (offer_profile='CAMACHO_LICENSE_OFFER_V2' AND currency_code='COP' AND currency_exponent=2 AND currency_exponent IS NOT NULL
        AND publication_scope='PREPRODUCTION' AND publication_scope IS NOT NULL AND support_term_months IS NOT NULL
        AND ((billing_model='PERPETUAL' AND deployment_mode='LOCAL_PERPETUAL' AND support_charge='OPTIONAL_12_MONTHS' AND support_term_months=12)
          OR (billing_model IN ('MONTHLY','ANNUAL') AND deployment_mode='HYBRID' AND support_charge='OPTIONAL_SAME_TERM' AND support_term_months=CASE WHEN billing_model='MONTHLY' THEN 1 ELSE 12 END))))));
-- Existing immutable-version trigger covers new fields as part of to_jsonb(row).
