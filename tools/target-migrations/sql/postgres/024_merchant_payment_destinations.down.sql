-- QR-001 down is not exposed as an operational command. Only the
-- canonical migration lifecycle may roll back an empty, unprovisioned schema.
-- Refuse to delete real merchant data by requiring every owned table empty.
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM payments.merchant_destination_acknowledgements)
 OR EXISTS(SELECT 1 FROM payments.merchant_destination_sequences)
 OR EXISTS(SELECT 1 FROM payments.merchant_destination_outbox)
 OR EXISTS(SELECT 1 FROM payments.merchant_destination_events)
 OR EXISTS(SELECT 1 FROM payments.merchant_destinations)
 OR EXISTS(SELECT 1 FROM payments.merchant_qr_assets)
 THEN RAISE EXCEPTION 'merchant destinations contain data; cannot downgrade'; END IF;
END $guard$;

DROP TABLE payments.merchant_destination_acknowledgements;
DROP TABLE payments.merchant_destination_sequences;
DROP TABLE payments.merchant_destination_outbox;
DROP TABLE payments.merchant_destination_events;
DROP TABLE payments.merchant_destinations;
DROP TABLE payments.merchant_qr_assets;
DROP FUNCTION payments.guard_merchant_ack_identity();
DROP FUNCTION payments.guard_merchant_destination_insert();
DROP FUNCTION payments.guard_merchant_monotonic_sequence();
DROP FUNCTION payments.guard_merchant_destination_transition();
