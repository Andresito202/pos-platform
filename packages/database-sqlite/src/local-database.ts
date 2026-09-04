import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  copyFileSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  renameSync,
  rmSync,
  statfsSync,
  statSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";
import Database from "better-sqlite3";
import { WriterLock } from "./writer-lock.js";

const MIGRATION_001 = `
CREATE TABLE runtime_operations (
  operation_id TEXT PRIMARY KEY NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  payload_checksum TEXT NOT NULL CHECK(length(payload_checksum) = 64),
  status TEXT NOT NULL CHECK(status IN ('PENDING','SUCCEEDED','REJECTED','UNKNOWN')),
  result_code TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX runtime_operations_status_idx ON runtime_operations(status, created_at);
`.trim();

const MIGRATION_002 = `
CREATE TABLE local_security_state (
  singleton INTEGER PRIMARY KEY NOT NULL CHECK(singleton = 1),
  last_trusted_time TEXT NOT NULL
) STRICT;

CREATE TABLE local_channel_replay_state (
  session_id TEXT PRIMARY KEY NOT NULL CHECK(length(session_id) = 36),
  highest_sequence INTEGER NOT NULL CHECK(highest_sequence > 0),
  expires_at TEXT NOT NULL
) STRICT;
CREATE INDEX local_channel_replay_state_expires_at_idx
  ON local_channel_replay_state(expires_at);
`.trim();

const MIGRATION_003 = `
CREATE TABLE local_device_identity_state (
  singleton INTEGER PRIMARY KEY NOT NULL CHECK(singleton = 1),
  active_key_id TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK(generation > 0),
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','REVOKED'))
) STRICT;

CREATE TABLE local_device_key_history (
  device_key_id TEXT PRIMARY KEY NOT NULL,
  generation INTEGER NOT NULL UNIQUE CHECK(generation > 0),
  secret_name TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','VERIFY_ONLY','REVOKED','REPLACED')),
  created_at TEXT NOT NULL,
  retired_at TEXT
) STRICT;

CREATE TABLE local_license_activation_state (
  license_id TEXT PRIMARY KEY NOT NULL CHECK(length(license_id) = 36),
  device_key_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','SUSPENDED','REVOKED')),
  activated_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reason TEXT
) STRICT;

CREATE TABLE local_security_audit (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER local_security_audit_no_update
  BEFORE UPDATE ON local_security_audit
  BEGIN SELECT RAISE(ABORT, 'local security audit is append-only'); END;
CREATE TRIGGER local_security_audit_no_delete
  BEFORE DELETE ON local_security_audit
  BEGIN SELECT RAISE(ABORT, 'local security audit is append-only'); END;
`.trim();


