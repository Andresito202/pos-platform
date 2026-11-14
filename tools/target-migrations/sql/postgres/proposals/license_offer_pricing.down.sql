DO $body$ BEGIN
  IF EXISTS(SELECT 1 FROM licensing.plans WHERE offer_profile IS NOT NULL) THEN RAISE EXCEPTION 'Offer history must be retained'; END IF;
END $body$;
DROP TRIGGER licensing_offer_version_guard ON licensing.plans;
DROP FUNCTION licensing.guard_offer_version();
DROP POLICY licensing_offer_owner_history ON licensing.plans;
ALTER TABLE licensing.plans DROP CONSTRAINT licensing_offer_complete_ck,
  DROP COLUMN offer_profile,DROP COLUMN included_registers,DROP COLUMN additional_register_price_minor,
  DROP COLUMN support_price_minor,DROP COLUMN support_charge,DROP COLUMN offer_policy_reference;
