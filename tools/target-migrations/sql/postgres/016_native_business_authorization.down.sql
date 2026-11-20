DO $guard$ BEGIN
  IF EXISTS(SELECT 1 FROM identity.native_authorization_codes) OR EXISTS(SELECT 1 FROM identity.native_authorization_requests) THEN
    RAISE EXCEPTION 'Cannot discard native authorization replay history';
  END IF;
END; $guard$;
DROP TABLE identity.native_authorization_codes,identity.native_authorization_requests;
DROP FUNCTION identity.guard_native_authorization_history();
