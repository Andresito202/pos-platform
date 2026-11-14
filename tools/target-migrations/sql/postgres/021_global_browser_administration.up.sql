-- Owner approval 2026-10-27: separate GLOBAL ceremony, canonical identity custody.
ALTER TABLE identity.webauthn_challenges DROP CONSTRAINT webauthn_challenges_purpose_ck;
ALTER TABLE identity.webauthn_challenges ADD CONSTRAINT webauthn_challenges_purpose_ck
  CHECK(purpose IN ('ENROLL','AUTHENTICATE','GLOBAL_AUTHENTICATE','REAUTHENTICATE','RECOVERY_APPROVAL'));
ALTER TABLE identity.webauthn_challenges ADD CONSTRAINT global_authenticate_session_ck CHECK(purpose<>'GLOBAL_AUTHENTICATE' OR session_id IS NULL);
ALTER TABLE identity.browser_session_handoffs ALTER COLUMN tenant_id DROP NOT NULL, ALTER COLUMN membership_id DROP NOT NULL;
ALTER TABLE identity.browser_sessions ALTER COLUMN tenant_id DROP NOT NULL, ALTER COLUMN membership_id DROP NOT NULL;
ALTER TABLE identity.browser_session_handoffs ADD CONSTRAINT browser_handoff_scope_pair_ck CHECK((tenant_id IS NULL)=(membership_id IS NULL));
ALTER TABLE identity.browser_sessions ADD CONSTRAINT browser_session_scope_pair_ck CHECK((tenant_id IS NULL)=(membership_id IS NULL));
CREATE FUNCTION identity.guard_browser_insert_scope() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM identity.sessions s WHERE s.id=NEW.session_id AND s.user_id=NEW.user_id
    AND s.tenant_id IS NOT DISTINCT FROM NEW.tenant_id AND s.tenant_membership_id IS NOT DISTINCT FROM NEW.membership_id AND s.device_id IS NULL)
    THEN RAISE EXCEPTION 'browser session identity scope mismatch'; END IF;
  IF TG_TABLE_NAME='browser_session_handoffs' THEN
    IF NOT EXISTS(SELECT 1 FROM identity.webauthn_challenges w WHERE w.id=NEW.challenge_id AND w.user_id=NEW.user_id AND w.factor_id=NEW.factor_id
      AND w.session_id IS NULL AND w.consumed_at IS NOT NULL AND w.expected_origin=NEW.origin
      AND w.purpose=CASE WHEN NEW.tenant_id IS NULL THEN 'GLOBAL_AUTHENTICATE' ELSE 'AUTHENTICATE' END)
      THEN RAISE EXCEPTION 'browser session MFA purpose mismatch'; END IF;
  ELSE
    IF NOT EXISTS(SELECT 1 FROM identity.browser_session_handoffs h WHERE h.handoff_hash=NEW.handoff_hash AND h.session_id=NEW.session_id
      AND h.user_id=NEW.user_id AND h.tenant_id IS NOT DISTINCT FROM NEW.tenant_id AND h.membership_id IS NOT DISTINCT FROM NEW.membership_id
      AND h.origin=NEW.origin AND h.consumed_at IS NOT NULL)
      THEN RAISE EXCEPTION 'browser session handoff scope mismatch'; END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION identity.guard_browser_insert_scope() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.guard_browser_insert_scope() TO pos_platform_app;
CREATE TRIGGER browser_handoff_insert_scope BEFORE INSERT ON identity.browser_session_handoffs FOR EACH ROW EXECUTE FUNCTION identity.guard_browser_insert_scope();
CREATE TRIGGER browser_session_insert_scope BEFORE INSERT ON identity.browser_sessions FOR EACH ROW EXECUTE FUNCTION identity.guard_browser_insert_scope();
CREATE INDEX global_login_budget_idx ON identity.security_events(reason_code,evidence_checksum,server_recorded_at)
  WHERE reason_code IN ('GLOBAL_LOGIN_ACCOUNT','GLOBAL_LOGIN_ADDRESS');
-- Same approved bounded SHARE protocol, explicitly GLOBAL (no fake tenant).
CREATE FUNCTION "authorization".lock_platform_sources_for_read() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF session_user<>'pos_platform_app' OR platform.current_tenant_id() IS NOT NULL THEN
    RAISE EXCEPTION 'GLOBAL trusted central context required'; END IF;
  IF current_setting('lock_timeout')='0' THEN RAISE EXCEPTION 'GLOBAL explicit lock_timeout required'; END IF;
  LOCK TABLE "authorization".roles,"authorization".permissions,"authorization".role_permission_grants,
    "authorization".platform_role_assignments IN SHARE MODE;
END $$;
ALTER FUNCTION "authorization".lock_platform_sources_for_read() OWNER TO pos_schema_owner;
REVOKE ALL ON FUNCTION "authorization".lock_platform_sources_for_read() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "authorization".lock_platform_sources_for_read() TO pos_platform_app;
