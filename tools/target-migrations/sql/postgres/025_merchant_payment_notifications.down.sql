-- QR-002: No destructive downgrade while business evidence/consent exists.
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM payments.merchant_payment_notification_inbox)
    OR EXISTS(SELECT 1 FROM payments.merchant_notification_bridge_consents) THEN
  RAISE EXCEPTION 'QR-002 cannot downgrade: merchant notification evidence or consent exists';
 END IF;
END $guard$;
DROP TABLE payments.merchant_payment_notification_inbox;
DROP TABLE payments.merchant_notification_bridge_consents;
DROP FUNCTION payments.guard_merchant_notice_intake();
DROP FUNCTION payments.guard_merchant_notice_consent();
