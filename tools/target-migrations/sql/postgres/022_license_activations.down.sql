DO $$ BEGIN IF EXISTS(SELECT 1 FROM licensing.license_activations) OR EXISTS(SELECT 1 FROM licensing.trusted_signing_keys)
  THEN RAISE EXCEPTION 'Retained licensing trust/activation history prevents rollback'; END IF; END $$;
DROP TABLE licensing.license_revocations;
DROP FUNCTION licensing.guard_license_revocation();
DROP TABLE licensing.license_activations;
DROP FUNCTION licensing.guard_license_activation();
DROP FUNCTION licensing.lock_active_signing_key(text,text);
DROP TABLE licensing.trusted_signing_keys;
