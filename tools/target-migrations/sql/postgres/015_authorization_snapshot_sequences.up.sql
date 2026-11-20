CREATE TABLE "authorization".snapshot_sequences (
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE NO ACTION,
  installation_id uuid NOT NULL,
  device_id uuid NOT NULL REFERENCES identity.device_registry(device_id) ON DELETE NO ACTION,
  last_issued_sequence bigint NOT NULL CHECK (last_issued_sequence BETWEEN 1 AND 9007199254740991),
  snapshot_id uuid NOT NULL CHECK (platform.is_uuid_v7(snapshot_id)),
  source_checksum text NOT NULL CHECK (source_checksum ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (user_id, installation_id, device_id),
  CHECK (updated_at >= created_at)
);

CREATE FUNCTION "authorization".guard_snapshot_sequences()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'SAS watermark cannot be deleted'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.last_issued_sequence <> 1 THEN RAISE EXCEPTION 'SAS sequence must start at one'; END IF;
    IF NOT EXISTS (SELECT 1 FROM identity.device_registry d
      WHERE d.device_id = NEW.device_id AND d.installation_id = NEW.installation_id) THEN
      RAISE EXCEPTION 'SAS installation/device mismatch';
    END IF;
  ELSE
    IF ROW(NEW.user_id, NEW.installation_id, NEW.device_id, NEW.created_at)
      IS DISTINCT FROM ROW(OLD.user_id, OLD.installation_id, OLD.device_id, OLD.created_at)
      OR OLD.last_issued_sequence >= 9007199254740991
      OR NEW.last_issued_sequence <> OLD.last_issued_sequence + 1
      OR NEW.snapshot_id = OLD.snapshot_id OR NEW.updated_at < OLD.updated_at THEN
      RAISE EXCEPTION 'SAS requires exact +1 and immutable binding';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER snapshot_sequences_guard BEFORE INSERT OR UPDATE OR DELETE
ON "authorization".snapshot_sequences FOR EACH ROW EXECUTE FUNCTION "authorization".guard_snapshot_sequences();
ALTER TABLE "authorization".snapshot_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE "authorization".snapshot_sequences FORCE ROW LEVEL SECURITY;
CREATE POLICY snapshot_sequences_central ON "authorization".snapshot_sequences
  FOR ALL TO pos_platform_app USING (true) WITH CHECK (true);
CREATE POLICY snapshot_sequences_owner ON "authorization".snapshot_sequences
  FOR SELECT TO pos_schema_owner USING (true);
REVOKE ALL ON "authorization".snapshot_sequences FROM PUBLIC, pos_app, pos_worker, pos_platform_admin;
REVOKE ALL ON FUNCTION "authorization".guard_snapshot_sequences() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "authorization".guard_snapshot_sequences() TO pos_platform_app;
GRANT SELECT, INSERT ON "authorization".snapshot_sequences TO pos_platform_app;
GRANT UPDATE (last_issued_sequence, snapshot_id, source_checksum, updated_at)
  ON "authorization".snapshot_sequences TO pos_platform_app;

CREATE FUNCTION "authorization".lock_sas_sources_for_read()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $function$
BEGIN
  IF session_user <> 'pos_platform_app' OR platform.current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'SAS trusted central tenant context required';
  END IF;
  IF current_setting('lock_timeout') = '0' THEN
    RAISE EXCEPTION 'SAS explicit nonzero lock_timeout required';
  END IF;
  LOCK TABLE "authorization".roles, "authorization".permissions,
    "authorization".role_permission_grants, "authorization".user_role_assignments
    IN SHARE MODE;
END;
$function$;
ALTER FUNCTION "authorization".lock_sas_sources_for_read() OWNER TO pos_schema_owner;
REVOKE ALL ON FUNCTION "authorization".lock_sas_sources_for_read() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "authorization".lock_sas_sources_for_read() TO pos_platform_app;
