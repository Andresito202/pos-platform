CREATE TABLE IF NOT EXISTS target_migration_executions (
  execution_id TEXT PRIMARY KEY NOT NULL,
  migration_id TEXT NOT NULL,
  dialect TEXT NOT NULL CHECK (dialect = 'SQLITE'),
  manifest_version INTEGER NOT NULL CHECK (manifest_version >= 1),
  checksum BLOB NOT NULL CHECK (length(checksum) = 32),
  status TEXT NOT NULL CHECK (status IN ('STARTED','APPLIED','FAILED','ROLLED_BACK')),
  started_at TEXT NOT NULL,
  body_committed_at TEXT NULL,
  smoke_verified_at TEXT NULL,
  applied_at TEXT NULL,
  rolled_back_at TEXT NULL,
  finished_at TEXT NULL,
  runner_version TEXT NOT NULL CHECK (trim(runner_version) <> ''),
  error_code TEXT NULL,
  CONSTRAINT target_migration_executions_execution_id_v7_ck CHECK (
    length(execution_id) = 36
    AND substr(execution_id, 9, 1) = '-'
    AND substr(execution_id, 14, 1) = '-'
    AND substr(execution_id, 15, 1) = '7'
    AND substr(execution_id, 19, 1) = '-'
    AND substr(execution_id, 20, 1) IN ('8','9','a','b')
    AND substr(execution_id, 24, 1) = '-'
    AND lower(execution_id) = execution_id
  ),
  CONSTRAINT target_migration_executions_migration_id_ck CHECK (trim(migration_id) <> ''),
  CONSTRAINT target_migration_executions_started_at_ck CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', started_at) IS NOT NULL),
  CONSTRAINT target_migration_executions_lifecycle_ck CHECK (
    (status = 'STARTED' AND smoke_verified_at IS NULL AND applied_at IS NULL AND rolled_back_at IS NULL AND finished_at IS NULL AND error_code IS NULL)
    OR (status = 'FAILED' AND body_committed_at IS NULL AND smoke_verified_at IS NULL AND applied_at IS NULL AND rolled_back_at IS NULL AND finished_at IS NOT NULL AND error_code IS NOT NULL)
    OR (status = 'APPLIED' AND body_committed_at IS NOT NULL AND smoke_verified_at IS NOT NULL AND applied_at IS NOT NULL AND finished_at IS NOT NULL AND rolled_back_at IS NULL AND error_code IS NULL)
    OR (status = 'ROLLED_BACK' AND body_committed_at IS NOT NULL AND rolled_back_at IS NOT NULL AND finished_at IS NOT NULL AND error_code IS NULL)
  ),
  UNIQUE (migration_id, checksum, execution_id)
);

-- statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS target_migration_executions_started_uq
  ON target_migration_executions (migration_id)
  WHERE status = 'STARTED';

-- statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS target_migration_executions_applied_uq
  ON target_migration_executions (migration_id)
  WHERE status = 'APPLIED';

-- statement-breakpoint

CREATE TRIGGER IF NOT EXISTS target_migration_executions_transition_guard
BEFORE UPDATE ON target_migration_executions
FOR EACH ROW
WHEN NOT (
  (OLD.status = 'STARTED' AND NEW.status = 'STARTED')
  OR (OLD.status = 'STARTED' AND NEW.status IN ('FAILED','APPLIED','ROLLED_BACK'))
  OR (OLD.status = 'APPLIED' AND NEW.status = 'ROLLED_BACK')
)
OR NEW.execution_id <> OLD.execution_id
OR NEW.migration_id <> OLD.migration_id
OR NEW.dialect <> OLD.dialect
OR NEW.manifest_version <> OLD.manifest_version
OR NEW.checksum <> OLD.checksum
OR NEW.started_at <> OLD.started_at
OR NEW.runner_version <> OLD.runner_version
BEGIN
  SELECT RAISE(ABORT, 'invalid migration execution transition');
END;
