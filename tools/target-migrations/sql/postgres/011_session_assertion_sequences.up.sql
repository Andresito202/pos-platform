-- D3: central durable SSA issuer watermark, independent of identity.sessions.version.
-- One monotonically increasing counter for each receiver anti-replay binding.
-- No password, MFA, device proof or assertion is conferred by this table.
CREATE TABLE identity.session_assertion_sequences (
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE NO ACTION,
  installation_id uuid NOT NULL,
  device_id uuid NOT NULL REFERENCES identity.device_registry(device_id) ON DELETE NO ACTION,
  last_issued_sequence bigint NOT NULL
    CONSTRAINT session_assertion_sequences_range_ck
    CHECK (last_issued_sequence BETWEEN 1 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT session_assertion_sequences_pk
    PRIMARY KEY (user_id, installation_id, device_id),
  CONSTRAINT session_assertion_sequences_time_ck CHECK (updated_at >= created_at)
);

-- Enforces a start of 1, an exact +1 transition and immutable binding.
-- A session refresh/recreation cannot reset the watermark. Deletion is forbidden.
CREATE FUNCTION identity.guard_session_assertion_sequences()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.last_issued_sequence <> 1 THEN
      RAISE EXCEPTION 'SSA sequence must start at one';
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.user_id, NEW.installation_id, NEW.device_id, NEW.created_at)
      IS DISTINCT FROM
       ROW(OLD.user_id, OLD.installation_id, OLD.device_id, OLD.created_at)
       OR OLD.last_issued_sequence >= 9007199254740991
       OR NEW.last_issued_sequence <> OLD.last_issued_sequence + 1
       OR NEW.updated_at < OLD.updated_at
    THEN
      RAISE EXCEPTION 'SSA sequence requires a strict +1 immutable-binding transition';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'SSA sequence watermark must never be deleted';
END;
$function$;

CREATE TRIGGER session_assertion_sequences_guard
BEFORE INSERT OR UPDATE OR DELETE ON identity.session_assertion_sequences
FOR EACH ROW EXECUTE FUNCTION identity.guard_session_assertion_sequences();

ALTER TABLE identity.session_assertion_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.session_assertion_sequences FORCE ROW LEVEL SECURITY;
CREATE POLICY session_assertion_sequences_central_only ON identity.session_assertion_sequences
  FOR ALL TO pos_platform_app USING (true) WITH CHECK (true);
CREATE POLICY session_assertion_sequences_owner_inspect ON identity.session_assertion_sequences
  FOR SELECT TO pos_schema_owner USING (true);

REVOKE ALL ON identity.session_assertion_sequences FROM PUBLIC, pos_app, pos_worker, pos_platform_admin;
REVOKE ALL ON FUNCTION identity.guard_session_assertion_sequences() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.guard_session_assertion_sequences() TO pos_platform_app;
GRANT SELECT, INSERT ON identity.session_assertion_sequences TO pos_platform_app;
GRANT UPDATE (last_issued_sequence, updated_at) ON identity.session_assertion_sequences TO pos_platform_app;
