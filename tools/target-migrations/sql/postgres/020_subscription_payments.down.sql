DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM payments.payment_groups) OR EXISTS(SELECT 1 FROM payments.payments)
    OR EXISTS(SELECT 1 FROM payments.payment_attempts) OR EXISTS(SELECT 1 FROM payments.payment_allocations)
  THEN RAISE EXCEPTION '020 down refused: retained payment history'; END IF;
END $$;
DROP TABLE payments.payment_allocations,payments.payment_attempts,payments.payments,payments.payment_groups;
DROP FUNCTION payments.guard_subscription_sources();
DROP SCHEMA payments;
