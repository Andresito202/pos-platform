DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM subscriptions.license_fulfillment_jobs) THEN
    RAISE EXCEPTION '035 down refused: retained subscription fulfillment history';
  END IF;
END $$;
DROP TABLE subscriptions.license_fulfillment_jobs;