const MIGRATION_004 = `
CREATE TABLE local_sync_outbox (
  operation_id TEXT PRIMARY KEY NOT NULL CHECK(length(operation_id) = 36),
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) = 36),
  company_id TEXT NOT NULL CHECK(length(company_id) = 36),
  branch_id TEXT NOT NULL CHECK(length(branch_id) = 36),
  device_id TEXT NOT NULL CHECK(length(device_id) = 36),
  installation_id TEXT NOT NULL CHECK(length(installation_id) = 36),
  operation_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  local_sequence INTEGER NOT NULL CHECK(local_sequence > 0),
  operation_json TEXT NOT NULL,
  payload_checksum TEXT NOT NULL CHECK(length(payload_checksum) = 64),
  status TEXT NOT NULL CHECK(status IN ('PENDING','IN_FLIGHT','RETRY_WAIT','ACKNOWLEDGED','DEAD_LETTER')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
  next_attempt_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id, operation_type, idempotency_key),
  UNIQUE(tenant_id, company_id, branch_id, device_id, installation_id, local_sequence)
) STRICT;
CREATE INDEX local_sync_outbox_dispatch_idx
  ON local_sync_outbox(status, next_attempt_at, local_sequence);

CREATE TABLE local_sync_inbox (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id TEXT NOT NULL CHECK(length(operation_id) = 36),
  result_checksum TEXT NOT NULL CHECK(length(result_checksum) = 64),
  result_json TEXT NOT NULL,
  server_status TEXT NOT NULL CHECK(server_status IN (
    'SERVER_ACCEPTED','SERVER_REJECTED','CONFLICT','WAITING_FOR_DEPENDENCY',
    'RETRY_SCHEDULED','REVIEW_REQUIRED','DEAD_LETTER'
  )),
  committed_at_server TEXT,
  recorded_at_local TEXT NOT NULL,
  UNIQUE(operation_id, result_checksum)
) STRICT;
CREATE INDEX local_sync_inbox_operation_idx ON local_sync_inbox(operation_id, sequence);

CREATE TABLE local_sync_checkpoint (
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) = 36),
  company_id TEXT NOT NULL CHECK(length(company_id) = 36),
  branch_id TEXT NOT NULL CHECK(length(branch_id) = 36),
  device_id TEXT NOT NULL CHECK(length(device_id) = 36),
  installation_id TEXT NOT NULL CHECK(length(installation_id) = 36),
  acknowledged_through_local_sequence INTEGER NOT NULL CHECK(acknowledged_through_local_sequence >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id, company_id, branch_id, device_id, installation_id)
) WITHOUT ROWID, STRICT;

CREATE TABLE local_sync_dead_letter (
  operation_id TEXT PRIMARY KEY NOT NULL CHECK(length(operation_id) = 36),
  reason_code TEXT NOT NULL,
  attempts INTEGER NOT NULL CHECK(attempts >= 0),
  failed_at TEXT NOT NULL,
  recovered_at TEXT,
  FOREIGN KEY(operation_id) REFERENCES local_sync_outbox(operation_id)
) STRICT;

CREATE TRIGGER local_sync_inbox_no_update
  BEFORE UPDATE ON local_sync_inbox
  BEGIN SELECT RAISE(ABORT, 'local sync inbox is append-only'); END;
CREATE TRIGGER local_sync_inbox_no_delete
  BEFORE DELETE ON local_sync_inbox
  BEGIN SELECT RAISE(ABORT, 'local sync inbox is append-only'); END;
`.trim();

const MIGRATION_005 = `
CREATE TABLE local_operation_audit (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) = 36),
  company_id TEXT NOT NULL CHECK(length(company_id) = 36),
  branch_id TEXT NOT NULL CHECK(length(branch_id) = 36),
  device_id TEXT NOT NULL CHECK(length(device_id) = 36),
  actor_type TEXT NOT NULL CHECK(actor_type IN ('DEVICE','SYSTEM')),
  actor_id TEXT,
  session_id TEXT NOT NULL,
  action_code TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  correlation_id TEXT NOT NULL,
  causation_id TEXT,
  reason_code TEXT,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX local_operation_audit_scope_idx
  ON local_operation_audit(tenant_id, company_id, branch_id, created_at);
CREATE TRIGGER local_operation_audit_no_update
  BEFORE UPDATE ON local_operation_audit
  BEGIN SELECT RAISE(ABORT, 'local operation audit is append-only'); END;
CREATE TRIGGER local_operation_audit_no_delete
  BEFORE DELETE ON local_operation_audit
  BEGIN SELECT RAISE(ABORT, 'local operation audit is append-only'); END;
`.trim();

// DEC-011: proyección local de autorización. La clave primaria es el binding
// completo, de modo que "existe un único snapshot activo por
// usuario/instalación/dispositivo" es una garantía estructural y no una
// convención. No se agrega una columna `is_active`: solo se conservan snapshots
// activos, así que una columna siempre igual a 1 no aportaría nada.
//
// Esta tabla NO replica el RBAC central ni crea usuarios, roles o permisos
// locales. Guarda el snapshot firmado tal como llegó; la autoridad sigue siendo
// el modelo central que lo emitió.
const MIGRATION_006 = `
CREATE TABLE local_authorization_snapshot (
  user_id TEXT NOT NULL CHECK(length(user_id) = 36),
  installation_id TEXT NOT NULL CHECK(length(installation_id) = 36),
  device_id TEXT NOT NULL CHECK(length(device_id) = 36),
  snapshot_id TEXT NOT NULL CHECK(length(snapshot_id) = 36),
  sequence INTEGER NOT NULL CHECK(sequence > 0),
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL CHECK(expires_at > issued_at),
  claims_json TEXT NOT NULL,
  claims_checksum TEXT NOT NULL CHECK(length(claims_checksum) = 64),
  signature TEXT NOT NULL,
  activated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, installation_id, device_id)
) STRICT;
`.trim();

