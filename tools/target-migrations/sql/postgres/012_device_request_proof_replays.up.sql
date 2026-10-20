-- D3 device request proof replay ledger; the Ed25519 proof is verified by
-- the central server, this table atomically consumes its nonce and request id.
-- No authenticated user session or SSA is conferred by a consumed nonce.
CREATE TABLE identity.device_request_proof_replays (
  credential_id uuid NOT NULL REFERENCES identity.device_credentials(credential_id) ON DELETE NO ACTION,
  nonce_sha256 text NOT NULL CONSTRAINT device_request_replay_nonce_ck
    CHECK (nonce_sha256 ~ '^[0-9a-f]{64}$'),
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  signed_at timestamptz NOT NULL,
  consumed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT device_request_proof_replays_pk PRIMARY KEY (credential_id, nonce_sha256),
  CONSTRAINT device_request_proof_replays_request_uq UNIQUE (credential_id, request_id),
  CONSTRAINT device_request_replay_timestamp_ck
    CHECK (signed_at > '-infinity'::timestamptz AND consumed_at >= signed_at - INTERVAL '2 minutes')
);

-- Immutable, never delete consumed nonces: no replay after a restart.
CREATE FUNCTION identity.guard_device_request_proof_replay()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $guard$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'consumed device request proof cannot be changed or deleted';
  END IF;
  RETURN NEW;
END;
$guard$;

CREATE TRIGGER device_request_proof_replay_guard
BEFORE INSERT OR UPDATE OR DELETE ON identity.device_request_proof_replays
FOR EACH ROW EXECUTE FUNCTION identity.guard_device_request_proof_replay();

ALTER TABLE identity.device_request_proof_replays ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.device_request_proof_replays FORCE ROW LEVEL SECURITY;
CREATE POLICY device_request_proof_replays_central_only ON identity.device_request_proof_replays
  FOR ALL TO pos_platform_app USING (true) WITH CHECK (true);
CREATE POLICY device_request_proof_replays_owner_inspect ON identity.device_request_proof_replays
  FOR SELECT TO pos_schema_owner USING (true);

REVOKE ALL ON identity.device_request_proof_replays
  FROM PUBLIC, pos_app, pos_worker, pos_platform_admin;
REVOKE ALL ON FUNCTION identity.guard_device_request_proof_replay() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.guard_device_request_proof_replay() TO pos_platform_app;
GRANT SELECT, INSERT ON identity.device_request_proof_replays TO pos_platform_app;
