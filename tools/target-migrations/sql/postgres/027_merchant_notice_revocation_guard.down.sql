-- Do not restore the old guard while existing consents may require
-- revocation after their devices become inactive.
DO $guard$ BEGIN
 IF EXISTS (SELECT 1 FROM payments.merchant_notification_bridge_consents) THEN
  RAISE EXCEPTION 'QR-002 cannot downgrade consent revocation with existing evidence';
 END IF;
END $guard$;
CREATE OR REPLACE FUNCTION payments.guard_merchant_notice_consent()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $guard$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.tenant_id,NEW.company_id,NEW.installation_id,NEW.granted_by,NEW.granted_at)
    IS DISTINCT FROM
    ROW(OLD.tenant_id,OLD.company_id,OLD.installation_id,OLD.granted_by,OLD.granted_at)
    OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL THEN
    RAISE EXCEPTION 'merchant notice consent cannot be modified or regranted';
  END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM identity.device_registry d
     WHERE d.installation_id=NEW.installation_id
       AND d.tenant_id=NEW.tenant_id AND d.company_id=NEW.company_id
       AND d.status='ACTIVE') THEN
    RAISE EXCEPTION 'merchant notice consent device not active for company';
 END IF;
 RETURN NEW;
END $guard$;
REVOKE ALL ON FUNCTION payments.guard_merchant_notice_consent() FROM PUBLIC;
