DO $guard$ BEGIN
  IF current_database() !~ '^pos_business_session_test_[0-9a-f]{16}$' THEN
    RAISE EXCEPTION 'SAS read lock requires disposable database';
  END IF;
END $guard$;
DROP FUNCTION "authorization".lock_sas_sources_for_read();
