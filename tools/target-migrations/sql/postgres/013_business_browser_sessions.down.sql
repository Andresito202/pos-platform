DO $guard$ BEGIN
  IF EXISTS(SELECT 1 FROM identity.browser_sessions) OR EXISTS(SELECT 1 FROM identity.browser_session_handoffs) THEN
    RAISE EXCEPTION '013 rollback refused: browser session history exists';
  END IF;
END $guard$;
DROP TABLE identity.browser_sessions;
DROP TABLE identity.browser_session_handoffs;
DROP FUNCTION identity.guard_browser_session_history();
