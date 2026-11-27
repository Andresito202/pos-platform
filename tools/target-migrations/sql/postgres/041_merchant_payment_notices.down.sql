BEGIN;
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM payments.merchant_payment_notification_inbox)
     OR EXISTS (SELECT 1 FROM payments.merchant_notification_bridge_consents)
  THEN
    RAISE EXCEPTION 'MERCHANT_NOTICE_HISTORY_REQUIRES_FORWARD_MIGRATION';
  END IF;
END;
$guard$;
DROP TABLE payments.merchant_payment_notification_inbox, payments.merchant_notification_bridge_consents;
DROP FUNCTION payments.guard_merchant_notice_intake();
DROP FUNCTION payments.guard_merchant_notice_consent();
COMMIT;
