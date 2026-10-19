-- Destructive rollback is forbidden while challenge rows remain, including
-- consumed rows retained for security evidence.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM identity.webauthn_challenges LIMIT 1) THEN
    RAISE EXCEPTION '009 rollback refused: WebAuthn challenge evidence exists';
  END IF;
END
$$;

DROP TABLE identity.webauthn_challenges;
DROP FUNCTION identity.webauthn_challenge_consume_guard();