// DEC-012: identidad de sesión local. La clave primaria es el binding completo,
// igual que en `local_authorization_snapshot`, de modo que "existe una única
// sesión activa por usuario/instalación/dispositivo" es una garantía
// estructural y no una convención.
//
// Esta tabla NO replica `Session` central ni ninguna credencial: guarda la SSA
// firmada tal como llegó, cuya autoridad sigue siendo el emisor central. No
// contiene permisos, roles ni asignaciones — la autorización vive en
// `local_authorization_snapshot` y se decide en `evaluatePermission()`.
//
// Una fila expirada se conserva deliberadamente: es lo que impide que una SSA
// antigua vuelva a entrar por replay una vez superada su vigencia.
const MIGRATION_007 = `
CREATE TABLE local_session_assertion (
  user_id TEXT NOT NULL CHECK(length(user_id) = 36),
  installation_id TEXT NOT NULL CHECK(length(installation_id) = 36),
  device_id TEXT NOT NULL CHECK(length(device_id) = 36),
  session_id TEXT NOT NULL CHECK(length(session_id) = 36),
  tenant_membership_id TEXT NOT NULL CHECK(length(tenant_membership_id) = 36),
  sequence INTEGER NOT NULL CHECK(sequence > 0),
  issued_at TEXT NOT NULL,
  offline_valid_until TEXT NOT NULL CHECK(offline_valid_until > issued_at),
  key_id TEXT NOT NULL,
  claims_json TEXT NOT NULL,
  claims_checksum TEXT NOT NULL CHECK(length(claims_checksum) = 64),
  signature TEXT NOT NULL,
  activated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, installation_id, device_id)
) STRICT;
`.trim();

// DEC-012 D4: la auditoría local debe poder atribuir una operación a un usuario
// autenticado. `MIGRATION_005` admitía únicamente 'DEVICE' y 'SYSTEM', así que
// un acto de usuario solo podía registrarse falseando el actor.
//
// SQLite no permite alterar un CHECK, de modo que la tabla se reconstruye. La
// reconstrucción es puramente estructural: copia las filas existentes tal cual,
// sin reinterpretar ningún actor histórico. `MIGRATION_005` no se edita — sus
// bytes y su checksum permanecen inmutables — y los triggers append-only se
// recrean explícitamente tras el renombrado.
//
// Ampliar el CHECK no habilita ninguna operación de usuario: el único escritor
// de esta tabla emite `'DEVICE'` como literal SQL, no como parámetro, así que
// ningún llamador puede elegir el actor.
const MIGRATION_008 = `
DROP TRIGGER local_operation_audit_no_update;
DROP TRIGGER local_operation_audit_no_delete;

CREATE TABLE local_operation_audit_rebuilt (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) = 36),
  company_id TEXT NOT NULL CHECK(length(company_id) = 36),
  branch_id TEXT NOT NULL CHECK(length(branch_id) = 36),
  device_id TEXT NOT NULL CHECK(length(device_id) = 36),
  actor_type TEXT NOT NULL CHECK(actor_type IN ('DEVICE','SYSTEM','USER')),
  actor_id TEXT,
  session_id TEXT NOT NULL,
  action_code TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  correlation_id TEXT NOT NULL,
  causation_id TEXT,
  reason_code TEXT,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK(actor_type <> 'USER' OR actor_id IS NOT NULL)
) STRICT;

INSERT INTO local_operation_audit_rebuilt(
  sequence, tenant_id, company_id, branch_id, device_id, actor_type, actor_id,
  session_id, action_code, resource_type, resource_id, correlation_id,
  causation_id, reason_code, details_json, created_at
)
SELECT
  sequence, tenant_id, company_id, branch_id, device_id, actor_type, actor_id,
  session_id, action_code, resource_type, resource_id, correlation_id,
  causation_id, reason_code, details_json, created_at
FROM local_operation_audit;

DROP TABLE local_operation_audit;

ALTER TABLE local_operation_audit_rebuilt RENAME TO local_operation_audit;

CREATE INDEX local_operation_audit_scope_idx
  ON local_operation_audit(tenant_id, company_id, branch_id, created_at);
CREATE TRIGGER local_operation_audit_no_update
  BEFORE UPDATE ON local_operation_audit
  BEGIN SELECT RAISE(ABORT, 'local operation audit is append-only'); END;
CREATE TRIGGER local_operation_audit_no_delete
  BEFORE DELETE ON local_operation_audit
  BEGIN SELECT RAISE(ABORT, 'local operation audit is append-only'); END;
`.trim();

