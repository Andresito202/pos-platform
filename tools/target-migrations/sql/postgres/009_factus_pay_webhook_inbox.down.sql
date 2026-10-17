DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM integrations.factus_pay_webhook_inbox)
     OR EXISTS (SELECT 1 FROM integrations.factus_pay_webhook_keys) THEN
    RAISE EXCEPTION '009 down refused: Factus Pay webhook key or inbox history exists; export evidence and reconcile before rollback';
  END IF;
END
$$;

DROP TABLE integrations.factus_pay_webhook_inbox;
DROP TABLE integrations.factus_pay_webhook_keys;
