-- QR-002: SMS-reported figures; NEVER bank-authenticated settlement amounts.
-- Additive successor to 025. Never rewrite an applied migration or its checksum.
ALTER TABLE payments.merchant_payment_notification_inbox
 ADD COLUMN reported_amount_cop bigint NULL,
 ADD COLUMN payer_display text NULL,
 ADD CONSTRAINT merchant_notice_reported_amount_positive
   CHECK(reported_amount_cop IS NULL OR reported_amount_cop BETWEEN 1 AND 100000000),
 ADD CONSTRAINT merchant_notice_payer_display_size
   CHECK(payer_display IS NULL OR char_length(payer_display) BETWEEN 2 AND 80);
-- Values remain immutable and tenant-forced under existing 025 guards and RLS.
COMMENT ON COLUMN payments.merchant_payment_notification_inbox.reported_amount_cop
 IS 'COP amount asserted in unverified SMS, not confirmed settlement or POS requested amount';
COMMENT ON COLUMN payments.merchant_payment_notification_inbox.payer_display
 IS 'Optional claimed payer name or masked contact from SMS, not bank-verified identity';
