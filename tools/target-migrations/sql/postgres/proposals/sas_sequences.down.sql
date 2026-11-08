-- Review proposal only. Never erase committed receiver anti-replay evidence.
DO $guard$
BEGIN
  IF current_database() !~ '^pos_business_session_test_[0-9a-f]{16}$' THEN
    RAISE EXCEPTION 'SAS proposal requires disposable database';
  END IF;
  IF EXISTS (SELECT 1 FROM "authorization".snapshot_sequences LIMIT 1) THEN
    RAISE EXCEPTION 'SAS rollback refused: watermarks exist';
  END IF;
END;
$guard$;
DROP TABLE "authorization".snapshot_sequences;
DROP FUNCTION "authorization".guard_snapshot_sequences();
