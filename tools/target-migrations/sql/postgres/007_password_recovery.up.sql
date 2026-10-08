CREATE TABLE identity.password_recovery_requests (
  id uuid PRIMARY KEY CONSTRAINT password_recovery_requests_id_v7_ck CHECK (platform.is_uuid_v7(id)),
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE NO ACTION,
  token_hash text NOT NULL CONSTRAINT password_recovery_requests_token_hash_ck CHECK (btrim(token_hash) <> ''),
  channel text NOT NULL CONSTRAINT password_recovery_requests_channel_ck CHECK (channel = 'EMAIL'),
  status text NOT NULL CONSTRAINT password_recovery_requests_status_ck CHECK (status IN ('REQUESTED','VERIFIED','CONSUMED','EXPIRED','LOCKED')),
  requested_by_actor_type text NOT NULL CONSTRAINT password_recovery_requests_actor_type_ck CHECK (requested_by_actor_type IN ('USER','PLATFORM_ACCOUNT','SYSTEM')),
  requested_by_actor_id uuid NULL,
  support_verified boolean NOT NULL DEFAULT false,
  attempt_count integer NOT NULL DEFAULT 0 CONSTRAINT password_recovery_requests_attempts_ck CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CONSTRAINT password_recovery_requests_max_attempts_ck CHECK (max_attempts BETWEEN 1 AND 20),
  requested_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  verified_at timestamptz NULL,
  consumed_at timestamptz NULL,
  last_sent_at timestamptz NULL,
  correlation_id uuid NOT NULL CONSTRAINT password_recovery_requests_correlation_v7_ck CHECK (platform.is_uuid_v7(correlation_id)),
  version bigint NOT NULL DEFAULT 1 CONSTRAINT password_recovery_requests_version_ck CHECK (version >= 1),
  CONSTRAINT password_recovery_requests_actor_ck CHECK (
    (requested_by_actor_type = 'SYSTEM' AND requested_by_actor_id IS NULL)
    OR (requested_by_actor_type <> 'SYSTEM' AND requested_by_actor_id IS NOT NULL)
  ),
  CONSTRAINT password_recovery_requests_expiry_ck CHECK (expires_at > requested_at),
  CONSTRAINT password_recovery_requests_verified_ck CHECK (
    (status IN ('VERIFIED','CONSUMED') AND verified_at IS NOT NULL)
    OR status IN ('REQUESTED','EXPIRED','LOCKED')
  ),
  CONSTRAINT password_recovery_requests_consumed_ck CHECK (
    (status = 'CONSUMED' AND consumed_at IS NOT NULL) OR status <> 'CONSUMED'
  )
);

CREATE UNIQUE INDEX password_recovery_requests_active_user_uq
  ON identity.password_recovery_requests(user_id)
  WHERE status IN ('REQUESTED','VERIFIED');

CREATE INDEX password_recovery_requests_token_hash_idx
  ON identity.password_recovery_requests(token_hash);

CREATE INDEX password_recovery_requests_user_requested_idx
  ON identity.password_recovery_requests(user_id, requested_at DESC);

ALTER TABLE identity.password_recovery_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.password_recovery_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY password_recovery_requests_platform_only
  ON identity.password_recovery_requests FOR ALL TO pos_platform_app, pos_platform_admin
  USING (true) WITH CHECK (true);

REVOKE ALL ON identity.password_recovery_requests FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON identity.password_recovery_requests TO pos_platform_app;
GRANT SELECT, INSERT, UPDATE ON identity.password_recovery_requests TO pos_platform_admin;
