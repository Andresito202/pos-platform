-- A used nonce is retained security evidence; destructive rollback is refused.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM identity.device_request_proof_replays LIMIT 1) THEN
    RAISE EXCEPTION '012 rollback refused: consumed device request proofs exist';
  END IF;
END
$$;
DROP TABLE identity.device_request_proof_replays;
DROP FUNCTION identity.guard_device_request_proof_replay();
