-- Canonical identity-owned HTTP session custody. No credentials in cleartext.
CREATE TABLE identity.browser_session_handoffs (
  handoff_hash text PRIMARY KEY CHECK (handoff_hash ~ '^[0-9a-f]{64}$'),
  session_id uuid NOT NULL UNIQUE REFERENCES identity.sessions(id) ON DELETE NO ACTION,
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE NO ACTION,
  tenant_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  challenge_id uuid NOT NULL REFERENCES identity.webauthn_challenges(id) ON DELETE NO ACTION,
  password_credential_id uuid NOT NULL REFERENCES identity.user_credentials(id) ON DELETE NO ACTION,
  password_credential_version bigint NOT NULL CHECK(password_credential_version>0),
  factor_id uuid NOT NULL REFERENCES identity.mfa_factors(id) ON DELETE NO ACTION,
  origin text NOT NULL CHECK(origin ~ '^https://[^/]+$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NULL,
  CHECK(expires_at>created_at),
  CHECK(consumed_at IS NULL OR consumed_at>=created_at),
  FOREIGN KEY (tenant_id,session_id) REFERENCES identity.sessions(tenant_id,id) ON DELETE NO ACTION,
  FOREIGN KEY (tenant_id,membership_id) REFERENCES tenancy.tenant_memberships(tenant_id,id) ON DELETE NO ACTION
);
CREATE TABLE identity.browser_sessions (
  cookie_hash text PRIMARY KEY CHECK(cookie_hash ~ '^[0-9a-f]{64}$'),
  csrf_hash text NOT NULL CHECK(csrf_hash ~ '^[0-9a-f]{64}$'),
  handoff_hash text NOT NULL REFERENCES identity.browser_session_handoffs(handoff_hash) ON DELETE NO ACTION,
  session_id uuid NOT NULL REFERENCES identity.sessions(id) ON DELETE NO ACTION,
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE NO ACTION,
  tenant_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  origin text NOT NULL CHECK(origin ~ '^https://[^/]+$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz NULL,
  CHECK(expires_at>created_at),
  CHECK(last_used_at>=created_at),
  CHECK(revoked_at IS NULL OR revoked_at>=created_at),
  FOREIGN KEY (tenant_id,session_id) REFERENCES identity.sessions(tenant_id,id) ON DELETE NO ACTION,
  FOREIGN KEY (tenant_id,membership_id) REFERENCES tenancy.tenant_memberships(tenant_id,id) ON DELETE NO ACTION
);
CREATE INDEX browser_sessions_session_idx ON identity.browser_sessions(session_id);
ALTER TABLE identity.browser_session_handoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.browser_session_handoffs FORCE ROW LEVEL SECURITY;
ALTER TABLE identity.browser_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.browser_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY browser_handoffs_central ON identity.browser_session_handoffs FOR ALL TO pos_platform_app USING(true) WITH CHECK(true);
CREATE POLICY browser_sessions_central ON identity.browser_sessions FOR ALL TO pos_platform_app USING(true) WITH CHECK(true);
CREATE POLICY browser_handoffs_owner ON identity.browser_session_handoffs FOR SELECT TO pos_schema_owner USING(true);
CREATE POLICY browser_sessions_owner ON identity.browser_sessions FOR SELECT TO pos_schema_owner USING(true);
REVOKE ALL ON identity.browser_session_handoffs,identity.browser_sessions FROM PUBLIC,pos_app,pos_worker,pos_platform_admin;
GRANT SELECT,INSERT ON identity.browser_session_handoffs,identity.browser_sessions TO pos_platform_app;
GRANT UPDATE(consumed_at) ON identity.browser_session_handoffs TO pos_platform_app;
GRANT UPDATE(last_used_at,revoked_at) ON identity.browser_sessions TO pos_platform_app;

CREATE FUNCTION identity.guard_browser_session_history() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $guard$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'browser session history cannot be deleted'; END IF;
  IF TG_TABLE_NAME='browser_session_handoffs' THEN
    IF (to_jsonb(NEW)-'consumed_at') IS DISTINCT FROM (to_jsonb(OLD)-'consumed_at')
      OR OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL THEN
      RAISE EXCEPTION 'browser handoff cannot be replaced or reused';
    END IF;
  ELSE
    IF (to_jsonb(NEW)-'last_used_at'-'revoked_at') IS DISTINCT FROM (to_jsonb(OLD)-'last_used_at'-'revoked_at')
      OR OLD.revoked_at IS NOT NULL OR NEW.last_used_at<OLD.last_used_at THEN
      RAISE EXCEPTION 'browser session cannot be replaced or revived';
    END IF;
  END IF;
  RETURN NEW;
END;
$guard$;
CREATE TRIGGER browser_handoff_history_guard BEFORE UPDATE OR DELETE ON identity.browser_session_handoffs
FOR EACH ROW EXECUTE FUNCTION identity.guard_browser_session_history();
CREATE TRIGGER browser_session_history_guard BEFORE UPDATE OR DELETE ON identity.browser_sessions
FOR EACH ROW EXECUTE FUNCTION identity.guard_browser_session_history();
REVOKE ALL ON FUNCTION identity.guard_browser_session_history() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.guard_browser_session_history() TO pos_platform_app;
