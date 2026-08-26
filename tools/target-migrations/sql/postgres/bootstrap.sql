CREATE SCHEMA IF NOT EXISTS platform AUTHORIZATION pos_schema_owner;

CREATE OR REPLACE FUNCTION platform.is_uuid_v7(value uuid)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT substring(value::text, 15, 1) = '7'
     AND substring(value::text, 20, 1) IN ('8', '9', 'a', 'b');
$$;

CREATE TABLE IF NOT EXISTS platform.target_migration_executions (
  execution_id uuid PRIMARY KEY,
  migration_id text NOT NULL,
  dialect text NOT NULL,
  manifest_version integer NOT NULL,
  checksum bytea NOT NULL,
  status text NOT NULL,
  started_at timestamptz NOT NULL,
  body_committed_at timestamptz NULL,
  smoke_verified_at timestamptz NULL,
  applied_at timestamptz NULL,
  rolled_back_at timestamptz NULL,
  finished_at timestamptz NULL,
  runner_version text NOT NULL,
  error_code text NULL,
  CONSTRAINT target_migration_executions_execution_id_v7_ck CHECK (platform.is_uuid_v7(execution_id)),
  CONSTRAINT target_migration_executions_migration_id_ck CHECK (btrim(migration_id) <> ''),
  CONSTRAINT target_migration_executions_dialect_ck CHECK (dialect = 'POSTGRESQL'),
  CONSTRAINT target_migration_executions_manifest_version_ck CHECK (manifest_version >= 1),
  CONSTRAINT target_migration_executions_checksum_ck CHECK (octet_length(checksum) = 32),
  CONSTRAINT target_migration_executions_status_ck CHECK (status IN ('STARTED','APPLIED','FAILED','ROLLED_BACK')),
  CONSTRAINT target_migration_executions_runner_version_ck CHECK (btrim(runner_version) <> ''),
  CONSTRAINT target_migration_executions_lifecycle_ck CHECK (
    (status = 'STARTED' AND smoke_verified_at IS NULL AND applied_at IS NULL AND rolled_back_at IS NULL AND finished_at IS NULL AND error_code IS NULL)
    OR (status = 'FAILED' AND body_committed_at IS NULL AND smoke_verified_at IS NULL AND applied_at IS NULL AND rolled_back_at IS NULL AND finished_at IS NOT NULL AND error_code IS NOT NULL)
    OR (status = 'APPLIED' AND body_committed_at IS NOT NULL AND smoke_verified_at IS NOT NULL AND applied_at IS NOT NULL AND finished_at IS NOT NULL AND rolled_back_at IS NULL AND error_code IS NULL)
    OR (status = 'ROLLED_BACK' AND body_committed_at IS NOT NULL AND rolled_back_at IS NOT NULL AND finished_at IS NOT NULL AND error_code IS NULL)
  ),
  CONSTRAINT target_migration_executions_identity_uq UNIQUE (migration_id, checksum, execution_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS target_migration_executions_started_uq
  ON platform.target_migration_executions (migration_id)
  WHERE status = 'STARTED';

CREATE UNIQUE INDEX IF NOT EXISTS target_migration_executions_applied_uq
  ON platform.target_migration_executions (migration_id)
  WHERE status = 'APPLIED';

CREATE OR REPLACE FUNCTION platform.guard_target_migration_execution_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(NEW.execution_id, NEW.migration_id, NEW.dialect, NEW.manifest_version, NEW.checksum, NEW.started_at, NEW.runner_version)
     IS DISTINCT FROM
     ROW(OLD.execution_id, OLD.migration_id, OLD.dialect, OLD.manifest_version, OLD.checksum, OLD.started_at, OLD.runner_version) THEN
    RAISE EXCEPTION 'immutable migration execution fields changed';
  END IF;

  IF OLD.status = 'STARTED' AND NEW.status = 'STARTED' THEN
    IF NEW.body_committed_at IS DISTINCT FROM OLD.body_committed_at
       AND OLD.body_committed_at IS NOT NULL THEN
      RAISE EXCEPTION 'body_committed_at is immutable once recorded';
    END IF;
    IF ROW(NEW.smoke_verified_at, NEW.applied_at, NEW.rolled_back_at, NEW.finished_at, NEW.error_code)
       IS DISTINCT FROM
       ROW(OLD.smoke_verified_at, OLD.applied_at, OLD.rolled_back_at, OLD.finished_at, OLD.error_code) THEN
      RAISE EXCEPTION 'invalid STARTED mutation';
    END IF;
  ELSIF OLD.status = 'STARTED' AND NEW.status IN ('FAILED', 'APPLIED', 'ROLLED_BACK') THEN
    NULL;
  ELSIF OLD.status = 'APPLIED' AND NEW.status = 'ROLLED_BACK' THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'invalid migration transition % -> %', OLD.status, NEW.status;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS target_migration_executions_transition_guard
  ON platform.target_migration_executions;
CREATE TRIGGER target_migration_executions_transition_guard
BEFORE UPDATE ON platform.target_migration_executions
FOR EACH ROW EXECUTE FUNCTION platform.guard_target_migration_execution_transition();

ALTER SCHEMA platform OWNER TO pos_schema_owner;
ALTER FUNCTION platform.is_uuid_v7(uuid) OWNER TO pos_schema_owner;
ALTER FUNCTION platform.guard_target_migration_execution_transition() OWNER TO pos_schema_owner;
ALTER TABLE platform.target_migration_executions OWNER TO pos_schema_owner;

REVOKE ALL ON SCHEMA platform FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA platform FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA platform FROM PUBLIC;
GRANT USAGE ON SCHEMA platform TO pos_migrator;