// DEC-012 §32: materialización autorizada de Cash y de la proyección local de
// `CashRegister`. Cuatro tablas y ninguna más.
//
// El artefacto es append-only porque de él depende que `§21.6` sea verificable:
// sin conservarlo, un turno antiguo declararía una `sequence` cuyo snapshot ya
// no existe. `snapshot_type` admite un único valor: `DEC-013` §7 define cuatro,
// pero §32 sólo autoriza `CASH_REGISTER`, y la restricción es física, no una
// convención. Ampliarla exige autorización y migración propia.
//
// `cash_register` es a la vez tabla de `D5` y proyección local del snapshot:
// una sola tabla, no dos (`DEC-012` §31.2). `last_seen_sequence` materializa
// `G1`: la ausencia en un snapshot posterior conserva la fila y su última
// presencia, y nunca infiere `RETIRED`, que sólo llega del maestro.
//
// `cash_shift` y `cash_movement` materializan las decisiones cerradas: `M1`
// (actor `USER`), `M2` (sin `reference_type`/`reference_id`), `B1` (cero sólo
// para `OPENING_FLOAT`), `B2` (unicidad de turno activo por caja, sin
// dispositivo), `B3` (decimal canónico de escala 6) y `B4`
// (`cash_register_projection_sequence`).
const MIGRATION_009 = `
CREATE TABLE local_master_snapshot_artifact (
  snapshot_type TEXT NOT NULL CHECK(snapshot_type = 'CASH_REGISTER'),
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) = 36),
  company_id TEXT NOT NULL CHECK(length(company_id) = 36),
  branch_id TEXT NOT NULL CHECK(length(branch_id) = 36),
  sequence INTEGER NOT NULL CHECK(sequence > 0),
  environment TEXT NOT NULL CHECK(environment IN ('PRODUCTION','STAGING','SANDBOX')),
  key_id TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  claims_json TEXT NOT NULL,
  claims_checksum TEXT NOT NULL CHECK(length(claims_checksum) = 64),
  signature TEXT NOT NULL,
  activated_at TEXT NOT NULL,
  PRIMARY KEY (snapshot_type, tenant_id, company_id, branch_id, sequence)
) WITHOUT ROWID, STRICT;
CREATE TRIGGER local_master_snapshot_artifact_no_update
  BEFORE UPDATE ON local_master_snapshot_artifact
  BEGIN SELECT RAISE(ABORT, 'master snapshot artifact is append-only'); END;
CREATE TRIGGER local_master_snapshot_artifact_no_delete
  BEFORE DELETE ON local_master_snapshot_artifact
  BEGIN SELECT RAISE(ABORT, 'master snapshot artifact is append-only'); END;

CREATE TABLE cash_register (
  id TEXT NOT NULL CHECK(length(id) = 36),
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) = 36),
  company_id TEXT NOT NULL CHECK(length(company_id) = 36),
  branch_id TEXT NOT NULL CHECK(length(branch_id) = 36),
  code TEXT NOT NULL CHECK(length(code) > 0),
  code_normalized TEXT NOT NULL CHECK(length(code_normalized) > 0),
  name TEXT NOT NULL CHECK(length(name) > 0),
  currency_code TEXT NOT NULL CHECK(length(currency_code) = 3),
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','RETIRED')),
  created_at TEXT NOT NULL,
  retired_at TEXT,
  version INTEGER NOT NULL CHECK(version > 0),
  last_seen_sequence INTEGER NOT NULL CHECK(last_seen_sequence > 0),
  CHECK ((status = 'RETIRED') = (retired_at IS NOT NULL)),
  PRIMARY KEY (tenant_id, id)
) WITHOUT ROWID, STRICT;
CREATE UNIQUE INDEX cash_register_code_idx
  ON cash_register(tenant_id, company_id, branch_id, code_normalized);

CREATE TABLE cash_shift (
  id TEXT NOT NULL CHECK(length(id) = 36),
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) = 36),
  company_id TEXT NOT NULL CHECK(length(company_id) = 36),
  branch_id TEXT NOT NULL CHECK(length(branch_id) = 36),
  cash_register_id TEXT NOT NULL CHECK(length(cash_register_id) = 36),
  origin_device_id TEXT NOT NULL CHECK(length(origin_device_id) = 36),
  opened_by_actor_type TEXT NOT NULL CHECK(opened_by_actor_type = 'USER'),
  opened_by_actor_id TEXT NOT NULL CHECK(length(opened_by_actor_id) = 36),
  opened_at TEXT NOT NULL,
  business_date TEXT NOT NULL CHECK(length(business_date) = 10),
  timezone_id TEXT NOT NULL CHECK(length(timezone_id) > 0),
  utc_offset_minutes INTEGER NOT NULL CHECK(utc_offset_minutes BETWEEN -1440 AND 1440),
  currency_code TEXT NOT NULL CHECK(length(currency_code) = 3),
  status TEXT NOT NULL CHECK(status IN ('OPEN','CLOSING','CLOSED')),
  closed_by_actor_type TEXT CHECK(closed_by_actor_type IS NULL OR closed_by_actor_type = 'USER'),
  closed_by_actor_id TEXT CHECK(closed_by_actor_id IS NULL OR length(closed_by_actor_id) = 36),
  closed_at TEXT,
  opening_idempotency_key TEXT NOT NULL CHECK(length(opening_idempotency_key) > 0),
  opening_request_checksum TEXT NOT NULL CHECK(length(opening_request_checksum) = 64),
  closing_idempotency_key TEXT,
  closing_request_checksum TEXT CHECK(closing_request_checksum IS NULL OR length(closing_request_checksum) = 64),
  cash_register_projection_sequence INTEGER NOT NULL CHECK(cash_register_projection_sequence > 0),
  last_movement_sequence INTEGER NOT NULL CHECK(last_movement_sequence >= 0),
  version INTEGER NOT NULL CHECK(version > 0),
  created_at TEXT NOT NULL,
  server_recorded_at TEXT,
  CHECK ((closed_by_actor_type IS NULL) = (closed_by_actor_id IS NULL)),
  CHECK (status <> 'CLOSED' OR closed_at IS NOT NULL),
  CHECK (closed_at IS NULL OR status = 'CLOSED'),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, cash_register_id) REFERENCES cash_register(tenant_id, id)
) WITHOUT ROWID, STRICT;
CREATE UNIQUE INDEX cash_shift_active_idx
  ON cash_shift(tenant_id, branch_id, cash_register_id)
  WHERE status IN ('OPEN','CLOSING');
CREATE UNIQUE INDEX cash_shift_opening_idempotency_idx
  ON cash_shift(tenant_id, origin_device_id, opening_idempotency_key);

CREATE TABLE cash_movement (
  id TEXT NOT NULL CHECK(length(id) = 36),
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) = 36),
  company_id TEXT NOT NULL CHECK(length(company_id) = 36),
  branch_id TEXT NOT NULL CHECK(length(branch_id) = 36),
  cash_register_id TEXT NOT NULL CHECK(length(cash_register_id) = 36),
  cash_shift_id TEXT NOT NULL CHECK(length(cash_shift_id) = 36),
  shift_sequence INTEGER NOT NULL CHECK(shift_sequence > 0),
  movement_type TEXT NOT NULL CHECK(movement_type IN (
    'OPENING_FLOAT','CASH_SALE','CASH_PAYMENT','CHANGE_GIVEN','CASH_REFUND',
    'CASH_REVERSAL_COMPENSATION','CASH_WITHDRAWAL','CASH_DEPOSIT','COURIER_COLLECTION',
    'CASH_EXPENSE','CASH_ADJUSTMENT_POSITIVE','CASH_ADJUSTMENT_NEGATIVE',
    'TRANSFER_TO_SAFE','TRANSFER_FROM_SAFE','CLOSING_TRANSFER','OTHER_AUTHORIZED')),
  direction TEXT NOT NULL CHECK(direction IN ('IN','OUT')),
  amount TEXT NOT NULL
    CHECK(amount GLOB '[0-9]*.[0-9][0-9][0-9][0-9][0-9][0-9]')
    CHECK(amount NOT GLOB '*[^0-9.]*')
    CHECK(length(amount) - length(replace(amount, '.', '')) = 1)
    CHECK(amount NOT GLOB '0[0-9]*'),
  currency_code TEXT NOT NULL CHECK(length(currency_code) = 3),
  status TEXT NOT NULL CHECK(status IN (
    'CREATED','PENDING_APPROVAL','APPROVED','POSTED','REJECTED','FAILED','CANCELLED')),
  original_cash_movement_id TEXT CHECK(original_cash_movement_id IS NULL OR length(original_cash_movement_id) = 36),
  reason_code TEXT NOT NULL CHECK(length(reason_code) > 0),
  evidence_reference TEXT,
  actor_type TEXT NOT NULL CHECK(actor_type = 'USER'),
  actor_id TEXT NOT NULL CHECK(length(actor_id) = 36),
  approved_by_actor_type TEXT CHECK(approved_by_actor_type IS NULL OR approved_by_actor_type = 'USER'),
  approved_by_actor_id TEXT CHECK(approved_by_actor_id IS NULL OR length(approved_by_actor_id) = 36),
  business_date TEXT NOT NULL CHECK(length(business_date) = 10),
  occurred_at TEXT NOT NULL,
  device_reported_at TEXT NOT NULL,
  origin_device_id TEXT NOT NULL CHECK(length(origin_device_id) = 36),
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) > 0),
  request_checksum TEXT NOT NULL CHECK(length(request_checksum) = 64),
  correlation_id TEXT NOT NULL CHECK(length(correlation_id) = 36),
  version INTEGER NOT NULL CHECK(version > 0),
  created_at TEXT NOT NULL,
  server_recorded_at TEXT,
  CHECK (movement_type = 'OPENING_FLOAT' OR amount <> '0.000000'),
  CHECK ((approved_by_actor_type IS NULL) = (approved_by_actor_id IS NULL)),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, cash_shift_id) REFERENCES cash_shift(tenant_id, id),
  FOREIGN KEY (tenant_id, cash_register_id) REFERENCES cash_register(tenant_id, id),
  FOREIGN KEY (tenant_id, original_cash_movement_id) REFERENCES cash_movement(tenant_id, id)
) WITHOUT ROWID, STRICT;
CREATE UNIQUE INDEX cash_movement_shift_sequence_idx
  ON cash_movement(tenant_id, cash_shift_id, shift_sequence);
CREATE UNIQUE INDEX cash_movement_idempotency_idx
  ON cash_movement(tenant_id, origin_device_id, idempotency_key);
CREATE UNIQUE INDEX cash_movement_opening_float_idx
  ON cash_movement(tenant_id, cash_shift_id)
  WHERE movement_type = 'OPENING_FLOAT' AND status = 'POSTED';
`.trim();

