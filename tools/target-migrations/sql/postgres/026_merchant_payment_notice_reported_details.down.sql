-- Preserve all notification evidence. Never drop columns with recorded values.
DO $guard$ BEGIN
 IF EXISTS (SELECT 1 FROM payments.merchant_payment_notification_inbox
            WHERE reported_amount_cop IS NOT NULL OR payer_display IS NOT NULL) THEN
  RAISE EXCEPTION 'QR-002 cannot downgrade reported SMS evidence';
 END IF;
END $guard$;
ALTER TABLE payments.merchant_payment_notification_inbox
 DROP CONSTRAINT merchant_notice_reported_amount_positive,
 DROP CONSTRAINT merchant_notice_payer_display_size,
 DROP COLUMN reported_amount_cop,
 DROP COLUMN payer_display;
