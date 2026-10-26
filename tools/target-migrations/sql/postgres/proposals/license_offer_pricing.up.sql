-- Additive Licensing offer contract for isolated rehearsal. Not a production
-- runner registration. Existing licenses/plans receive no inferred price/capacity.
ALTER TABLE licensing.plans
  ADD COLUMN offer_profile text,
  ADD COLUMN included_registers integer,
  ADD COLUMN additional_register_price_minor bigint,
  ADD COLUMN support_price_minor bigint,
  ADD COLUMN support_charge text,
  ADD COLUMN offer_policy_reference text;
-- Forced RLS must not hide retained history from the schema-owner down guard.
CREATE POLICY licensing_offer_owner_history ON licensing.plans FOR SELECT TO pos_schema_owner USING(true);
ALTER TABLE licensing.plans ADD CONSTRAINT licensing_offer_complete_ck CHECK (
  (offer_profile IS NULL AND included_registers IS NULL AND additional_register_price_minor IS NULL AND support_price_minor IS NULL AND support_charge IS NULL AND offer_policy_reference IS NULL)
  OR(offer_profile='CAMACHO_LICENSE_OFFER_V1' AND included_registers IS NOT NULL AND included_registers=1
    AND additional_register_price_minor IS NOT NULL AND additional_register_price_minor>=0
    AND support_price_minor IS NOT NULL AND support_price_minor>=0
    AND support_charge IS NOT NULL AND support_charge='OPTIONAL_SAME_TERM'
    AND offer_policy_reference IS NOT NULL AND btrim(offer_policy_reference)<>''));
CREATE FUNCTION licensing.guard_offer_version() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $body$
BEGIN
  IF OLD.offer_profile IS NOT NULL AND (TG_OP='DELETE' OR
    (to_jsonb(NEW)-ARRAY['status','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','updated_at'])) THEN
    RAISE EXCEPTION 'Offer price version is immutable';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF OLD.offer_profile IS NOT NULL AND (NEW.updated_at<OLD.updated_at OR
    NOT(NEW.status=OLD.status OR OLD.status='DRAFT' AND NEW.status='ACTIVE' OR OLD.status='ACTIVE' AND NEW.status='RETIRED')) THEN
    RAISE EXCEPTION 'Offer status transition rejected';
  END IF;
  RETURN NEW;
END;
$body$;
CREATE TRIGGER licensing_offer_version_guard BEFORE UPDATE OR DELETE ON licensing.plans FOR EACH ROW EXECUTE FUNCTION licensing.guard_offer_version();
REVOKE ALL ON FUNCTION licensing.guard_offer_version() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION licensing.guard_offer_version() TO pos_platform_app;