const MIGRATIONS = [
  { version: 1, sql: MIGRATION_001, checksum: createHash("sha256").update(MIGRATION_001).digest("hex") },
  { version: 2, sql: MIGRATION_002, checksum: createHash("sha256").update(MIGRATION_002).digest("hex") },
  { version: 3, sql: MIGRATION_003, checksum: createHash("sha256").update(MIGRATION_003).digest("hex") },
  { version: 4, sql: MIGRATION_004, checksum: createHash("sha256").update(MIGRATION_004).digest("hex") },
  { version: 5, sql: MIGRATION_005, checksum: createHash("sha256").update(MIGRATION_005).digest("hex") },
  { version: 6, sql: MIGRATION_006, checksum: createHash("sha256").update(MIGRATION_006).digest("hex") },
  { version: 7, sql: MIGRATION_007, checksum: createHash("sha256").update(MIGRATION_007).digest("hex") },
  { version: 8, sql: MIGRATION_008, checksum: createHash("sha256").update(MIGRATION_008).digest("hex") },
  { version: 9, sql: MIGRATION_009, checksum: createHash("sha256").update(MIGRATION_009).digest("hex") },
] as const;

const BACKUP_FREE_SPACE_RESERVE_BYTES = 1_048_576n;

export interface LocalDatabaseStorageProbe {
  availableBytes(directory: string): bigint;
}

