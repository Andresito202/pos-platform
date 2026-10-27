DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM subscriptions.license_quotes) THEN RAISE EXCEPTION '019 down refused: retained subscription quotes'; END IF;
END $$;
DROP TABLE subscriptions.license_quotes;
DROP SCHEMA subscriptions;
