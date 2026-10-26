DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM "authorization".snapshot_sequences LIMIT 1) THEN
    RAISE EXCEPTION 'SAS rollback refused: watermarks exist';
  END IF;
END;
$guard$;
DROP FUNCTION "authorization".lock_sas_sources_for_read();
DROP TABLE "authorization".snapshot_sequences;
DROP FUNCTION "authorization".guard_snapshot_sequences();