const defaultStorageProbe: LocalDatabaseStorageProbe = {
  availableBytes(directory) {
    const filesystem = statfsSync(directory, { bigint: true });
    return filesystem.bavail * filesystem.bsize;
  },
};

export interface LocalDatabaseOptions {
  readonly dataDirectory: string;
  readonly filename?: string;
  readonly busyTimeoutMs?: number;
  readonly storageProbe?: LocalDatabaseStorageProbe;
}

function validateDatabaseFile(path: string): void {
  if (lstatSync(path).isSymbolicLink()) throw new Error("database file cannot be a symbolic link");
  const database = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const rows = database.pragma("integrity_check") as Array<{ integrity_check: string }>;
    if (rows.length !== 1 || rows[0]?.integrity_check !== "ok") {
      throw new Error("SQLite backup integrity_check failed");
    }
  } finally {
    database.close();
  }
}

function syncFile(path: string): void {
  const descriptor = openSync(path, "r+");
  try { fsyncSync(descriptor); }
  finally { closeSync(descriptor); }
}

export class LocalDatabase {
  private constructor(
    readonly native: Database.Database,
    private readonly lock: WriterLock,
    private readonly directory: string,
    private readonly databasePath: string,
    private readonly storageProbe: LocalDatabaseStorageProbe,
  ) {}

