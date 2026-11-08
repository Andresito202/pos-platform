-- QR-002: allow security revocation after a device is already inactive.
-- Additive successor to 026. Do not alter migration 025 or its checksum.
-- Ingest still requires an ACTIVE device and an unrevoked consent row.
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
  -- A one-way revocation must remain possible even if the device has
  -- already been disabled. An UPDATE can never grant or refresh consent.
  RETURN NEW;
 END IF;
 -- Consent creation still needs the ACTIVE matching device.
 IF NOT EXISTS(SELECT 1 FROM identity.device_registry d
    WHERE d.installation_id=NEW.installation_id
      AND d.tenant_id=NEW.tenant_id AND d.company_id=NEW.company_id
      AND d.status='ACTIVE') THEN
  RAISE EXCEPTION 'merchant notice consent device not active for company';
 END IF;
 RETURN NEW;
END $guard$;
REVOKE ALL ON FUNCTION payments.guard_merchant_notice_consent() FROM PUBLIC;
