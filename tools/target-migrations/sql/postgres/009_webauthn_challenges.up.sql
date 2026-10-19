-- D3-R5.2: durable one-use WebAuthn challenges ONLY.
-- Does not create users, MFA factors, public keys, credentials or sessions.
-- No challenge plaintext is retained; use SHA-256 over 32+ CSPRNG bytes.
CREATE TABLE identity.webauthn_challenges (
  id uuid PRIMARY KEY CONSTRAINT webauthn_challenges_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE NO ACTION,
  factor_id uuid NULL REFERENCES identity.mfa_factors(id) ON DELETE NO ACTION,
  session_id uuid NULL REFERENCES identity.sessions(id) ON DELETE NO ACTION,
  purpose text NOT NULL CONSTRAINT webauthn_challenges_purpose_ck
    CHECK (purpose IN ('ENROLL','AUTHENTICATE','REAUTHENTICATE','RECOVERY_APPROVAL')),
  challenge_hash text NOT NULL CONSTRAINT webauthn_challenges_hash_ck
    CHECK (challenge_hash ~ '^[0-9a-f]{64}$'),
  rp_id text NOT NULL CONSTRAINT webauthn_challenges_rp_id_ck
    CHECK (btrim(rp_id) <> ''),
  expected_origin text NOT NULL CONSTRAINT webauthn_challenges_origin_ck
    CHECK (btrim(expected_origin) <> ''),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NULL,
  correlation_id uuid NOT NULL CONSTRAINT webauthn_challenges_correlation_v7_ck
    CHECK (platform.is_uuid_v7(correlation_id)),
  version bigint NOT NULL DEFAULT 1 CONSTRAINT webauthn_challenges_version_ck
    CHECK (version >= 1),
  CONSTRAINT webauthn_challenges_timestamps_ck
    CHECK (expires_at > issued_at AND (consumed_at IS NULL OR consumed_at >= issued_at)),
  CONSTRAINT webauthn_challenges_unique_hash UNIQUE (challenge_hash)
);

CREATE INDEX webauthn_challenges_pending_idx
  ON identity.webauthn_challenges(user_id, purpose, expires_at)
  WHERE consumed_at IS NULL;

ALTER TABLE identity.webauthn_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.webauthn_challenges FORCE ROW LEVEL SECURITY;

CREATE POLICY webauthn_challenges_central_only
  ON identity.webauthn_challenges FOR ALL TO pos_platform_app
  USING (true) WITH CHECK (true);

REVOKE ALL ON identity.webauthn_challenges FROM PUBLIC, pos_app, pos_worker, pos_platform_admin;
GRANT SELECT ON identity.webauthn_challenges TO pos_platform_app;
GRANT INSERT (id, user_id, factor_id, session_id, purpose, challenge_hash,
              rp_id, expected_origin, issued_at, expires_at, correlation_id)
  ON identity.webauthn_challenges TO pos_platform_app;
GRANT UPDATE (consumed_at, version) ON identity.webauthn_challenges TO pos_platform_app;