  static open(options: LocalDatabaseOptions): LocalDatabase {
    mkdirSync(options.dataDirectory, { recursive: true, mode: 0o700 });
    if (lstatSync(options.dataDirectory).isSymbolicLink()) throw new Error("data directory cannot be a symbolic link");
    const directory = realpathSync(options.dataDirectory);
    const databasePath = join(directory, options.filename ?? "pos-local.db");
    const existedBeforeOpen = existsSync(databasePath) && statSync(databasePath).size > 0;
    const lock = WriterLock.acquire(directory);
    let native: Database.Database | undefined;

    try {
      native = new Database(databasePath);
      native.pragma("foreign_keys = ON");
      native.pragma(`busy_timeout = ${options.busyTimeoutMs ?? 5000}`);
      native.pragma("journal_mode = WAL");
      native.pragma("synchronous = FULL");
      native.pragma("trusted_schema = OFF");
      const database = new LocalDatabase(
        native,
        lock,
        directory,
        databasePath,
        options.storageProbe ?? defaultStorageProbe,
      );
      if (existedBeforeOpen && database.needsMigration()) {
        database.createVerifiedBackup("pre-migration");
      }
      database.applyMigrations();
      database.assertIntegrity();
      return database;
    } catch (error) {
      native?.close();
      lock.release();
      throw error;
    }
  }

  static restoreFromBackup(options: LocalDatabaseOptions, backupPath: string): void {
    if (!isAbsolute(backupPath)) throw new Error("backup path must be absolute");
    mkdirSync(options.dataDirectory, { recursive: true, mode: 0o700 });
    if (lstatSync(options.dataDirectory).isSymbolicLink()) throw new Error("data directory cannot be a symbolic link");
    const directory = realpathSync(options.dataDirectory);
    if (lstatSync(backupPath).isSymbolicLink()) throw new Error("backup file cannot be a symbolic link");
    validateDatabaseFile(backupPath);

    const lock = WriterLock.acquire(directory);
    const target = join(directory, options.filename ?? "pos-local.db");
    const targetWal = `${target}-wal`;
    const targetShm = `${target}-shm`;
    const restoreId = randomUUID();
    const temporary = `${target}.restore.tmp.${restoreId}`;
    const replaced = `${target}.restore.replaced.${restoreId}`;
    const replacedWal = `${replaced}-wal`;
    const replacedShm = `${replaced}-shm`;
    const hadTarget = existsSync(target);
    const hadWal = existsSync(targetWal);
    const hadShm = existsSync(targetShm);

    try {
      if (hadTarget) renameSync(target, replaced);
      if (hadWal) renameSync(targetWal, replacedWal);
      if (hadShm) renameSync(targetShm, replacedShm);

      copyFileSync(backupPath, temporary, fsConstants.COPYFILE_EXCL);
      chmodSync(temporary, 0o600);
      syncFile(temporary);
      renameSync(temporary, target);
      validateDatabaseFile(target);

      if (hadTarget) rmSync(replaced, { force: true });
      if (hadWal) rmSync(replacedWal, { force: true });
      if (hadShm) rmSync(replacedShm, { force: true });
    } catch (error) {
      rmSync(temporary, { force: true });
      rmSync(target, { force: true });
      rmSync(targetWal, { force: true });
      rmSync(targetShm, { force: true });

      if (hadTarget && existsSync(replaced)) renameSync(replaced, target);
      if (hadWal && existsSync(replacedWal)) renameSync(replacedWal, targetWal);
      if (hadShm && existsSync(replacedShm)) renameSync(replacedShm, targetShm);
      throw error;
    } finally {
      lock.release();
    }
  }

