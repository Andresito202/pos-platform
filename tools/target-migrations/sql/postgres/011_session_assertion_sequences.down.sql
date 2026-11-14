-- A committed watermark is anti-replay evidence, even if a session expired.
-- Never destroy counters once any sequence has been reserved.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM identity.session_assertion_sequences LIMIT 1) THEN
    RAISE EXCEPTION '011 rollback refused: SSA sequence watermarks exist';
  END IF;
END
$$;

DROP TABLE identity.session_assertion_sequences;
DROP FUNCTION identity.guard_session_assertion_sequences();
