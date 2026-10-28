DO $$ BEGIN IF EXISTS(SELECT 1 FROM licensing.license_activations) OR EXISTS(SELECT 1 FROM licensing.trusted_signing_keys)
  THEN RAISE EXCEPTION 'Retained licensing trust/activation history prevents rollback'; END IF; END $$;
DROP TABLE licensing.license_activations;
DROP FUNCTION licensing.guard_license_activation();
DROP TABLE licensing.trusted_signing_keys;