  createVerifiedBackup(label = "manual"): string {
    if (!/^[a-z0-9][a-z0-9._-]{0,31}$/.test(label)) throw new Error("invalid backup label");
    this.checkpoint();

    const backupDirectory = join(this.directory, "backups");
    mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
    const sourceBytes = BigInt(statSync(this.databasePath).size);
    const availableBytes = this.storageProbe.availableBytes(this.directory);
    const requiredBytes = sourceBytes + BACKUP_FREE_SPACE_RESERVE_BYTES;
    if (availableBytes < requiredBytes) {
      throw new Error(`insufficient free space for SQLite backup: required ${requiredBytes}, available ${availableBytes}`);
    }

    const name = `${label}-${Date.now()}-${randomUUID()}.db`;
    const target = join(backupDirectory, name);
    const temporary = `${target}.tmp`;
    try {
      copyFileSync(this.databasePath, temporary, fsConstants.COPYFILE_EXCL);
      chmodSync(temporary, 0o600);
      syncFile(temporary);
      validateDatabaseFile(temporary);
      renameSync(temporary, target);
      return target;
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
  }

  private needsMigration(): boolean {
    const ledger = this.native.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'local_schema_migrations'",
    ).get() as { name: string } | undefined;
    if (!ledger) return true;
    const row = this.native.prepare("SELECT max(version) AS version FROM local_schema_migrations").get() as {
      version: number | null;
    };
    const latest = MIGRATIONS[MIGRATIONS.length - 1]!.version;
    return (row.version ?? 0) < latest;
  }

  private applyMigrations(): void {
    this.native.exec(`CREATE TABLE IF NOT EXISTS local_schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      checksum TEXT NOT NULL CHECK(length(checksum) = 64),
      applied_at TEXT NOT NULL
    ) STRICT;
    CREATE TRIGGER IF NOT EXISTS local_schema_migrations_no_update
      BEFORE UPDATE ON local_schema_migrations
      BEGIN SELECT RAISE(ABORT, 'local migration ledger is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS local_schema_migrations_no_delete
      BEFORE DELETE ON local_schema_migrations
      BEGIN SELECT RAISE(ABORT, 'local migration ledger is immutable'); END;`);

    const existing = this.native.prepare(
      "SELECT version, checksum FROM local_schema_migrations ORDER BY version",
    ).all() as Array<{ version: number; checksum: string }>;

    for (const [index, row] of existing.entries()) {
      const migration = MIGRATIONS[index];
      if (!migration || migration.version !== row.version || migration.checksum !== row.checksum) {
        throw new Error(`local migration ledger mismatch at version ${row.version}`);
      }
    }

    const apply = this.native.transaction((migration: typeof MIGRATIONS[number]) => {
      this.native.exec(migration.sql);
      this.native.prepare(
        "INSERT INTO local_schema_migrations(version, checksum, applied_at) VALUES (?, ?, ?)",
      ).run(migration.version, migration.checksum, new Date().toISOString());
    });

    for (const migration of MIGRATIONS) {
      if (!existing.some((row) => row.version === migration.version)) apply(migration);
    }
  }

  assertIntegrity(): void {
    const rows = this.native.pragma("integrity_check") as Array<{ integrity_check: string }>;
    if (rows.length !== 1 || rows[0]?.integrity_check !== "ok") throw new Error("SQLite integrity_check failed");
    if (this.native.pragma("foreign_keys", { simple: true }) !== 1) throw new Error("SQLite foreign keys are disabled");
    if (String(this.native.pragma("journal_mode", { simple: true })).toLowerCase() !== "wal") {
      throw new Error("SQLite WAL is not active");
    }
  }

  checkpoint(): void {
    const rows = this.native.pragma("wal_checkpoint(TRUNCATE)") as Array<{
      busy: number;
      log: number;
      checkpointed: number;
    }>;
    if (rows.length !== 1 || rows[0]?.busy !== 0) throw new Error("SQLite WAL checkpoint is busy");
  }

  close(): void {
    try {
      if (this.native.open) this.native.close();
    } finally {
      this.lock.release();
    }
  }
}
