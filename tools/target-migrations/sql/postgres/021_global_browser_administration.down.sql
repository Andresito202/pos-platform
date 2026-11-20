DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM identity.webauthn_challenges WHERE purpose='GLOBAL_AUTHENTICATE')
    OR EXISTS(SELECT 1 FROM identity.browser_session_handoffs WHERE tenant_id IS NULL)
    OR EXISTS(SELECT 1 FROM identity.browser_sessions WHERE tenant_id IS NULL)
  THEN RAISE EXCEPTION '021 down refused: retained GLOBAL authentication history'; END IF;
END $$;
DROP TRIGGER browser_handoff_insert_scope ON identity.browser_session_handoffs;
DROP TRIGGER browser_session_insert_scope ON identity.browser_sessions;
DROP FUNCTION identity.guard_browser_insert_scope();
DROP INDEX identity.global_login_budget_idx;
DROP FUNCTION "authorization".lock_platform_sources_for_read();
ALTER TABLE identity.browser_session_handoffs DROP CONSTRAINT browser_handoff_scope_pair_ck, ALTER COLUMN tenant_id SET NOT NULL, ALTER COLUMN membership_id SET NOT NULL;
ALTER TABLE identity.browser_sessions DROP CONSTRAINT browser_session_scope_pair_ck, ALTER COLUMN tenant_id SET NOT NULL, ALTER COLUMN membership_id SET NOT NULL;
ALTER TABLE identity.webauthn_challenges DROP CONSTRAINT global_authenticate_session_ck, DROP CONSTRAINT webauthn_challenges_purpose_ck;
ALTER TABLE identity.webauthn_challenges ADD CONSTRAINT webauthn_challenges_purpose_ck CHECK(purpose IN ('ENROLL','AUTHENTICATE','REAUTHENTICATE','RECOVERY_APPROVAL'));
