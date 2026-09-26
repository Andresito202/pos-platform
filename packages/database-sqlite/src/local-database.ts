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

// Sales V1 (BLOQUE 4C). Tres tablas de dominio y dos tablas de fixture SANDBOX.
//
// `sales_document_series_counter` materializa el contador monotónico local por
// serie documental (`DEC-003` §34). La serie es provisionada centralmente; el
// POS solo incrementa. Los skips están permitidos; nunca se reutiliza un número.
// La asignación es atómica con la escritura de `sales_sales`.
//
// `sales_sales` y `sales_sale_items` materializan el agregado Sale y sus ítems.
// La representación monetaria es TEXT a escala 6 — idéntica a `cash_movement` —
// porque SQLite no tiene DECIMAL nativo. `commercial_rounding_adjustment` es el
// único campo firmado: puede ser negativo cuando el redondeo NEAREST_50 baja.
//
// `sandbox_catalog_product`, `sandbox_catalog_presentation` y
// `sandbox_price_rule` son fixture de SANDBOX para BLOQUE 4C. NO implementan el
// sistema de distribución de snapshots CATALOG/PRICING (MATERIALIZATION GATE =
// NO-GO por DEC-013); existen únicamente para permitir la creación de ventas en
// el entorno SANDBOX sin infraestructura central. Ampliarlos a un sistema de
// snapshot propio exige autorización independiente.
const MIGRATION_010 = `
CREATE TABLE sales_document_series_counter (
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) = 36),
  branch_id TEXT NOT NULL CHECK(length(branch_id) = 36),
  series TEXT NOT NULL CHECK(length(series) >= 1 AND length(series) <= 20),
  last_number INTEGER NOT NULL CHECK(last_number >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, branch_id, series)
) WITHOUT ROWID, STRICT;

CREATE TABLE sales_sales (
  id TEXT NOT NULL CHECK(length(id) = 36),
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) = 36),
  company_id TEXT NOT NULL CHECK(length(company_id) = 36),
  branch_id TEXT NOT NULL CHECK(length(branch_id) = 36),
  cash_register_id TEXT CHECK(cash_register_id IS NULL OR length(cash_register_id) = 36),
  cash_shift_id TEXT CHECK(cash_shift_id IS NULL OR length(cash_shift_id) = 36),
  origin_device_id TEXT NOT NULL CHECK(length(origin_device_id) = 36),
  installation_id TEXT NOT NULL CHECK(length(installation_id) = 36),
  operator_actor_type TEXT NOT NULL CHECK(operator_actor_type = 'USER'),
  operator_actor_id TEXT NOT NULL CHECK(length(operator_actor_id) = 36),
  channel TEXT NOT NULL CHECK(length(channel) > 0),
  status TEXT NOT NULL CHECK(status IN (
    'DRAFT','SUSPENDED','READY_FOR_PAYMENT','PAYMENT_IN_PROGRESS',
    'COMPLETED','CANCELLED','EXPIRED'
  )),
  business_date TEXT NOT NULL CHECK(length(business_date) = 10),
  timezone_id TEXT NOT NULL CHECK(length(timezone_id) > 0),
  utc_offset_minutes INTEGER NOT NULL CHECK(utc_offset_minutes BETWEEN -1440 AND 1440),
  document_series TEXT NOT NULL CHECK(length(document_series) >= 1 AND length(document_series) <= 20),
  sale_number INTEGER NOT NULL CHECK(sale_number > 0),
  currency_code TEXT NOT NULL CHECK(length(currency_code) = 3),
  subtotal_amount TEXT NOT NULL
    CHECK(subtotal_amount GLOB '[0-9]*.[0-9][0-9][0-9][0-9][0-9][0-9]')
    CHECK(subtotal_amount NOT GLOB '*[^0-9.]*')
    CHECK(length(subtotal_amount) - length(replace(subtotal_amount, '.', '')) = 1)
    CHECK(subtotal_amount NOT GLOB '0[0-9]*'),
  discount_amount TEXT NOT NULL
    CHECK(discount_amount GLOB '[0-9]*.[0-9][0-9][0-9][0-9][0-9][0-9]')
    CHECK(discount_amount NOT GLOB '*[^0-9.]*')
    CHECK(length(discount_amount) - length(replace(discount_amount, '.', '')) = 1)
    CHECK(discount_amount NOT GLOB '0[0-9]*'),
  tax_amount TEXT NOT NULL
    CHECK(tax_amount GLOB '[0-9]*.[0-9][0-9][0-9][0-9][0-9][0-9]')
    CHECK(tax_amount NOT GLOB '*[^0-9.]*')
    CHECK(length(tax_amount) - length(replace(tax_amount, '.', '')) = 1)
    CHECK(tax_amount NOT GLOB '0[0-9]*'),
  fiscal_total_amount TEXT NOT NULL
    CHECK(fiscal_total_amount GLOB '[0-9]*.[0-9][0-9][0-9][0-9][0-9][0-9]')
    CHECK(fiscal_total_amount NOT GLOB '*[^0-9.]*')
    CHECK(length(fiscal_total_amount) - length(replace(fiscal_total_amount, '.', '')) = 1)
    CHECK(fiscal_total_amount NOT GLOB '0[0-9]*'),
  commercial_rounding_adjustment TEXT NOT NULL CHECK(
    (commercial_rounding_adjustment GLOB '[0-9]*.[0-9][0-9][0-9][0-9][0-9][0-9]'
     AND commercial_rounding_adjustment NOT GLOB '*[^0-9.]*'
     AND length(commercial_rounding_adjustment) - length(replace(commercial_rounding_adjustment, '.', '')) = 1
     AND commercial_rounding_adjustment NOT GLOB '0[0-9]*')
    OR
    (commercial_rounding_adjustment GLOB '-[0-9]*.[0-9][0-9][0-9][0-9][0-9][0-9]'
     AND commercial_rounding_adjustment NOT GLOB '*[^0-9.-]*'
     AND length(commercial_rounding_adjustment) - length(replace(commercial_rounding_adjustment, '.', '')) = 1)
  ),
  payable_amount TEXT NOT NULL
    CHECK(payable_amount GLOB '[0-9]*.[0-9][0-9][0-9][0-9][0-9][0-9]')
    CHECK(payable_amount NOT GLOB '*[^0-9.]*')
    CHECK(length(payable_amount) - length(replace(payable_amount, '.', '')) = 1)
    CHECK(payable_amount NOT GLOB '0[0-9]*'),
  pricing_pipeline_version TEXT NOT NULL CHECK(length(pricing_pipeline_version) > 0),
  pricing_policy_version TEXT NOT NULL CHECK(length(pricing_policy_version) > 0),
  promotion_policy_version TEXT CHECK(promotion_policy_version IS NULL OR length(promotion_policy_version) > 0),
  tax_policy_version TEXT NOT NULL CHECK(length(tax_policy_version) > 0),
  rounding_policy_version TEXT NOT NULL CHECK(length(rounding_policy_version) > 0),
  pricing_snapshot TEXT NOT NULL,
  tax_snapshot TEXT NOT NULL,
  calculation_checksum TEXT NOT NULL CHECK(length(calculation_checksum) = 64),
  operation_id TEXT NOT NULL CHECK(length(operation_id) = 36),
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) > 0),
  request_checksum TEXT NOT NULL CHECK(length(request_checksum) = 64),
  correlation_id TEXT NOT NULL CHECK(length(correlation_id) = 36),
  causation_id TEXT CHECK(causation_id IS NULL OR length(causation_id) = 36),
  version INTEGER NOT NULL CHECK(version > 0),
  created_at TEXT NOT NULL,
  completed_at TEXT,
  cancelled_at TEXT,
  expired_at TEXT,
  server_recorded_at TEXT,
  CHECK((cash_register_id IS NULL) = (cash_shift_id IS NULL)),
  CHECK(status <> 'COMPLETED' OR completed_at IS NOT NULL),
  CHECK(status <> 'CANCELLED' OR cancelled_at IS NOT NULL),
  CHECK(status <> 'EXPIRED' OR expired_at IS NOT NULL),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (operation_id) REFERENCES runtime_operations(operation_id)
) WITHOUT ROWID, STRICT;
CREATE UNIQUE INDEX sales_sales_document_idx
  ON sales_sales(tenant_id, branch_id, document_series, sale_number);
CREATE UNIQUE INDEX sales_sales_idempotency_idx
  ON sales_sales(tenant_id, origin_device_id, idempotency_key);
CREATE UNIQUE INDEX sales_sales_operation_idx
  ON sales_sales(operation_id);
CREATE INDEX sales_sales_status_idx
  ON sales_sales(tenant_id, branch_id, status, created_at);

CREATE TABLE sales_sale_items (
  id TEXT NOT NULL CHECK(length(id) = 36),
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) = 36),
  sale_id TEXT NOT NULL CHECK(length(sale_id) = 36),
  line_number INTEGER NOT NULL CHECK(line_number > 0),
  product_id TEXT NOT NULL CHECK(length(product_id) = 36),
  variant_id TEXT CHECK(variant_id IS NULL OR length(variant_id) = 36),
  presentation_id TEXT NOT NULL CHECK(length(presentation_id) = 36),
  product_name_snapshot TEXT NOT NULL CHECK(length(product_name_snapshot) > 0),
  presentation_name_snapshot TEXT NOT NULL CHECK(length(presentation_name_snapshot) > 0),
  identifier_snapshot TEXT,
  unit_id TEXT NOT NULL CHECK(length(unit_id) = 36),
  unit_code_snapshot TEXT NOT NULL CHECK(length(unit_code_snapshot) > 0),
  unit_precision_snapshot INTEGER NOT NULL CHECK(unit_precision_snapshot >= 0),
  quantity TEXT NOT NULL
    CHECK(quantity GLOB '[0-9]*.[0-9][0-9][0-9][0-9][0-9][0-9]')
    CHECK(quantity NOT GLOB '*[^0-9.]*')
    CHECK(length(quantity) - length(replace(quantity, '.', '')) = 1)
    CHECK(quantity NOT GLOB '0[0-9]*')
    CHECK(quantity <> '0.000000'),
  unit_price_amount TEXT NOT NULL
    CHECK(unit_price_amount GLOB '[0-9]*.[0-9][0-9][0-9][0-9][0-9][0-9]')
    CHECK(unit_price_amount NOT GLOB '*[^0-9.]*')
    CHECK(length(unit_price_amount) - length(replace(unit_price_amount, '.', '')) = 1)
    CHECK(unit_price_amount NOT GLOB '0[0-9]*'),
  gross_amount TEXT NOT NULL
    CHECK(gross_amount GLOB '[0-9]*.[0-9][0-9][0-9][0-9][0-9][0-9]')
    CHECK(gross_amount NOT GLOB '*[^0-9.]*')
    CHECK(length(gross_amount) - length(replace(gross_amount, '.', '')) = 1)
    CHECK(gross_amount NOT GLOB '0[0-9]*'),
  discount_amount TEXT NOT NULL
    CHECK(discount_amount GLOB '[0-9]*.[0-9][0-9][0-9][0-9][0-9][0-9]')
    CHECK(discount_amount NOT GLOB '*[^0-9.]*')
    CHECK(length(discount_amount) - length(replace(discount_amount, '.', '')) = 1)
    CHECK(discount_amount NOT GLOB '0[0-9]*'),
  taxable_amount TEXT NOT NULL
    CHECK(taxable_amount GLOB '[0-9]*.[0-9][0-9][0-9][0-9][0-9][0-9]')
    CHECK(taxable_amount NOT GLOB '*[^0-9.]*')
    CHECK(length(taxable_amount) - length(replace(taxable_amount, '.', '')) = 1)
    CHECK(taxable_amount NOT GLOB '0[0-9]*'),
  tax_amount TEXT NOT NULL
    CHECK(tax_amount GLOB '[0-9]*.[0-9][0-9][0-9][0-9][0-9][0-9]')
    CHECK(tax_amount NOT GLOB '*[^0-9.]*')
    CHECK(length(tax_amount) - length(replace(tax_amount, '.', '')) = 1)
    CHECK(tax_amount NOT GLOB '0[0-9]*'),
  line_total_amount TEXT NOT NULL
    CHECK(line_total_amount GLOB '[0-9]*.[0-9][0-9][0-9][0-9][0-9][0-9]')
    CHECK(line_total_amount NOT GLOB '*[^0-9.]*')
    CHECK(length(line_total_amount) - length(replace(line_total_amount, '.', '')) = 1)
    CHECK(line_total_amount NOT GLOB '0[0-9]*'),
  pricing_resolution_snapshot TEXT NOT NULL,
  tax_calculation_snapshot TEXT NOT NULL,
  lot_id TEXT CHECK(lot_id IS NULL OR length(lot_id) = 36),
  measurement_source_type TEXT,
  measurement_evidence_snapshot TEXT,
  measurement_evidence_checksum TEXT CHECK(
    measurement_evidence_checksum IS NULL OR length(measurement_evidence_checksum) = 64
  ),
  CHECK((measurement_source_type IS NULL) = (measurement_evidence_snapshot IS NULL)),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, sale_id) REFERENCES sales_sales(tenant_id, id)
) WITHOUT ROWID, STRICT;
CREATE UNIQUE INDEX sales_sale_items_line_idx
  ON sales_sale_items(tenant_id, sale_id, line_number);

CREATE TABLE sandbox_catalog_product (
  id TEXT NOT NULL CHECK(length(id) = 36),
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) = 36),
  company_id TEXT NOT NULL CHECK(length(company_id) = 36),
  branch_id TEXT NOT NULL CHECK(length(branch_id) = 36),
  name TEXT NOT NULL CHECK(length(name) > 0),
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','INACTIVE')),
  stock_controlled INTEGER NOT NULL CHECK(stock_controlled IN (0, 1)),
  PRIMARY KEY (tenant_id, id)
) WITHOUT ROWID, STRICT;

CREATE TABLE sandbox_catalog_presentation (
  id TEXT NOT NULL CHECK(length(id) = 36),
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) = 36),
  product_id TEXT NOT NULL CHECK(length(product_id) = 36),
  name TEXT NOT NULL CHECK(length(name) > 0),
  unit_id TEXT NOT NULL CHECK(length(unit_id) = 36),
  unit_code TEXT NOT NULL CHECK(length(unit_code) > 0),
  unit_precision INTEGER NOT NULL CHECK(unit_precision >= 0),
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','INACTIVE')),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, product_id) REFERENCES sandbox_catalog_product(tenant_id, id)
) WITHOUT ROWID, STRICT;

CREATE TABLE sandbox_price_rule (
  id TEXT NOT NULL CHECK(length(id) = 36),
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) = 36),
  presentation_id TEXT NOT NULL CHECK(length(presentation_id) = 36),
  amount TEXT NOT NULL
    CHECK(amount GLOB '[0-9]*.[0-9][0-9][0-9][0-9][0-9][0-9]')
    CHECK(amount NOT GLOB '*[^0-9.]*')
    CHECK(length(amount) - length(replace(amount, '.', '')) = 1)
    CHECK(amount NOT GLOB '0[0-9]*'),
  currency_code TEXT NOT NULL CHECK(length(currency_code) = 3),
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','INACTIVE')),
  PRIMARY KEY (tenant_id, id)
) WITHOUT ROWID, STRICT;
CREATE UNIQUE INDEX sandbox_price_rule_active_idx
  ON sandbox_price_rule(tenant_id, presentation_id)
  WHERE status = 'ACTIVE';
`.trim();

// Payment V1 (DEC-016). Cuatro tablas: grupo de cobro, componente de pago,
// intento técnico e imputación confirmada.
//
// Los CHECK de estado y método llevan los enums COMPLETOS de `PAY-007` y de
// `payments-schema.md`, no el subconjunto alcanzable en V1 (DEC-016 §4).
// Motivo: SQLite no permite alterar un CHECK, de modo que restringirlo al
// subconjunto obligaría a reconstruir la tabla al habilitar proveedores —el
// mismo riesgo que DEC-012 D4 documentó para MIGRATION_008—. DEC-016 §9.3 exige
// que los estados inalcanzables sean «detectables por prueba», no por
// constraint, y así se verifican.
//
// `tendered_amount` y `change_amount` son forense de efectivo (decisión D-5):
// informan lo entregado y el vuelto SIN producir un segundo movimiento de caja.
//
// `payments_payment_allocations` es la ÚNICA fuente de cobertura confirmada. Su
// índice por sujeto sostiene la guarda de completion de DEC-016 §5.5.
const MIGRATION_011 = `
CREATE TABLE payments_payment_groups (
  id TEXT NOT NULL CHECK(length(id) = 36),
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) = 36),
  company_id TEXT NOT NULL CHECK(length(company_id) = 36),
  branch_id TEXT NOT NULL CHECK(length(branch_id) = 36),
  collection_subject_type TEXT NOT NULL CHECK(collection_subject_type IN ('SALE')),
  collection_subject_id TEXT NOT NULL CHECK(length(collection_subject_id) = 36),
  currency_code TEXT NOT NULL CHECK(length(currency_code) = 3),
  expected_payable_amount TEXT NOT NULL
    CHECK(expected_payable_amount GLOB '[0-9]*.[0-9][0-9][0-9][0-9][0-9][0-9]')
    CHECK(expected_payable_amount NOT GLOB '*[^0-9.]*')
    CHECK(length(expected_payable_amount) - length(replace(expected_payable_amount, '.', '')) = 1)
    CHECK(expected_payable_amount NOT GLOB '0[0-9]*'),
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) > 0),
  request_checksum TEXT NOT NULL CHECK(length(request_checksum) = 64),
  correlation_id TEXT NOT NULL CHECK(length(correlation_id) = 36),
  causation_id TEXT CHECK(causation_id IS NULL OR length(causation_id) = 36),
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
) WITHOUT ROWID, STRICT;
CREATE UNIQUE INDEX payments_payment_groups_subject_idx
  ON payments_payment_groups(tenant_id, branch_id, collection_subject_type, collection_subject_id);

CREATE TABLE payments_payments (
  id TEXT NOT NULL CHECK(length(id) = 36),
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) = 36),
  company_id TEXT NOT NULL CHECK(length(company_id) = 36),
  branch_id TEXT NOT NULL CHECK(length(branch_id) = 36),
  payment_group_id TEXT NOT NULL CHECK(length(payment_group_id) = 36),
  payment_method TEXT NOT NULL CHECK(payment_method IN (
    'CASH','CARD','TRANSFER','QR','CUSTOMER_CREDIT')),
  authority_type TEXT NOT NULL CHECK(authority_type IN (
    'LOCAL_DEVICE','MANUAL_ATTESTATION','EXTERNAL_PROVIDER_AUTHORITATIVE')),
  status TEXT NOT NULL CHECK(status IN (
    'CREATED','PENDING','PARTIALLY_CONFIRMED','CONFIRMED','FAILED','CANCELLED','REVIEW_REQUIRED')),
  expected_amount TEXT NOT NULL
    CHECK(expected_amount GLOB '[0-9]*.[0-9][0-9][0-9][0-9][0-9][0-9]')
    CHECK(expected_amount NOT GLOB '*[^0-9.]*')
    CHECK(length(expected_amount) - length(replace(expected_amount, '.', '')) = 1)
    CHECK(expected_amount NOT GLOB '0[0-9]*'),
  confirmed_amount TEXT NOT NULL
    CHECK(confirmed_amount GLOB '[0-9]*.[0-9][0-9][0-9][0-9][0-9][0-9]')
    CHECK(confirmed_amount NOT GLOB '*[^0-9.]*')
    CHECK(length(confirmed_amount) - length(replace(confirmed_amount, '.', '')) = 1)
    CHECK(confirmed_amount NOT GLOB '0[0-9]*'),
  tendered_amount TEXT CHECK(tendered_amount IS NULL OR (
    tendered_amount GLOB '[0-9]*.[0-9][0-9][0-9][0-9][0-9][0-9]'
    AND tendered_amount NOT GLOB '*[^0-9.]*'
    AND length(tendered_amount) - length(replace(tendered_amount, '.', '')) = 1
    AND tendered_amount NOT GLOB '0[0-9]*')),
  change_amount TEXT CHECK(change_amount IS NULL OR (
    change_amount GLOB '[0-9]*.[0-9][0-9][0-9][0-9][0-9][0-9]'
    AND change_amount NOT GLOB '*[^0-9.]*'
    AND length(change_amount) - length(replace(change_amount, '.', '')) = 1
    AND change_amount NOT GLOB '0[0-9]*')),
  currency_code TEXT NOT NULL CHECK(length(currency_code) = 3),
  origin_device_id TEXT NOT NULL CHECK(length(origin_device_id) = 36),
  installation_id TEXT NOT NULL CHECK(length(installation_id) = 36),
  operator_actor_type TEXT NOT NULL CHECK(operator_actor_type = 'USER'),
  operator_actor_id TEXT NOT NULL CHECK(length(operator_actor_id) = 36),
  confirmed_by_actor_type TEXT CHECK(confirmed_by_actor_type IS NULL OR confirmed_by_actor_type = 'USER'),
  confirmed_by_actor_id TEXT CHECK(confirmed_by_actor_id IS NULL OR length(confirmed_by_actor_id) = 36),
  provider_code TEXT CHECK(provider_code IS NULL OR length(provider_code) > 0),
  provider_reference TEXT CHECK(provider_reference IS NULL OR length(provider_reference) > 0),
  operation_id TEXT NOT NULL CHECK(length(operation_id) = 36),
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) > 0),
  request_checksum TEXT NOT NULL CHECK(length(request_checksum) = 64),
  correlation_id TEXT NOT NULL CHECK(length(correlation_id) = 36),
  causation_id TEXT CHECK(causation_id IS NULL OR length(causation_id) = 36),
  version INTEGER NOT NULL CHECK(version > 0),
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  cancelled_at TEXT,
  server_recorded_at TEXT,
  CHECK((confirmed_by_actor_type IS NULL) = (confirmed_by_actor_id IS NULL)),
  CHECK(status <> 'CONFIRMED' OR confirmed_at IS NOT NULL),
  CHECK(status <> 'CANCELLED' OR cancelled_at IS NOT NULL),
  CHECK(tendered_amount IS NULL OR payment_method = 'CASH'),
  CHECK((tendered_amount IS NULL) = (change_amount IS NULL)),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, payment_group_id) REFERENCES payments_payment_groups(tenant_id, id),
  FOREIGN KEY (operation_id) REFERENCES runtime_operations(operation_id)
) WITHOUT ROWID, STRICT;
CREATE UNIQUE INDEX payments_payments_idempotency_idx
  ON payments_payments(tenant_id, origin_device_id, idempotency_key);
CREATE UNIQUE INDEX payments_payments_operation_idx
  ON payments_payments(operation_id);
CREATE INDEX payments_payments_group_idx
  ON payments_payments(tenant_id, payment_group_id);
CREATE INDEX payments_payments_status_idx
  ON payments_payments(tenant_id, branch_id, status, created_at);

CREATE TABLE payments_payment_attempts (
  id TEXT NOT NULL CHECK(length(id) = 36),
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) = 36),
  company_id TEXT NOT NULL CHECK(length(company_id) = 36),
  branch_id TEXT NOT NULL CHECK(length(branch_id) = 36),
  payment_id TEXT NOT NULL CHECK(length(payment_id) = 36),
  attempt_number INTEGER NOT NULL CHECK(attempt_number > 0),
  payment_method TEXT NOT NULL CHECK(payment_method IN (
    'CASH','CARD','TRANSFER','QR','CUSTOMER_CREDIT')),
  authority_type TEXT NOT NULL CHECK(authority_type IN (
    'LOCAL_DEVICE','MANUAL_ATTESTATION','EXTERNAL_PROVIDER_AUTHORITATIVE')),
  status TEXT NOT NULL CHECK(status IN (
    'CREATED','PENDING','PROCESSING','REQUIRES_ACTION','CONFIRMED','DECLINED',
    'FAILED','EXPIRED','CANCELLED','UNKNOWN','REVIEW_REQUIRED')),
  amount TEXT NOT NULL
    CHECK(amount GLOB '[0-9]*.[0-9][0-9][0-9][0-9][0-9][0-9]')
    CHECK(amount NOT GLOB '*[^0-9.]*')
    CHECK(length(amount) - length(replace(amount, '.', '')) = 1)
    CHECK(amount NOT GLOB '0[0-9]*'),
  currency_code TEXT NOT NULL CHECK(length(currency_code) = 3),
  provider_code TEXT CHECK(provider_code IS NULL OR length(provider_code) > 0),
  provider_reference_type TEXT CHECK(provider_reference_type IS NULL OR length(provider_reference_type) > 0),
  provider_reference TEXT CHECK(provider_reference IS NULL OR length(provider_reference) > 0),
  manual_confirmation_actor_id TEXT CHECK(manual_confirmation_actor_id IS NULL OR length(manual_confirmation_actor_id) = 36),
  error_code TEXT CHECK(error_code IS NULL OR length(error_code) > 0),
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) > 0),
  request_checksum TEXT NOT NULL CHECK(length(request_checksum) = 64),
  correlation_id TEXT NOT NULL CHECK(length(correlation_id) = 36),
  causation_id TEXT CHECK(causation_id IS NULL OR length(causation_id) = 36),
  version INTEGER NOT NULL CHECK(version > 0),
  initiated_at TEXT NOT NULL,
  provider_reported_at TEXT,
  confirmed_at TEXT,
  server_recorded_at TEXT,
  CHECK(status <> 'CONFIRMED' OR confirmed_at IS NOT NULL),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, payment_id) REFERENCES payments_payments(tenant_id, id)
) WITHOUT ROWID, STRICT;
CREATE UNIQUE INDEX payments_payment_attempts_number_idx
  ON payments_payment_attempts(tenant_id, payment_id, attempt_number);
CREATE UNIQUE INDEX payments_payment_attempts_provider_reference_idx
  ON payments_payment_attempts(tenant_id, provider_code, provider_reference_type, provider_reference)
  WHERE provider_reference IS NOT NULL;

CREATE TABLE payments_payment_allocations (
  id TEXT NOT NULL CHECK(length(id) = 36),
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) = 36),
  payment_group_id TEXT NOT NULL CHECK(length(payment_group_id) = 36),
  payment_id TEXT NOT NULL CHECK(length(payment_id) = 36),
  collection_subject_type TEXT NOT NULL CHECK(collection_subject_type IN ('SALE')),
  collection_subject_id TEXT NOT NULL CHECK(length(collection_subject_id) = 36),
  amount TEXT NOT NULL
    CHECK(amount GLOB '[0-9]*.[0-9][0-9][0-9][0-9][0-9][0-9]')
    CHECK(amount NOT GLOB '*[^0-9.]*')
    CHECK(length(amount) - length(replace(amount, '.', '')) = 1)
    CHECK(amount NOT GLOB '0[0-9]*')
    CHECK(amount <> '0.000000'),
  currency_code TEXT NOT NULL CHECK(length(currency_code) = 3),
  allocation_sequence INTEGER NOT NULL CHECK(allocation_sequence > 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, payment_group_id) REFERENCES payments_payment_groups(tenant_id, id),
  FOREIGN KEY (tenant_id, payment_id) REFERENCES payments_payments(tenant_id, id)
) WITHOUT ROWID, STRICT;
CREATE UNIQUE INDEX payments_payment_allocations_sequence_idx
  ON payments_payment_allocations(tenant_id, payment_id, allocation_sequence);
CREATE INDEX payments_payment_allocations_subject_idx
  ON payments_payment_allocations(tenant_id, collection_subject_type, collection_subject_id);
`.trim();

/**
 * `MIGRATION_012` — el adquiriente (`D-9`).
 *
 * Guarda **exactamente** la forma canónica de `FiscalCustomer`
 * (`packages/fiscal-adapters/src/dian/customer.ts`). No hay un segundo modelo
 * de cliente: dos formas del mismo dato acabarían discrepando, y el que
 * discrepe cuando se emite una factura es el que va en el documento fiscal.
 *
 * ## El alcance es la compañía, no la sucursal
 *
 * Un adquiriente es un tercero de la compañía. Que lo capture la caja 3 de la
 * sucursal norte no lo hace suyo: la siguiente venta puede ser en otra caja y
 * volver a pedir la cédula sería un defecto de operación, no una garantía.
 *
 * ## Las reglas del adquiriente son restricciones de almacenamiento
 *
 * Lo que `validateFiscalCustomer` comprueba en memoria, esta tabla lo impone en
 * disco. No es duplicación: son dos guardianes de distinto alcance. El
 * validador informa a un operador con hallazgos que puede corregir; la
 * restricción impide que exista la fila, venga de donde venga —una escritura
 * futura, una migración de datos, una consola abierta sobre el archivo—.
 *
 * En concreto, y cada una con su motivo:
 *
 * - `identification` **sólo dígitos**. La documentación de emisión es taxativa
 *   en que viaja sin DV; un `900123456-7` almacenado se emitiría tal cual.
 * - `verification_digit` es **un solo dígito** o `NULL`. Su valor no se
 *   comprueba —`D-12`— pero su forma sí.
 * - Persona jurídica exige razón social y persona natural exige nombres. Es la
 *   regla documentada `legal_organization_code` `"1"`/`"2"`, y aquí impide la
 *   fila incompleta en vez de descubrirla al emitir.
 * - `fiscal_responsibility_codes` es un texto JSON, y se exige que sea un
 *   **array**. SQLite no tiene tipo array; guardar una cadena suelta que luego
 *   se lea como lista es el fallo silencioso que este CHECK evita.
 *
 * ## Unicidad
 *
 * Un tercero es único por **tipo de documento e identificación dentro de la
 * compañía**. Sin este índice, la misma cédula entraría dos veces con dos `id`
 * distintos y una factura podría emitirse contra la copia desactualizada.
 */
const MIGRATION_012 = `
CREATE TABLE customers_customers (
  id TEXT NOT NULL CHECK(length(id) = 36),
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) = 36),
  company_id TEXT NOT NULL CHECK(length(company_id) = 36),
  identification_document_code TEXT NOT NULL
    CHECK(length(identification_document_code) BETWEEN 1 AND 8),
  identification TEXT NOT NULL
    CHECK(length(identification) BETWEEN 1 AND 40)
    CHECK(identification NOT GLOB '*[^0-9]*'),
  verification_digit TEXT
    CHECK(verification_digit IS NULL OR (
      length(verification_digit) = 1 AND verification_digit GLOB '[0-9]')),
  legal_organization_code TEXT NOT NULL
    CHECK(length(legal_organization_code) BETWEEN 1 AND 8),
  company TEXT CHECK(company IS NULL OR length(company) BETWEEN 1 AND 200),
  names TEXT CHECK(names IS NULL OR length(names) BETWEEN 1 AND 200),
  tribute_code TEXT NOT NULL CHECK(length(tribute_code) BETWEEN 1 AND 8),
  fiscal_responsibility_codes TEXT NOT NULL
    CHECK(json_valid(fiscal_responsibility_codes))
    CHECK(json_type(fiscal_responsibility_codes) = 'array'),
  email TEXT CHECK(email IS NULL OR length(email) BETWEEN 1 AND 200),
  phone TEXT CHECK(phone IS NULL OR length(phone) BETWEEN 1 AND 200),
  address TEXT CHECK(address IS NULL OR length(address) BETWEEN 1 AND 200),
  country_code TEXT CHECK(country_code IS NULL OR length(country_code) BETWEEN 1 AND 200),
  municipality_code TEXT
    CHECK(municipality_code IS NULL OR length(municipality_code) BETWEEN 1 AND 200),
  origin_device_id TEXT NOT NULL CHECK(length(origin_device_id) = 36),
  installation_id TEXT NOT NULL CHECK(length(installation_id) = 36),
  registered_by_actor_type TEXT NOT NULL CHECK(registered_by_actor_type = 'USER'),
  registered_by_actor_id TEXT NOT NULL CHECK(length(registered_by_actor_id) = 36),
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) > 0),
  request_checksum TEXT NOT NULL CHECK(length(request_checksum) = 64),
  correlation_id TEXT NOT NULL CHECK(length(correlation_id) = 36),
  causation_id TEXT CHECK(causation_id IS NULL OR length(causation_id) = 36),
  version INTEGER NOT NULL CHECK(version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(legal_organization_code <> '1' OR company IS NOT NULL),
  CHECK(legal_organization_code <> '2' OR names IS NOT NULL),
  PRIMARY KEY (tenant_id, id)
) WITHOUT ROWID, STRICT;
CREATE UNIQUE INDEX customers_customers_identity_idx
  ON customers_customers(
    tenant_id, company_id, identification_document_code, identification);
CREATE UNIQUE INDEX customers_customers_idempotency_idx
  ON customers_customers(tenant_id, idempotency_key);
`.trim();

/**
 * `MIGRATION_013` — atributos fiscales del catálogo (`D-9`).
 *
 * Es lo que le falta a una línea de venta para poder ir en una factura:
 * `code_reference`, la unidad de medida y el estándar de producto en códigos
 * DIAN, y **la tasa de impuesto**. Sin esto, `calculateSaleLine` no tiene de
 * dónde sacar el impuesto y por eso lo dejaba en cero fijo.
 *
 * ## No cuelga de `sandbox_catalog_*`, y es deliberado
 *
 * Las tablas `sandbox_*` son fixture de `BLOQUE 4C` y desaparecerán cuando
 * exista el catálogo real. Poner un dato **fiscal** detrás de una clave ajena a
 * una tabla llamada «sandbox» acoplaría lo permanente a lo desechable. Esta
 * tabla se referencia por `presentation_id` sin clave ajena, de modo que
 * sobrevive al reemplazo del catálogo sin migración de datos.
 *
 * El precio de esa decisión es que puede haber atributos huérfanos; lo asume el
 * caso de uso, que resuelve presentación y atributo en la misma operación y
 * rechaza la venta si la presentación no existe.
 *
 * ## La tasa lleva la restricción de precisión del proveedor
 *
 * `D-14`: el POS lleva escala 6 y el proveedor acepta dos decimales. En los
 * importes eso se descubre al emitir; en la **tasa** se puede impedir desde el
 * origen, porque una tasa DIAN no tiene más de dos decimales. `substr(...,-4) =
 * '0000'` lo impone en disco.
 *
 * La cota de 0–100 se comprueba **sin coma flotante**: una tasa mayor que 100
 * no es un impuesto, es un error de captura que multiplicaría la base
 * imponible, y comprobarlo con `CAST(... AS REAL)` metería un `double` en una
 * tabla fiscal.
 */
const MIGRATION_013 = `
CREATE TABLE catalog_fiscal_attribute (
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) = 36),
  presentation_id TEXT NOT NULL CHECK(length(presentation_id) = 36),
  code_reference TEXT NOT NULL CHECK(length(code_reference) BETWEEN 1 AND 80),
  unit_measure_code TEXT NOT NULL CHECK(unit_measure_code GLOB '[A-Z0-9][A-Z0-9-]*'),
  standard_code TEXT NOT NULL CHECK(standard_code GLOB '[A-Z0-9][A-Z0-9-]*'),
  tax_code TEXT NOT NULL CHECK(tax_code GLOB '[A-Z0-9][A-Z0-9-]*'),
  tax_rate TEXT NOT NULL
    CHECK(tax_rate GLOB '[0-9]*.[0-9][0-9][0-9][0-9][0-9][0-9]')
    CHECK(tax_rate NOT GLOB '*[^0-9.]*')
    CHECK(length(tax_rate) - length(replace(tax_rate, '.', '')) = 1)
    CHECK(tax_rate NOT GLOB '0[0-9]*')
    CHECK(substr(tax_rate, -4) = '0000')
    CHECK(tax_rate = '100.000000' OR length(substr(tax_rate, 1, instr(tax_rate, '.') - 1)) <= 2),
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','INACTIVE')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, presentation_id)
) WITHOUT ROWID, STRICT;
`.trim();

/**
 * `MIGRATION_014` — el catálogo real.
 *
 * Sustituye a `sandbox_catalog_*`, que era fixture de `BLOQUE 4C` poblado sólo
 * por pruebas. Los diez comercios prioritarios de `business-types.md` necesitan
 * las cuatro cosas que hay aquí y ninguna más para poder vender: una
 * referencia, una presentación con su unidad, un código de barras y un precio.
 *
 * **No trae categorías ni variantes a propósito.** Ningún comercio de la lista
 * está bloqueado hoy por no tenerlas, y añadirlas sin interfaz que las use
 * sería construir sobre una suposición.
 *
 * ## Las tres restricciones que sostienen la caja
 *
 * - **Un código de barras identifica una sola presentación.** Es la más
 *   importante: si dos productos comparten código, el lector no puede decidir
 *   cuál cobrar, y el cajero no tiene forma de saber que eligió mal. El índice
 *   único es parcial porque `barcode` admite `NULL`: no todo producto trae uno,
 *   y `NULL` no colisiona con `NULL`.
 * - **`unit_precision` entre 0 y 6.** Gobierna qué cantidad se puede vender
 *   —`quantityFitsUnitPrecision`—, y 6 es el máximo de la escala del dinero.
 *   Declarar una unidad de peso con precisión 2 es además la mitigación de
 *   `D-18`: por encima de dos decimales la venta no se puede facturar.
 * - **Un solo precio activo por presentación.** Dos precios activos harían que
 *   lo que se cobra dependa del orden de lectura.
 *
 * Las tablas `sandbox_*` **no se borran**: pueden tener datos en instalaciones
 * existentes y en SQLite eliminarlas exige reconstruir. Quedan huérfanas y sin
 * ningún lector en el código (`D-20`).
 */
const MIGRATION_014 = `
CREATE TABLE catalog_product (
  id TEXT NOT NULL CHECK(length(id) = 36),
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) = 36),
  company_id TEXT NOT NULL CHECK(length(company_id) = 36),
  code TEXT NOT NULL CHECK(length(code) BETWEEN 1 AND 64),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','INACTIVE')),
  stock_controlled INTEGER NOT NULL CHECK(stock_controlled IN (0, 1)),
  registered_by_actor_id TEXT NOT NULL CHECK(length(registered_by_actor_id) = 36),
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) > 0),
  correlation_id TEXT NOT NULL CHECK(length(correlation_id) = 36),
  version INTEGER NOT NULL CHECK(version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
) WITHOUT ROWID, STRICT;
CREATE UNIQUE INDEX catalog_product_code_idx
  ON catalog_product(tenant_id, company_id, code);
CREATE UNIQUE INDEX catalog_product_idempotency_idx
  ON catalog_product(tenant_id, idempotency_key);

CREATE TABLE catalog_presentation (
  id TEXT NOT NULL CHECK(length(id) = 36),
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) = 36),
  product_id TEXT NOT NULL CHECK(length(product_id) = 36),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
  unit_code TEXT NOT NULL CHECK(length(unit_code) BETWEEN 1 AND 16),
  unit_precision INTEGER NOT NULL CHECK(unit_precision BETWEEN 0 AND 6),
  barcode TEXT CHECK(barcode IS NULL OR (
    length(barcode) BETWEEN 4 AND 64 AND barcode NOT GLOB '*[^0-9A-Za-z-]*')),
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','INACTIVE')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, product_id) REFERENCES catalog_product(tenant_id, id)
) WITHOUT ROWID, STRICT;
CREATE UNIQUE INDEX catalog_presentation_barcode_idx
  ON catalog_presentation(tenant_id, barcode) WHERE barcode IS NOT NULL;
CREATE INDEX catalog_presentation_product_idx
  ON catalog_presentation(tenant_id, product_id);

CREATE TABLE catalog_price (
  id TEXT NOT NULL CHECK(length(id) = 36),
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) = 36),
  presentation_id TEXT NOT NULL CHECK(length(presentation_id) = 36),
  amount TEXT NOT NULL
    CHECK(amount GLOB '[0-9]*.[0-9][0-9][0-9][0-9][0-9][0-9]')
    CHECK(amount NOT GLOB '*[^0-9.]*')
    CHECK(length(amount) - length(replace(amount, '.', '')) = 1)
    CHECK(amount NOT GLOB '0[0-9]*'),
  currency_code TEXT NOT NULL CHECK(length(currency_code) = 3),
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','INACTIVE')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, presentation_id) REFERENCES catalog_presentation(tenant_id, id)
) WITHOUT ROWID, STRICT;
CREATE UNIQUE INDEX catalog_price_active_idx
  ON catalog_price(tenant_id, presentation_id) WHERE status = 'ACTIVE';
`.trim();

/**
 * `MIGRATION_015` — Inventario: existencia y libro de movimientos.
 *
 * `catalog_product.stock_controlled` existía desde `MIGRATION_014` pero **no
 * gobernaba nada**: no había existencia que descontar ni movimiento que
 * registrar. Un comercio de los diez prioritarios —tienda, minimercado,
 * fruver, carnicería, depósito— no puede operar así: sin existencia no sabe
 * qué reponer, y sin libro no sabe por qué falta.
 *
 * ## Dos tablas y por qué son dos
 *
 * - `inventory_movement` es el **libro**: sólo se inserta, nunca se actualiza.
 *   Es la verdad de por qué la existencia es la que es.
 * - `inventory_stock` es la **existencia derivada**: la suma del libro,
 *   mantenida en la misma transacción para no recorrer el libro entero en cada
 *   escaneo. Que sea derivada la hace comprobable, y hay prueba de que la suma
 *   del libro y la existencia coinciden.
 *
 * ## Lo que el esquema hace imposible
 *
 * - **Existencia negativa.** El `GLOB` de `quantity_on_hand` no admite signo:
 *   una existencia por debajo de cero no se puede escribir. Es la garantía
 *   estructural contra el «mal calculado en inventarios»; el caso de uso puede
 *   tener un fallo, la fila no puede mentir.
 * - **Una venta que sube la existencia.** El `CHECK` que empareja
 *   `movement_type` con `direction` no admite un `SALE` en `IN` ni una
 *   `PURCHASE_RECEIPT` en `OUT`. La dirección no es un campo libre.
 * - **Un movimiento sin responsable ni motivo.** `actor_id` y `reason_code`
 *   son `NOT NULL`. El ajuste es la vía por la que se roba en un POS: quien
 *   ajusta queda escrito, y por qué también.
 * - **El mismo movimiento dos veces.** `idempotency_key` es única por tenant;
 *   un reintento del canal no descuenta dos veces.
 *
 * La existencia es **por sucursal**, no por compañía: el mismo producto tiene
 * existencias distintas en dos locales, y sumarlas sería afirmar que se puede
 * vender en uno lo que está en el otro.
 *
 * `quantity_after` se guarda en cada movimiento a propósito: permite auditar
 * el libro sin reconstruirlo, y detectar una divergencia en el punto exacto en
 * que apareció en lugar de al final.
 */
const MIGRATION_015 = `
CREATE TABLE inventory_stock (
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) = 36),
  company_id TEXT NOT NULL CHECK(length(company_id) = 36),
  branch_id TEXT NOT NULL CHECK(length(branch_id) = 36),
  presentation_id TEXT NOT NULL CHECK(length(presentation_id) = 36),
  quantity_on_hand TEXT NOT NULL
    CHECK(quantity_on_hand GLOB '[0-9]*.[0-9][0-9][0-9][0-9][0-9][0-9]')
    CHECK(quantity_on_hand NOT GLOB '*[^0-9.]*')
    CHECK(length(quantity_on_hand) - length(replace(quantity_on_hand, '.', '')) = 1)
    CHECK(quantity_on_hand NOT GLOB '0[0-9]*'),
  last_movement_sequence INTEGER NOT NULL CHECK(last_movement_sequence >= 0),
  version INTEGER NOT NULL CHECK(version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, branch_id, presentation_id),
  FOREIGN KEY (tenant_id, presentation_id) REFERENCES catalog_presentation(tenant_id, id)
) WITHOUT ROWID, STRICT;
CREATE INDEX inventory_stock_presentation_idx
  ON inventory_stock(tenant_id, presentation_id);

CREATE TABLE inventory_movement (
  id TEXT NOT NULL CHECK(length(id) = 36),
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) = 36),
  company_id TEXT NOT NULL CHECK(length(company_id) = 36),
  branch_id TEXT NOT NULL CHECK(length(branch_id) = 36),
  presentation_id TEXT NOT NULL CHECK(length(presentation_id) = 36),
  stock_sequence INTEGER NOT NULL CHECK(stock_sequence > 0),
  movement_type TEXT NOT NULL CHECK(movement_type IN (
    'OPENING_COUNT','PURCHASE_RECEIPT','SALE_REVERSAL','ADJUSTMENT_POSITIVE','TRANSFER_IN',
    'SALE','ADJUSTMENT_NEGATIVE','SHRINKAGE','TRANSFER_OUT')),
  direction TEXT NOT NULL CHECK(direction IN ('IN','OUT')),
  quantity TEXT NOT NULL
    CHECK(quantity GLOB '[0-9]*.[0-9][0-9][0-9][0-9][0-9][0-9]')
    CHECK(quantity NOT GLOB '*[^0-9.]*')
    CHECK(length(quantity) - length(replace(quantity, '.', '')) = 1)
    CHECK(quantity NOT GLOB '0[0-9]*')
    CHECK(quantity <> '0.000000'),
  quantity_after TEXT NOT NULL
    CHECK(quantity_after GLOB '[0-9]*.[0-9][0-9][0-9][0-9][0-9][0-9]')
    CHECK(quantity_after NOT GLOB '*[^0-9.]*')
    CHECK(length(quantity_after) - length(replace(quantity_after, '.', '')) = 1)
    CHECK(quantity_after NOT GLOB '0[0-9]*'),
  reason_code TEXT NOT NULL CHECK(length(reason_code) BETWEEN 1 AND 64),
  sale_id TEXT CHECK(sale_id IS NULL OR length(sale_id) = 36),
  actor_type TEXT NOT NULL CHECK(actor_type = 'USER'),
  actor_id TEXT NOT NULL CHECK(length(actor_id) = 36),
  operation_id TEXT NOT NULL CHECK(length(operation_id) = 36),
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) > 0),
  correlation_id TEXT NOT NULL CHECK(length(correlation_id) = 36),
  business_date TEXT NOT NULL CHECK(length(business_date) = 10),
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK ((movement_type IN (
    'OPENING_COUNT','PURCHASE_RECEIPT','SALE_REVERSAL','ADJUSTMENT_POSITIVE','TRANSFER_IN'
  )) = (direction = 'IN')),
  CHECK ((movement_type IN ('SALE','SALE_REVERSAL')) = (sale_id IS NOT NULL)),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, presentation_id) REFERENCES catalog_presentation(tenant_id, id)
) WITHOUT ROWID, STRICT;
CREATE UNIQUE INDEX inventory_movement_sequence_idx
  ON inventory_movement(tenant_id, branch_id, presentation_id, stock_sequence);
CREATE UNIQUE INDEX inventory_movement_idempotency_idx
  ON inventory_movement(tenant_id, idempotency_key);
CREATE INDEX inventory_movement_sale_idx
  ON inventory_movement(tenant_id, sale_id) WHERE sale_id IS NOT NULL;
`.trim();

/**
 * `MIGRATION_016` — `D-2-bis`: el intento conserva sus dos identidades.
 *
 * `payments_payment_attempts` tenía **un solo** par
 * `(provider_reference_type, provider_reference)`, y la confirmación lo
 * sobrescribía: el intento nacía con `PROVIDER_INTENT` + la referencia
 * comercial y terminaba con `PROVIDER_TRANSACTION` + el `transaction.id` del
 * proveedor. Una identidad reemplazaba a la otra en la misma casilla, aunque
 * son cosas distintas: la referencia la elige Camacho (`DEC-016` §21, hoy el
 * `payment_id`), el `transaction.id` lo asigna el proveedor y sólo existe
 * cuando éste responde.
 *
 * La columna nueva les da una casilla a cada una. Tras confirmar, el intento
 * dice a la vez con qué referencia se abrió el cobro y qué transacción lo
 * pagó, que es lo que una conciliación futura necesitará leer sin
 * reconstruir nada.
 *
 * **Por qué `016`.** Es el siguiente número del libro, y el libro tiene que
 * seguir siendo contiguo desde 1: `user-audit-migration.test.ts` lo afirma
 * como invariante, no como detalle. `DEC-021` §F1 había anotado este número
 * para el documento fiscal electrónico; esa reserva se resuelve al revés —
 * el fiscal tomará el siguiente disponible cuando se materialice, y §F1
 * queda pendiente de actualizarse entonces. Aquí no se implementa nada
 * fiscal.
 *
 * ## Qué hace imposible el índice
 *
 * El mismo `transaction.id` no puede quedar asociado a dos intentos del mismo
 * tenant y proveedor. Es parcial —`WHERE provider_transaction_id IS NOT
 * NULL`— porque un intento sin respuesta del proveedor todavía no tiene
 * identidad que proteger, y todos esos `NULL` deben poder convivir.
 *
 * Va por `tenant_id` como el resto del esquema: dos tenants distintos pueden
 * ver el mismo identificador sin que uno bloquee al otro.
 *
 * Las filas existentes quedan en `NULL`. No se infiere ningún identificador
 * histórico: el que se hubiera guardado en `provider_reference` bajo
 * `PROVIDER_TRANSACTION` no se migra, porque esta rama no tiene ninguna base
 * persistida de la que hacerlo y adivinarlo sería fabricar evidencia
 * financiera.
 */
const MIGRATION_016 = `
ALTER TABLE payments_payment_attempts
  ADD COLUMN provider_transaction_id TEXT
  CHECK(provider_transaction_id IS NULL OR length(provider_transaction_id) > 0);
CREATE UNIQUE INDEX payments_payment_attempts_provider_transaction_idx
  ON payments_payment_attempts(tenant_id, provider_code, provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL;
`.trim();

/**
 * `MIGRATION_017` — `D-3`: la incertidumbre deja de evaporarse.
 *
 * `PaymentProviderOutcome` ya distingue «no se pudo determinar» de «el
 * proveedor dijo que no», y `payments_payment_attempts.status` ya admitía
 * `'UNKNOWN'` desde el principio porque `PAY-007` lo exige. Faltaba dónde
 * escribir **por qué** y **cuándo**: un intento que quedara `UNKNOWN` no
 * podía decir si fue un timeout, un 5xx o una respuesta ilegible, y la única
 * huella temporal habría sido el asiento de auditoría.
 *
 * No se reutilizó ninguna columna existente. `error_code` habría sido la
 * tentación —está libre— pero nombra como error lo que `D-3` estableció que
 * **no** lo es: un timeout no es un fallo del cobro, es una pregunta sin
 * responder. Y `provider_reported_at` habría mentido en el caso más
 * frecuente: ante un timeout el proveedor no reportó nada.
 *
 * ## Lo que el par hace imposible
 *
 * Los dos campos se escriben juntos o no se escriben: el `CHECK` los empareja,
 * así que no puede existir una razón sin momento ni un momento sin razón. Y la
 * razón está acotada al conjunto cerrado que el puerto declara, de modo que la
 * columna no puede guardar una incertidumbre que el contrato no conoce.
 *
 * **Deliberadamente sin atar a `status`.** Un `CHECK` del tipo «si hay razón,
 * el estado es `UNKNOWN`» habría convertido `UNKNOWN` en terminal: al
 * resolverse a `CONFIRMED` o `DECLINED` la fila dejaría de validar. La razón
 * sobrevive a la resolución porque es historia de lo que pasó, no el estado
 * actual.
 *
 * Las filas existentes quedan con ambos `NULL`: no hay incertidumbre pasada
 * que reconstruir, y deducirla sería inventarla.
 */
const MIGRATION_017 = `
ALTER TABLE payments_payment_attempts
  ADD COLUMN provider_uncertainty_reason TEXT
  CHECK(provider_uncertainty_reason IS NULL OR provider_uncertainty_reason IN (
    'TIMEOUT','NETWORK','PROVIDER_UNAVAILABLE','MALFORMED_RESPONSE','PROVIDER_ERROR'));
ALTER TABLE payments_payment_attempts
  ADD COLUMN provider_uncertainty_observed_at TEXT
  CHECK((provider_uncertainty_observed_at IS NULL) = (provider_uncertainty_reason IS NULL));
`.trim();

/**
 * `MIGRATION_018` — `D-7`: el barrido de inciertos tiene dónde contar.
 *
 * `MIGRATION_017` dejó escrito **por qué** y **cuándo** un intento quedó
 * `UNKNOWN`. Faltaba lo que necesita una resolución automática acotada:
 * cuántas veces se preguntó ya y cuándo toca volver a preguntar. Sin esas dos
 * casillas, la cadencia sólo podría reconstruirse contando asientos de
 * `local_operation_audit` —derivar el contador de la auditoría, que `D-7`
 * prohíbe: la auditoría es historia, no estado de control, y una consulta que
 * fallara antes de auditar dejaría el contador mintiendo—.
 *
 * ## Por qué estos tipos y no otros
 *
 * Son literalmente los de `local_sync_outbox`, que ya resuelve el mismo
 * problema para el envío al servidor: `attempt_count INTEGER NOT NULL DEFAULT
 * 0 CHECK(attempt_count >= 0)` y `next_attempt_at TEXT`. Se copia la
 * convención, **no los valores de la política**: la cadencia del outbox
 * (`DEFAULT_RETRY_POLICY`: 5 intentos, 1 s, tope 60 s) responde a reintentar
 * un envío propio; ésta responde a preguntarle a un tercero por dinero, y
 * `D-5` la fija aparte.
 *
 * ## Semántica de las dos columnas
 *
 * - `attempt_count = 0` significa «nunca consultado automáticamente». La
 *   consulta número *n* se cuenta **antes** de hacerse, así que la primera
 *   consulta ocurre con el contador ya en 1.
 * - `next_attempt_at IS NULL` significa «no hay consulta automática
 *   pendiente»: o nunca la hubo (filas anteriores a esta migración, y los
 *   intentos que no son de proveedor), o la resolución automática terminó.
 *   Un `NULL` **no** es elegible; el selector lo exige explícitamente.
 *
 * Las filas existentes quedan con `0` y `NULL`: ningún intento histórico
 * entra al barrido por el hecho de migrar, que es la única lectura honesta —
 * nadie los consultó y no hay momento pasado que programar.
 *
 * ## El índice
 *
 * Es parcial sobre exactamente el selector real —`status='UNKNOWN'` y
 * `next_attempt_at` no nulo— y su clave es `(tenant_id, next_attempt_at)`,
 * el orden en que el barrido los quiere: vencidos primero, dentro del tenant.
 * No sustituye ni relaja ningún índice de unicidad: `..._number_idx`,
 * `..._provider_reference_idx` y `..._provider_transaction_idx` siguen
 * exactamente como estaban.
 */
const MIGRATION_018 = `
ALTER TABLE payments_payment_attempts
  ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0);
ALTER TABLE payments_payment_attempts
  ADD COLUMN next_attempt_at TEXT;
CREATE INDEX payments_payment_attempts_uncertain_sweep_idx
  ON payments_payment_attempts(tenant_id, next_attempt_at)
  WHERE status = 'UNKNOWN' AND next_attempt_at IS NOT NULL;
`.trim();

/**
 * `MIGRATION_019` — la venta puede decir quién compra.
 *
 * `customers_customers` existe desde `MIGRATION_012` y guarda al adquiriente
 * fiscal —identificación, naturaleza jurídica, responsabilidades DIAN—, pero
 * **ninguna tabla lo referenciaba**: una venta no tenía dónde anotar a su
 * comprador. Esta columna es lo único que faltaba para que pueda.
 *
 * No implementa crédito. Un `customer_id` en la venta dice quién compró, no
 * que deba nada: la deuda, su cupo y sus abonos siguen diferidos a `DEC-005`
 * (`CUST-002`), y `payments-schema.md` §93 prohíbe expresamente crear esos
 * agregados por anticipado. El método `CUSTOMER_CREDIT` ya admitido en
 * `payment_method` sigue siendo vocabulario reservado, no una autorización.
 *
 * ## Por qué NO lleva `REFERENCES` — y por qué eso no es descuido
 *
 * La convención del esquema es la clave compuesta: toda FK existente lleva el
 * tenant delante (`(tenant_id, cash_register_id)`, `(tenant_id, sale_id)`,
 * `(tenant_id, payment_id)`). Lo correcto aquí sería
 * `FOREIGN KEY (tenant_id, customer_id) REFERENCES customers_customers(tenant_id, id)`.
 *
 * SQLite no lo permite por esta vía, y las tres salidas se comprobaron
 * ejecutándolas contra `better-sqlite3`, no de memoria:
 *
 * 1. `ALTER TABLE … ADD COLUMN` con una FK compuesta es **error de sintaxis**:
 *    la cláusula `REFERENCES` de `ADD COLUMN` es de una sola columna.
 * 2. Una FK simple a `customers_customers(id)` **se acepta al crearla** y
 *    falla con `foreign key mismatch` la primera vez que una venta nombre de
 *    verdad a un cliente —la PK del padre es `(tenant_id, id)` y no hay índice
 *    único sobre `id` solo—. Sería un fallo diferido a producción, aplicado
 *    limpiamente en todos los equipos y roto en la primera venta real. Esa es
 *    la peor de las tres y por eso no está aquí.
 * 3. El rebuild de doce pasos daría la FK compuesta, pero `applyMigrations`
 *    envuelve cada migración en una transacción y `PRAGMA foreign_keys` es
 *    **no-op dentro de una transacción** (verificado: sigue leyendo `1`).
 *    Con las FK activas, `DROP TABLE sales_sales` falla porque
 *    `sales_sale_items` la referencia. El único precedente de rebuild del
 *    repo —`MIGRATION_008` sobre `local_operation_audit`— funcionó porque
 *    aquella tabla no tiene hijos; ésta sí.
 *
 * Así que la integridad la sostiene la capa confiable: `SqliteSaleStore`
 * comprueba `(tenant_id, customer_id)` **dentro de la misma transacción** que
 * crea la venta, antes de escribir nada. El Local Service es el único
 * escritor, de modo que no hay segunda puerta por la que entre un cliente
 * ajeno. Queda anotado como `D-27` en `materialization-state.md`: es una
 * garantía de aplicación donde el esquema querría una estructural, y se cierra
 * cuando `sales_sales` se reconstruya por cualquier otro motivo.
 *
 * El `CHECK` de longitud es la parte que sí cabe en disco: un `customer_id`
 * que no tenga forma de UUID no entra, venga de donde venga.
 */
const MIGRATION_019 = `
ALTER TABLE sales_sales
  ADD COLUMN customer_id TEXT
  CHECK(customer_id IS NULL OR length(customer_id) = 36);
`.trim();

/**
 * `MIGRATION_020` — el fiado tiene dónde vivir (`CUST-002` / `PAY-009`).
 *
 * `DEC-005` ratificó la política: el crédito **cubre** la venta —de modo que
 * `completeSaleIfCovered` la completa y la mercancía sale— y la obligación se
 * registra **aparte**. Estas dos tablas son ese «aparte», y nada más.
 *
 * ## El saldo no se guarda
 *
 * No hay columna de saldo. Se deriva sumando el libro:
 * `Σ(INCREASE) − Σ(DECREASE)`, recomputado dentro de la transacción que va a
 * escribir. Es la misma elección que `DEC-016` §5.5 hizo para la cobertura de
 * una venta, y por la misma razón: un saldo guardado y un libro pueden
 * discrepar, y cuando discrepan sobre dinero ajeno nadie sabe cuál miente.
 * Inventario eligió lo contrario —`inventory_stock.quantity_on_hand`— porque su
 * lectura ocurre por línea de venta y sus movimientos son muchos; el libro de
 * un cliente de barrio tiene decenas de filas y `..._account_idx` hace la suma
 * trivial.
 *
 * ## Lo que estas tablas deliberadamente NO tienen
 *
 * - **`status` en la cuenta.** No tener cuenta *es* no tener crédito; ése es el
 *   interruptor. Suspender conservando el saldo es una necesidad real y es de
 *   `CUST-003`; añadir el estado ahora sería inventar una máquina que nadie
 *   pidió y que ningún caso de uso recorre.
 * - **Tipos de movimiento más allá de dos.** `SALE_CREDIT` origina la deuda,
 *   `CUSTOMER_PAYMENT` la reduce. Ajuste y reversión quedan fuera: la ruta de
 *   reembolso contra crédito es `UC-PAY-004` §661 y está diferida, y anular una
 *   venta sigue bloqueado por `D-22`. Un `ADJUSTMENT` sin caso de uso es la
 *   puerta que `D-21` ya señala como abusable.
 * - **Intereses, mora, antigüedad.** Materializar el saldo es un paso;
 *   envejecerlo y cobrarlo son otros.
 *
 * ## Append-only por contrato
 *
 * `customers_credit_transactions` no se actualiza ni se borra: el almacén no
 * emite `UPDATE` ni `DELETE` contra ella. Es la misma disciplina que
 * `cash_movement` e `inventory_movement`, que tampoco llevan triggers. Los
 * triggers `no_update`/`no_delete` existen en el repo para auditoría, inbox y
 * snapshots; ponerlos sólo en este libro y no en los otros dos libros de dinero
 * crearía una asimetría que confunde más de lo que protege. Si se quieren, van
 * en los tres a la vez, y eso es otro bloque.
 *
 * ## Las claves foráneas sí son compuestas
 *
 * Tablas nuevas, así que la FK compuesta cabe dentro del `CREATE TABLE`: la
 * limitación que obligó a `D-27` sólo afecta a `ALTER TABLE ADD COLUMN`. Aquí
 * el aislamiento por tenant es estructural, no de aplicación.
 */
const MIGRATION_020 = `
CREATE TABLE customers_credit_accounts (
  id TEXT NOT NULL CHECK(length(id) = 36),
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) = 36),
  company_id TEXT NOT NULL CHECK(length(company_id) = 36),
  customer_id TEXT NOT NULL CHECK(length(customer_id) = 36),
  credit_limit TEXT NOT NULL
    CHECK(credit_limit GLOB '[0-9]*.[0-9][0-9][0-9][0-9][0-9][0-9]')
    CHECK(credit_limit NOT GLOB '*[^0-9.]*')
    CHECK(length(credit_limit) - length(replace(credit_limit, '.', '')) = 1)
    CHECK(credit_limit NOT GLOB '0[0-9]*'),
  currency_code TEXT NOT NULL CHECK(length(currency_code) = 3),
  opened_by_actor_type TEXT NOT NULL CHECK(opened_by_actor_type = 'USER'),
  opened_by_actor_id TEXT NOT NULL CHECK(length(opened_by_actor_id) = 36),
  origin_device_id TEXT NOT NULL CHECK(length(origin_device_id) = 36),
  installation_id TEXT NOT NULL CHECK(length(installation_id) = 36),
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) > 0),
  request_checksum TEXT NOT NULL CHECK(length(request_checksum) = 64),
  correlation_id TEXT NOT NULL CHECK(length(correlation_id) = 36),
  causation_id TEXT CHECK(causation_id IS NULL OR length(causation_id) = 36),
  version INTEGER NOT NULL CHECK(version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  server_recorded_at TEXT,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers_customers(tenant_id, id)
) WITHOUT ROWID, STRICT;
CREATE UNIQUE INDEX customers_credit_accounts_customer_idx
  ON customers_credit_accounts(tenant_id, customer_id);
CREATE UNIQUE INDEX customers_credit_accounts_idempotency_idx
  ON customers_credit_accounts(tenant_id, origin_device_id, idempotency_key);

CREATE TABLE customers_credit_transactions (
  id TEXT NOT NULL CHECK(length(id) = 36),
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) = 36),
  company_id TEXT NOT NULL CHECK(length(company_id) = 36),
  branch_id TEXT NOT NULL CHECK(length(branch_id) = 36),
  credit_account_id TEXT NOT NULL CHECK(length(credit_account_id) = 36),
  account_sequence INTEGER NOT NULL CHECK(account_sequence > 0),
  transaction_type TEXT NOT NULL CHECK(transaction_type IN (
    'SALE_CREDIT','CUSTOMER_PAYMENT')),
  direction TEXT NOT NULL CHECK(direction IN ('INCREASE','DECREASE')),
  amount TEXT NOT NULL
    CHECK(amount GLOB '[0-9]*.[0-9][0-9][0-9][0-9][0-9][0-9]')
    CHECK(amount NOT GLOB '*[^0-9.]*')
    CHECK(length(amount) - length(replace(amount, '.', '')) = 1)
    CHECK(amount NOT GLOB '0[0-9]*')
    CHECK(amount <> '0.000000'),
  currency_code TEXT NOT NULL CHECK(length(currency_code) = 3),
  sale_id TEXT CHECK(sale_id IS NULL OR length(sale_id) = 36),
  payment_id TEXT CHECK(payment_id IS NULL OR length(payment_id) = 36),
  actor_type TEXT NOT NULL CHECK(actor_type = 'USER'),
  actor_id TEXT NOT NULL CHECK(length(actor_id) = 36),
  origin_device_id TEXT NOT NULL CHECK(length(origin_device_id) = 36),
  installation_id TEXT NOT NULL CHECK(length(installation_id) = 36),
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) > 0),
  request_checksum TEXT NOT NULL CHECK(length(request_checksum) = 64),
  correlation_id TEXT NOT NULL CHECK(length(correlation_id) = 36),
  causation_id TEXT CHECK(causation_id IS NULL OR length(causation_id) = 36),
  version INTEGER NOT NULL CHECK(version > 0),
  created_at TEXT NOT NULL,
  server_recorded_at TEXT,
  CHECK(transaction_type <> 'SALE_CREDIT' OR direction = 'INCREASE'),
  CHECK(transaction_type <> 'CUSTOMER_PAYMENT' OR direction = 'DECREASE'),
  CHECK(transaction_type <> 'SALE_CREDIT' OR (sale_id IS NOT NULL AND payment_id IS NOT NULL)),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, credit_account_id) REFERENCES customers_credit_accounts(tenant_id, id),
  FOREIGN KEY (tenant_id, sale_id) REFERENCES sales_sales(tenant_id, id),
  FOREIGN KEY (tenant_id, payment_id) REFERENCES payments_payments(tenant_id, id)
) WITHOUT ROWID, STRICT;
CREATE UNIQUE INDEX customers_credit_transactions_sequence_idx
  ON customers_credit_transactions(tenant_id, credit_account_id, account_sequence);
CREATE UNIQUE INDEX customers_credit_transactions_idempotency_idx
  ON customers_credit_transactions(tenant_id, origin_device_id, idempotency_key);
CREATE INDEX customers_credit_transactions_account_idx
  ON customers_credit_transactions(tenant_id, credit_account_id);
`.trim();

/**
 * `MIGRATION_021` — el atributo fiscal cuelga del catálogo real (`D-17`).
 *
 * `catalog_fiscal_attribute` nació en `MIGRATION_013`, **una migración antes**
 * que el catálogo real: cuando se escribió, `catalog_presentation` todavía no
 * existía y no había a qué apuntar. Por eso su `presentation_id` quedó sin
 * clave ajena, y ahí siguió después de que `MIGRATION_014` creara el catálogo.
 *
 * La consecuencia que `D-17` anotó es concreta: **un atributo fiscal puede
 * quedar apuntando a una presentación borrada**. Y no es un huérfano inocuo —
 * `create-sale-use-case.ts` lee `getFiscalAttribute` por línea para decidir el
 * impuesto, de modo que un atributo desalineado es una tasa equivocada
 * esperando su venta.
 *
 * ## Por qué aquí sí cabe reconstruir, y en `sales_sales` no cupo
 *
 * SQLite no tiene `ADD CONSTRAINT`: una clave ajena sólo entra al crear la
 * tabla. `D-27` dejó escrito por qué `sales_sales` no se puede reconstruir bajo
 * este runner —`sales_sale_items` la referencia, y `PRAGMA foreign_keys` es
 * no-op dentro de la transacción que envuelve cada migración—.
 *
 * Aquí **nadie referencia** `catalog_fiscal_attribute`: no tiene tablas hijas,
 * ni índices propios, ni claves ajenas que rehacer. Es exactamente el caso de
 * `MIGRATION_008` sobre `local_operation_audit`, el único precedente de
 * reconstrucción del repositorio, y funciona por la misma razón. Comprobado
 * ejecutándolo antes de escribirlo: el `DROP` no viola nada, el `RENAME` no
 * tiene referencias ajenas que reescribir, y la tabla resultante rechaza tanto
 * un huérfano como un atributo de otro tenant.
 *
 * ## Qué hace la copia si encuentra un huérfano
 *
 * **Falla, y el arranque se detiene.** El `INSERT … SELECT` comprueba la clave
 * ajena fila a fila, así que un atributo apuntando a una presentación
 * inexistente aborta la migración entera.
 *
 * Es deliberado. La alternativa —copiar sólo las filas cuya presentación
 * exista— borraría configuración fiscal en silencio, que es peor que no
 * arrancar: nadie se enteraría hasta emitir una factura con el impuesto
 * equivocado. Y el riesgo real es nulo: **ninguna ruta de usuario inserta en
 * esta tabla** —sólo los fixtures de prueba—, de modo que en una instalación
 * real la copia no mueve una sola fila.
 *
 * La definición se reproduce **íntegra**: mismos `CHECK`, misma clave primaria,
 * mismo `WITHOUT ROWID, STRICT`. Lo único que cambia es la línea que faltaba.
 */
const MIGRATION_021 = `
CREATE TABLE catalog_fiscal_attribute_rebuilt (
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) = 36),
  presentation_id TEXT NOT NULL CHECK(length(presentation_id) = 36),
  code_reference TEXT NOT NULL CHECK(length(code_reference) BETWEEN 1 AND 80),
  unit_measure_code TEXT NOT NULL CHECK(unit_measure_code GLOB '[A-Z0-9][A-Z0-9-]*'),
  standard_code TEXT NOT NULL CHECK(standard_code GLOB '[A-Z0-9][A-Z0-9-]*'),
  tax_code TEXT NOT NULL CHECK(tax_code GLOB '[A-Z0-9][A-Z0-9-]*'),
  tax_rate TEXT NOT NULL
    CHECK(tax_rate GLOB '[0-9]*.[0-9][0-9][0-9][0-9][0-9][0-9]')
    CHECK(tax_rate NOT GLOB '*[^0-9.]*')
    CHECK(length(tax_rate) - length(replace(tax_rate, '.', '')) = 1)
    CHECK(tax_rate NOT GLOB '0[0-9]*')
    CHECK(substr(tax_rate, -4) = '0000')
    CHECK(tax_rate = '100.000000' OR length(substr(tax_rate, 1, instr(tax_rate, '.') - 1)) <= 2),
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','INACTIVE')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, presentation_id),
  FOREIGN KEY (tenant_id, presentation_id) REFERENCES catalog_presentation(tenant_id, id)
) WITHOUT ROWID, STRICT;

INSERT INTO catalog_fiscal_attribute_rebuilt(
  tenant_id, presentation_id, code_reference, unit_measure_code, standard_code,
  tax_code, tax_rate, status, created_at, updated_at
)
SELECT
  tenant_id, presentation_id, code_reference, unit_measure_code, standard_code,
  tax_code, tax_rate, status, created_at, updated_at
FROM catalog_fiscal_attribute;

DROP TABLE catalog_fiscal_attribute;

ALTER TABLE catalog_fiscal_attribute_rebuilt RENAME TO catalog_fiscal_attribute;
`.trim();

/**
 * `MIGRATION_023` — Documento electrónico y rango de numeración (`DEC-021` F1).
 *
 * **Renumerada de `016` a `023` al unificar las ramas (2026-09-20).** Dos
 * líneas de trabajo paralelas crearon un `MIGRATION_016` distinto cada una:
 * ésta y la de `provider_transaction_id` (`D-2-bis`). El desempate lo dejó
 * escrito la propia `016` superviviente: «`DEC-021` §F1 había anotado este
 * número para el documento fiscal electrónico; esa reserva se resuelve al
 * revés — el fiscal tomará el siguiente disponible cuando se materialice».
 * Se renumera ésta porque arrastra una sola migración y la otra arrastra
 * siete. Ninguna base desplegada existe todavía, así que renumerar es seguro
 * hoy; en cuanto exista una, deja de serlo. `DEC-021` §F1 queda pendiente de
 * actualizar este número.
 *
 * Existe por una razon concreta y no por simetria con el esquema central: **el
 * desenlace incierto**. Si la peticion sale y la respuesta se pierde, el
 * documento puede estar emitido en la DIAN; reintentar sin identidad persistida
 * emite una segunda factura con otro consecutivo, y una factura duplicada ante
 * la DIAN no se deshace. `DEC-021` §4 lo llama la unica pieza cuya ausencia
 * produce dano irreversible, y por eso va antes que todo lo demas.
 *
 * Las invariantes que `outcome.ts` expresa como forma del tipo se repiten aqui
 * como `CHECK`. No es redundancia: el tipo protege al programa, el `CHECK`
 * protege al fichero. Un documento escrito por una version futura con un error
 * de estado no puede quedar en disco afirmando un resultado fiscal que nadie
 * evidencio.
 *
 * **Lo que esta migracion no hace:** no emite, no ensambla payload, no resuelve
 * credencial y no asigna consecutivos. `NumberingRangePort` prohibe la
 * asignacion local cuando la autoridad es del proveedor, de modo que
 * `current_number` aqui es informativo y nunca fuente de un consecutivo.
 */
const MIGRATION_023 = `
CREATE TABLE fiscal_numbering_range (
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) = 36),
  company_id TEXT NOT NULL CHECK(length(company_id) = 36),
  provider TEXT NOT NULL CHECK(provider IN ('SIIGO','FACTUS','ALEGRA','THE_FACTORY_HKA','ODOO')),
  environment TEXT NOT NULL CHECK(environment IN ('SANDBOX','PRODUCTION')),
  range_id TEXT NOT NULL CHECK(length(range_id) BETWEEN 1 AND 128),
  document_type TEXT NOT NULL CHECK(document_type IN (
    'SALES_INVOICE','CREDIT_NOTE','DEBIT_NOTE','SUPPORT_DOCUMENT','SUPPORT_DOCUMENT_ADJUSTMENT_NOTE')),
  prefix TEXT NOT NULL CHECK(length(prefix) BETWEEN 1 AND 20),
  authority TEXT NOT NULL CHECK(authority IN ('PROVIDER','LOCAL','UNKNOWN')),
  resolution_number TEXT CHECK(resolution_number IS NULL OR length(resolution_number) BETWEEN 1 AND 64),
  range_from INTEGER NOT NULL CHECK(range_from > 0),
  range_to INTEGER NOT NULL CHECK(range_to >= range_from),
  current_number INTEGER CHECK(current_number IS NULL OR current_number >= 0),
  valid_from TEXT CHECK(valid_from IS NULL OR length(valid_from) >= 10),
  valid_until TEXT CHECK(valid_until IS NULL OR length(valid_until) >= 10),
  provider_active INTEGER CHECK(provider_active IS NULL OR provider_active IN (0,1)),
  provider_expired INTEGER CHECK(provider_expired IS NULL OR provider_expired IN (0,1)),
  provider_document_code TEXT CHECK(provider_document_code IS NULL OR length(provider_document_code) BETWEEN 1 AND 64),
  synchronized_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, provider, environment, range_id)
) WITHOUT ROWID, STRICT;
CREATE INDEX fiscal_numbering_range_document_type_idx
  ON fiscal_numbering_range(tenant_id, provider, environment, document_type);

CREATE TABLE fiscal_electronic_document (
  id TEXT NOT NULL CHECK(length(id) = 36),
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) = 36),
  company_id TEXT NOT NULL CHECK(length(company_id) = 36),
  branch_id TEXT NOT NULL CHECK(length(branch_id) = 36),
  sale_id TEXT NOT NULL CHECK(length(sale_id) = 36),
  provider TEXT NOT NULL CHECK(provider IN ('SIIGO','FACTUS','ALEGRA','THE_FACTORY_HKA','ODOO')),
  environment TEXT NOT NULL CHECK(environment IN ('SANDBOX','PRODUCTION')),
  document_type TEXT NOT NULL CHECK(document_type IN (
    'SALES_INVOICE','CREDIT_NOTE','DEBIT_NOTE','SUPPORT_DOCUMENT','SUPPORT_DOCUMENT_ADJUSTMENT_NOTE')),
  numbering_range_id TEXT NOT NULL CHECK(length(numbering_range_id) BETWEEN 1 AND 128),
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200),
  payload_json TEXT NOT NULL CHECK(length(payload_json) > 0),
  payload_checksum TEXT NOT NULL
    CHECK(length(payload_checksum) = 64)
    CHECK(payload_checksum NOT GLOB '*[^0-9a-f]*'),
  transport_status TEXT NOT NULL CHECK(transport_status IN (
    'CREATED','IN_PROGRESS','COMPLETED','FAILED','UNKNOWN_OUTCOME','CANCELLED')),
  normalized_result TEXT CHECK(normalized_result IS NULL OR normalized_result IN ('ACCEPTED','REJECTED')),
  attempt_count INTEGER NOT NULL CHECK(attempt_count >= 0),
  provider_operation_id TEXT CHECK(provider_operation_id IS NULL OR length(provider_operation_id) BETWEEN 1 AND 200),
  provider_document_id TEXT CHECK(provider_document_id IS NULL OR length(provider_document_id) BETWEEN 1 AND 200),
  issued_prefix TEXT CHECK(issued_prefix IS NULL OR length(issued_prefix) BETWEEN 1 AND 20),
  issued_number TEXT CHECK(issued_number IS NULL OR length(issued_number) BETWEEN 1 AND 40),
  cufe TEXT CHECK(cufe IS NULL OR length(cufe) BETWEEN 1 AND 200),
  provider_status_code TEXT CHECK(provider_status_code IS NULL OR length(provider_status_code) BETWEEN 1 AND 96),
  provider_status TEXT CHECK(provider_status IS NULL OR length(provider_status) BETWEEN 1 AND 200),
  provider_http_status INTEGER CHECK(provider_http_status IS NULL OR provider_http_status BETWEEN 100 AND 599),
  last_diagnostic_code TEXT CHECK(last_diagnostic_code IS NULL OR length(last_diagnostic_code) BETWEEN 1 AND 96),
  last_diagnostic_reference TEXT CHECK(last_diagnostic_reference IS NULL OR length(last_diagnostic_reference) BETWEEN 1 AND 200),
  version INTEGER NOT NULL CHECK(version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  first_submitted_at TEXT,
  resolved_at TEXT,
  CHECK ((normalized_result IS NOT NULL) = (transport_status = 'COMPLETED')),
  CHECK ((attempt_count = 0) = (transport_status = 'CREATED')),
  CHECK ((first_submitted_at IS NULL) = (attempt_count = 0)),
  CHECK ((resolved_at IS NOT NULL) = (transport_status IN ('COMPLETED','CANCELLED'))),
  CHECK (provider_operation_id IS NULL OR transport_status IS 'COMPLETED'),
  -- \`IS\` y no \`=\`: \`normalized_result\` es anulable, y en logica de tres
  -- valores \`NULL = 'ACCEPTED'\` es NULL, no falso. Un CHECK que evalua a NULL
  -- **pasa**, de modo que con \`=\` estas tres reglas no impedirian nada: un
  -- documento FAILED podria guardar un consecutivo emitido. \`IS\` compara sin
  -- propagar NULL.
  CHECK (cufe IS NULL OR normalized_result IS 'ACCEPTED'),
  CHECK (issued_number IS NULL OR normalized_result IS 'ACCEPTED'),
  CHECK (issued_prefix IS NULL OR normalized_result IS 'ACCEPTED'),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, sale_id) REFERENCES sales_sales(tenant_id, id),
  FOREIGN KEY (tenant_id, provider, environment, numbering_range_id)
    REFERENCES fiscal_numbering_range(tenant_id, provider, environment, range_id)
) WITHOUT ROWID, STRICT;
CREATE UNIQUE INDEX fiscal_electronic_document_idempotency_idx
  ON fiscal_electronic_document(tenant_id, provider, environment, idempotency_key);
CREATE UNIQUE INDEX fiscal_electronic_document_open_per_sale_idx
  ON fiscal_electronic_document(tenant_id, sale_id, document_type)
  WHERE transport_status <> 'CANCELLED'
    AND (normalized_result IS NULL OR normalized_result <> 'REJECTED');
CREATE INDEX fiscal_electronic_document_unresolved_idx
  ON fiscal_electronic_document(tenant_id, transport_status)
  WHERE resolved_at IS NULL;

CREATE TRIGGER fiscal_electronic_document_frozen_identity
  BEFORE UPDATE ON fiscal_electronic_document
  FOR EACH ROW WHEN
    OLD.sale_id <> NEW.sale_id
    OR OLD.document_type <> NEW.document_type
    OR OLD.provider <> NEW.provider
    OR OLD.environment <> NEW.environment
    OR OLD.numbering_range_id <> NEW.numbering_range_id
    OR OLD.idempotency_key <> NEW.idempotency_key
    OR OLD.payload_json <> NEW.payload_json
    OR OLD.payload_checksum <> NEW.payload_checksum
    OR OLD.created_at <> NEW.created_at
  BEGIN SELECT RAISE(ABORT, 'frozen electronic document identity is immutable'); END;
CREATE TRIGGER fiscal_electronic_document_monotonic_attempts
  BEFORE UPDATE ON fiscal_electronic_document
  FOR EACH ROW WHEN NEW.attempt_count < OLD.attempt_count OR NEW.version <= OLD.version
  BEGIN SELECT RAISE(ABORT, 'electronic document attempts and version only move forward'); END;
CREATE TRIGGER fiscal_electronic_document_resolved_is_final
  BEFORE UPDATE ON fiscal_electronic_document
  FOR EACH ROW WHEN OLD.resolved_at IS NOT NULL
  BEGIN SELECT RAISE(ABORT, 'a resolved electronic document cannot change'); END;
`.trim();

/**
 * `MIGRATION_022` — el ancla de confianza tiene dónde vivir (`DEC-011`).
 *
 * `DEC-011` §«Modelo de confianza criptográfica» fija que el trust anchor son
 * **claves públicas provisionadas en la instalación**, con estado `ACTIVE`,
 * `VERIFY_ONLY` o `REVOKED`, y que la rotación se hace pasando la anterior a
 * `VERIFY_ONLY` para no necesitar ventana de corte.
 *
 * Nunca existió la tabla. `local_device_key_history` guarda la clave **del
 * equipo** —la privada, en el almacén cifrado— que es lo contrario: aquella
 * firma, ésta verifica. Sin sitio donde poner las públicas de la autoridad, el
 * runtime no podía construir el `ReadonlyMap<string, TrustedSigningKey>` que
 * piden sus tres verificadores, y `main.ts` acababa pasando un mapa vacío. Con
 * el mapa vacío `session.activate` falla cerrado, y con él **toda** la
 * superficie comercial: 25 operaciones enrutadas, 0 alcanzables.
 *
 * `DEC-011` §«Qué queda fuera de alcance» excluye «cualquier tabla o
 * migración, que requieren autorización específica». Ésta es esa autorización.
 *
 * ## Lo que esta tabla NO es
 *
 * **No es un emisor.** Guardar la pública de quien firma no permite firmar
 * nada. `DEC-011` deja `BLOCKED` el trust anchor de producción «hasta disponer
 * de material real» y prohíbe expresamente los autofirmados como sustituto:
 * una instalación sin anclas provisionadas sigue sin poder operar, y eso es la
 * consecuencia aceptada del modelo fail-closed, no un defecto que esta
 * migración tape.
 *
 * Lo que sí hace es que el lado consumidor deje de ser inalcanzable por
 * construcción: con material provisionado —real en producción, generado para
 * la prueba en los tests, que es lo que `DEC-011` autoriza— la cadena entera
 * se abre.
 *
 * ## `purpose`: separación de claves
 *
 * Tres verificadores distintos consumen mapas de claves —sesión, snapshot de
 * autorización y licencia— y **no deben compartir ancla**. Una clave admitida
 * para verificar una aserción de sesión no puede valer para autorizar
 * permisos: sin esta columna, comprometer la de menor valor daría la de mayor.
 * La clave primaria es `(purpose, key_id)` justamente para que el mismo
 * `key_id` pueda existir con dos propósitos sin colisionar ni heredarse.
 *
 * ## Por qué SPKI en base64url y no PEM
 *
 * `createPublicKey` acepta ambos, pero PEM lleva saltos de línea y cabeceras
 * que invitan a recortes y pegados a mano. El DER en `base64url` es una sola
 * cadena sin caracteres que se puedan perder por el camino, y el `CHECK`
 * rechaza cualquier cosa fuera del alfabeto.
 *
 * `revoked_at` va emparejado con el estado: no puede haber una revocación sin
 * momento ni un momento sin revocación.
 */
const MIGRATION_022 = `
CREATE TABLE local_trust_anchor (
  purpose TEXT NOT NULL CHECK(purpose IN (
    'SESSION_ASSERTION','AUTHORIZATION_SNAPSHOT','LICENSE')),
  key_id TEXT NOT NULL CHECK(length(key_id) BETWEEN 1 AND 96),
  algorithm TEXT NOT NULL CHECK(algorithm = 'ED25519'),
  public_key_spki TEXT NOT NULL
    CHECK(length(public_key_spki) BETWEEN 1 AND 512)
    CHECK(public_key_spki NOT GLOB '*[^A-Za-z0-9_-]*'),
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','VERIFY_ONLY','REVOKED')),
  provisioned_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT,
  CHECK((status = 'REVOKED') = (revoked_at IS NOT NULL)),
  PRIMARY KEY (purpose, key_id)
) WITHOUT ROWID, STRICT;
CREATE INDEX local_trust_anchor_usable_idx
  ON local_trust_anchor(purpose, status)
  WHERE status <> 'REVOKED';
`.trim();

/**
 * `MIGRATION_024` — `UnitConversion` (`DEC-004` §1579).
 *
 * `DEC-004` modela la conversión entre presentaciones como **entidad propia**,
 * no como una columna de la presentación: una conversión tiene origen, destino
 * y factor, y `1 paca = 12 bolsas` no cabe en un atributo suelto.
 *
 * **Qué se materializa y qué no, y por qué.** De los dieciséis atributos
 * conceptuales de `DEC-004` §1579 entran los que tienen soporte real hoy.
 * Quedan fuera, y no se fingen con una columna vacía:
 *
 * - `variant_id`: `ProductVariant` no existe en el esquema local. La invariante
 *   §1602 sobre variantes se cumple por vacuidad mientras no existan.
 * - `cost_policy`: no hay modelo de costo. `DEC-004` §1811 exige conservación
 *   de costo en conversiones, y sin costo operativo por presentación esa regla
 *   no se puede ni comprobar ni violar.
 * - `lot_policy`: no hay lotes.
 * - `waste_policy`: la merma existe como movimiento `SHRINKAGE`, pero declarar
 *   una política de merma por conversión exige el modelo de costo de arriba.
 *
 * **La invariante §1602 la impone un trigger, no la aplicación.** Origen y
 * destino deben pertenecer al producto declarado; comprobarlo sólo en el caso
 * de uso dejaría la regla a merced de un escritor futuro que no pase por ahí.
 * El índice parcial garantiza además **una sola conversión activa por par**:
 * dos factores vigentes para el mismo par serían un factor ambiguo, que
 * `DEC-004` §1631 prohíbe expresamente.
 */
const MIGRATION_024 = `
CREATE TABLE catalog_unit_conversion (
  id TEXT NOT NULL CHECK(length(id) = 36),
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) = 36),
  company_id TEXT NOT NULL CHECK(length(company_id) = 36),
  product_id TEXT NOT NULL CHECK(length(product_id) = 36),
  source_presentation_id TEXT NOT NULL CHECK(length(source_presentation_id) = 36),
  target_presentation_id TEXT NOT NULL CHECK(length(target_presentation_id) = 36),
  factor TEXT NOT NULL
    CHECK(factor GLOB '[0-9]*.[0-9][0-9][0-9][0-9][0-9][0-9]')
    CHECK(factor NOT GLOB '*[^0-9.]*')
    CHECK(length(factor) - length(replace(factor, '.', '')) = 1)
    CHECK(factor NOT GLOB '0[0-9]*')
    CHECK(factor <> '0.000000'),
  reversible INTEGER NOT NULL CHECK(reversible IN (0, 1)),
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','INACTIVE')),
  version INTEGER NOT NULL CHECK(version >= 1),
  declared_by_actor_id TEXT NOT NULL CHECK(length(declared_by_actor_id) = 36),
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) > 0),
  correlation_id TEXT NOT NULL CHECK(length(correlation_id) = 36),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(source_presentation_id <> target_presentation_id),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, product_id) REFERENCES catalog_product(tenant_id, id),
  FOREIGN KEY (tenant_id, source_presentation_id) REFERENCES catalog_presentation(tenant_id, id),
  FOREIGN KEY (tenant_id, target_presentation_id) REFERENCES catalog_presentation(tenant_id, id)
) WITHOUT ROWID, STRICT;

CREATE UNIQUE INDEX catalog_unit_conversion_active_pair_idx
  ON catalog_unit_conversion(tenant_id, source_presentation_id, target_presentation_id)
  WHERE status = 'ACTIVE';

CREATE UNIQUE INDEX catalog_unit_conversion_idempotency_idx
  ON catalog_unit_conversion(tenant_id, idempotency_key);

CREATE INDEX catalog_unit_conversion_product_idx
  ON catalog_unit_conversion(tenant_id, product_id);

CREATE TRIGGER catalog_unit_conversion_same_product_insert
BEFORE INSERT ON catalog_unit_conversion
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'conversion presentations must belong to the declared product')
  WHERE (
    SELECT COUNT(*) FROM catalog_presentation
    WHERE tenant_id = NEW.tenant_id
      AND product_id = NEW.product_id
      AND id IN (NEW.source_presentation_id, NEW.target_presentation_id)
  ) <> 2;
END;
`.trim();

/**
 * `MIGRATION_025` — la conversión deja rastro con su propio nombre.
 *
 * `movement_type` es un `CHECK`, y SQLite no lo altera: hay que reconstruir.
 * Cabe hacerlo aquí por la misma razón que en `MIGRATION_021`: **nadie
 * referencia `inventory_movement`**. Sin tablas hijas, lo único que hay que
 * rehacer son sus tres índices.
 *
 * **Por qué no se reutiliza `TRANSFER_IN`/`TRANSFER_OUT`.** Un traslado mueve
 * la misma mercancía entre ubicaciones; una conversión la transforma en otra
 * presentación. Etiquetar una de otra dejaría un rastro que miente sobre lo que
 * pasó, y el rastro es justo lo que un inventario existe para conservar.
 *
 * La copia comprueba fila a fila: una `movement_type` preexistente fuera del
 * dominio detendría el arranque en vez de perderse en silencio. Riesgo nulo
 * hoy —el dominio sólo se amplía— y la garantía sirve para la próxima.
 *
 * **La trampa de reconstruir una tabla, aprendida aquí.** La primera versión de
 * esta migración copió las columnas y **perdió en silencio las tres
 * restricciones del final**: el `CHECK` que ata `movement_type` a `direction`,
 * el que ata `sale_id` a los movimientos de venta, y la clave ajena a
 * `catalog_presentation`. Las restricciones de tabla van después de la última
 * columna y son justo las que no se ven al copiar. Las cazaron dos pruebas de
 * `inventory.test.ts` que ya existían —«rechaza una venta que sume existencia»
 * y «rechaza una recepción que declare una venta»—, que es exactamente para lo
 * que estaban. **Un rebuild se copia entero o no se copia.**
 *
 * `CONVERSION_IN` entra además en la lista de tipos de entrada, para que el
 * invariante tipo↔dirección siga cubriendo el dominio completo y no sólo el
 * que existía antes.
 */
const MIGRATION_025 = `
CREATE TABLE inventory_movement_rebuilt (
  id TEXT NOT NULL CHECK(length(id) = 36),
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) = 36),
  company_id TEXT NOT NULL CHECK(length(company_id) = 36),
  branch_id TEXT NOT NULL CHECK(length(branch_id) = 36),
  presentation_id TEXT NOT NULL CHECK(length(presentation_id) = 36),
  stock_sequence INTEGER NOT NULL CHECK(stock_sequence > 0),
  movement_type TEXT NOT NULL CHECK(movement_type IN (
    'OPENING_COUNT','PURCHASE_RECEIPT','SALE_REVERSAL','ADJUSTMENT_POSITIVE','TRANSFER_IN',
    'CONVERSION_IN',
    'SALE','ADJUSTMENT_NEGATIVE','SHRINKAGE','TRANSFER_OUT',
    'CONVERSION_OUT')),
  direction TEXT NOT NULL CHECK(direction IN ('IN','OUT')),
  quantity TEXT NOT NULL
    CHECK(quantity GLOB '[0-9]*.[0-9][0-9][0-9][0-9][0-9][0-9]')
    CHECK(quantity NOT GLOB '*[^0-9.]*')
    CHECK(length(quantity) - length(replace(quantity, '.', '')) = 1)
    CHECK(quantity NOT GLOB '0[0-9]*')
    CHECK(quantity <> '0.000000'),
  quantity_after TEXT NOT NULL
    CHECK(quantity_after GLOB '[0-9]*.[0-9][0-9][0-9][0-9][0-9][0-9]')
    CHECK(quantity_after NOT GLOB '*[^0-9.]*')
    CHECK(length(quantity_after) - length(replace(quantity_after, '.', '')) = 1)
    CHECK(quantity_after NOT GLOB '0[0-9]*'),
  reason_code TEXT NOT NULL CHECK(length(reason_code) BETWEEN 1 AND 64),
  sale_id TEXT CHECK(sale_id IS NULL OR length(sale_id) = 36),
  actor_type TEXT NOT NULL CHECK(actor_type = 'USER'),
  actor_id TEXT NOT NULL CHECK(length(actor_id) = 36),
  operation_id TEXT NOT NULL CHECK(length(operation_id) = 36),
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) > 0),
  correlation_id TEXT NOT NULL CHECK(length(correlation_id) = 36),
  business_date TEXT NOT NULL CHECK(length(business_date) = 10),
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK ((movement_type IN (
    'OPENING_COUNT','PURCHASE_RECEIPT','SALE_REVERSAL','ADJUSTMENT_POSITIVE','TRANSFER_IN',
    'CONVERSION_IN'
  )) = (direction = 'IN')),
  CHECK ((movement_type IN ('SALE','SALE_REVERSAL')) = (sale_id IS NOT NULL)),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, presentation_id) REFERENCES catalog_presentation(tenant_id, id)
) WITHOUT ROWID, STRICT;

INSERT INTO inventory_movement_rebuilt(
  id, tenant_id, company_id, branch_id, presentation_id, stock_sequence,
  movement_type, direction, quantity, quantity_after, reason_code, sale_id,
  actor_type, actor_id, operation_id, idempotency_key, correlation_id,
  business_date, occurred_at, created_at
)
SELECT
  id, tenant_id, company_id, branch_id, presentation_id, stock_sequence,
  movement_type, direction, quantity, quantity_after, reason_code, sale_id,
  actor_type, actor_id, operation_id, idempotency_key, correlation_id,
  business_date, occurred_at, created_at
FROM inventory_movement;

DROP TABLE inventory_movement;

ALTER TABLE inventory_movement_rebuilt RENAME TO inventory_movement;

CREATE UNIQUE INDEX inventory_movement_sequence_idx
  ON inventory_movement(tenant_id, branch_id, presentation_id, stock_sequence);
CREATE UNIQUE INDEX inventory_movement_idempotency_idx
  ON inventory_movement(tenant_id, idempotency_key);
CREATE INDEX inventory_movement_sale_idx
  ON inventory_movement(tenant_id, sale_id) WHERE sale_id IS NOT NULL;
`.trim();

/**
 * `inventory_lot` — trazabilidad por lote y vencimiento (`UC-INVENTORY-002`
 * §Lotes, `RN-018`, `RN-019`, `RN-127`).
 *
 * ## Por qué existe
 *
 * Carnes, embutidos, lácteos y perecederos no se pueden vender sin saber qué
 * lote salió: es requisito sanitario, no comodidad. Hasta aquí el inventario
 * sabía **cuánto** hay y no **de qué tanda**, así que un retiro de producto no
 * se podía acotar y una merma por vencimiento no podía decir qué venció.
 *
 * ## De los atributos conceptuales, los que tienen soporte real
 *
 * `UC-INVENTORY-002` §Lotes enumera once. Entran los que el árbol puede
 * sostener hoy; los demás **no se fingen con una columna vacía**, que es el
 * criterio que ya se aplicó en `MIGRATION_024`:
 *
 * - `costo o referencia de costo`: no hay modelo de costo. La misma razón por
 *   la que `cost_policy` se quedó fuera de `catalog_unit_conversion`.
 * - `proveedor u origen`: no existe `Supplier`. Compras y proveedores son
 *   capacidad ausente, y una columna de texto libre sería un proveedor
 *   inventado sin identidad ni unicidad.
 *
 * ## Invariantes que impone el esquema, no la aplicación
 *
 * - **`lot_id` no se reutiliza** (regla 1): clave primaria `(tenant_id, id)`.
 * - **Un código de lote identifica una tanda dentro de su presentación**: el
 *   índice único `(tenant_id, presentation_id, lot_code)` impide dos lotes
 *   homónimos del mismo artículo, que harían ambigua la trazabilidad.
 * - **El vencimiento no puede preceder a la recepción ni a la fabricación**.
 *   Una fecha así es un error de captura, y aceptarla envenenaría FEFO: ese
 *   lote se elegiría siempre primero.
 * - **Las cantidades son de la misma escala 6 que el resto del inventario**, y
 *   `quantity_reserved` nunca excede a `quantity_on_hand`.
 *
 * `status` distingue `ACTIVE` de `BLOCKED` y `CONSUMED`. **`EXPIRED` no es un
 * estado almacenado**: `UC-INVENTORY-002` §Vencimientos lo lista como estado
 * *derivado*, y su regla 4 dice que el vencimiento no elimina el lote. Guardar
 * «vencido» como columna obligaría a un proceso que la actualice y produciría
 * dos verdades —la fecha y el estado— que pueden discrepar. Se deriva de
 * `expiry_date` contra el reloj, que es una sola verdad.
 */
const MIGRATION_026 = `
CREATE TABLE inventory_lot (
  id TEXT NOT NULL CHECK(length(id) = 36),
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) = 36),
  company_id TEXT NOT NULL CHECK(length(company_id) = 36),
  branch_id TEXT NOT NULL CHECK(length(branch_id) = 36),
  presentation_id TEXT NOT NULL CHECK(length(presentation_id) = 36),
  lot_code TEXT NOT NULL CHECK(length(lot_code) BETWEEN 1 AND 64),
  received_date TEXT NOT NULL CHECK(length(received_date) = 10),
  manufactured_date TEXT CHECK(manufactured_date IS NULL OR length(manufactured_date) = 10),
  expiry_date TEXT CHECK(expiry_date IS NULL OR length(expiry_date) = 10),
  quantity_on_hand TEXT NOT NULL
    CHECK(quantity_on_hand GLOB '[0-9]*.[0-9][0-9][0-9][0-9][0-9][0-9]')
    CHECK(quantity_on_hand NOT GLOB '*[^0-9.]*')
    CHECK(length(quantity_on_hand) - length(replace(quantity_on_hand, '.', '')) = 1)
    CHECK(quantity_on_hand NOT GLOB '0[0-9]*'),
  quantity_reserved TEXT NOT NULL
    CHECK(quantity_reserved GLOB '[0-9]*.[0-9][0-9][0-9][0-9][0-9][0-9]')
    CHECK(quantity_reserved NOT GLOB '*[^0-9.]*')
    CHECK(length(quantity_reserved) - length(replace(quantity_reserved, '.', '')) = 1)
    CHECK(quantity_reserved NOT GLOB '0[0-9]*'),
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','BLOCKED','CONSUMED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(expiry_date IS NULL OR expiry_date >= received_date),
  CHECK(manufactured_date IS NULL OR manufactured_date <= received_date),
  CHECK(expiry_date IS NULL OR manufactured_date IS NULL OR expiry_date >= manufactured_date),
  CHECK(CAST(replace(quantity_reserved, '.', '') AS INTEGER)
        <= CAST(replace(quantity_on_hand, '.', '') AS INTEGER)),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, presentation_id) REFERENCES catalog_presentation(tenant_id, id)
) WITHOUT ROWID, STRICT;

CREATE UNIQUE INDEX inventory_lot_code_idx
  ON inventory_lot(tenant_id, presentation_id, lot_code);

CREATE INDEX inventory_lot_fefo_idx
  ON inventory_lot(tenant_id, branch_id, presentation_id, expiry_date)
  WHERE status = 'ACTIVE' AND quantity_on_hand <> '0.000000';
`.trim();

/**
 * `inventory_lot_allocation` — de qué lote salió cada venta
 * (`UC-INVENTORY-002` §Lotes regla 2, §Vencimientos regla 1).
 *
 * ## Para qué
 *
 * Es la mitad que un retiro sanitario necesita. `MIGRATION_026` dejó saber
 * qué tandas hay y cuál vence antes; esto deja saber **qué ventas se llevaron
 * cada tanda**. Sin ello, ante un lote contaminado de carne molida, la tienda
 * sabe que lo tuvo y no a quién se lo vendió.
 *
 * ## Por qué una tabla aparte y no `lot_id` en el movimiento
 *
 * Una venta de 3 kg puede salir de dos tandas: 2 kg de la que vence el 24 y
 * 1 kg de la del 29. Un solo `lot_id` en el movimiento obligaría a partir la
 * venta en dos movimientos, y eso cambia la clave de idempotencia del
 * descuento de venta —`(venta, presentación)`—, que está en el camino de
 * cobro con evidencia `END_TO_END`. Las asignaciones cuelgan del movimiento
 * que ya existe y no lo tocan.
 *
 * ## Por qué NO hay clave ajena a `inventory_movement`, a propósito
 *
 * `MIGRATION_025` pudo reconstruir `inventory_movement` porque **nadie la
 * referenciaba**, y `D-27` documenta lo que cuesta cuando una tabla sí está
 * referenciada: no se puede rehacer dentro de la transacción de migración.
 * Referenciarla aquí cerraría esa puerta para ganar una integridad que ya da
 * la construcción: la asignación la escribe el mismo almacén, en la misma
 * transacción y con el mismo id que el movimiento. Se prefiere conservar la
 * posibilidad de reconstruir a duplicar una garantía.
 *
 * La clave ajena al **lote** sí está: una asignación a un lote inexistente
 * no traza nada.
 *
 * ## Append-only
 *
 * Una asignación es un hecho histórico sanitario. Los disparadores impiden
 * modificarla o borrarla: un rastro que se puede editar después del retiro no
 * sirve como rastro.
 */
const MIGRATION_027 = `
CREATE TABLE inventory_lot_allocation (
  id TEXT NOT NULL CHECK(length(id) = 36),
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) = 36),
  lot_id TEXT NOT NULL CHECK(length(lot_id) = 36),
  movement_id TEXT NOT NULL CHECK(length(movement_id) = 36),
  sale_id TEXT CHECK(sale_id IS NULL OR length(sale_id) = 36),
  quantity TEXT NOT NULL
    CHECK(quantity GLOB '[0-9]*.[0-9][0-9][0-9][0-9][0-9][0-9]')
    CHECK(quantity NOT GLOB '*[^0-9.]*')
    CHECK(length(quantity) - length(replace(quantity, '.', '')) = 1)
    CHECK(quantity NOT GLOB '0[0-9]*')
    CHECK(quantity <> '0.000000'),
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, lot_id) REFERENCES inventory_lot(tenant_id, id)
) WITHOUT ROWID, STRICT;

CREATE UNIQUE INDEX inventory_lot_allocation_once_idx
  ON inventory_lot_allocation(tenant_id, movement_id, lot_id);
CREATE INDEX inventory_lot_allocation_lot_idx
  ON inventory_lot_allocation(tenant_id, lot_id);

CREATE TRIGGER inventory_lot_allocation_no_update
  BEFORE UPDATE ON inventory_lot_allocation
  BEGIN SELECT RAISE(ABORT, 'inventory_lot_allocation is append-only'); END;
CREATE TRIGGER inventory_lot_allocation_no_delete
  BEFORE DELETE ON inventory_lot_allocation
  BEGIN SELECT RAISE(ABORT, 'inventory_lot_allocation is append-only'); END;
`.trim();

/**
 * El código de lote es único **por sucursal**, no por tenant.
 *
 * ## El defecto que corrige — medido el 2026-09-26
 *
 * `MIGRATION_026` dejó la unicidad en `(tenant_id, presentation_id,
 * lot_code)`, y `receiveLot` buscaba el lote existente con esa misma clave.
 * Recibir la tanda `L-X` en la sucursal A cuando la sucursal B ya la tenía
 * **sumaba las unidades de A al lote de B**: el lote de B decía tener 20 con
 * 10 de existencia, y A quedaba con 10 de existencia y ningún lote. Un lote
 * es existencia física en un sitio; dos sucursales con la misma tanda del
 * proveedor tienen dos existencias, y cada una sale por su lado.
 *
 * ## Por qué es seguro
 *
 * La clave nueva **contiene** a la anterior, así que ningún dato que la vieja
 * admitía la viola: el índice se recrea sin tocar filas. Lo que la vieja ya
 * hubiera fusionado entre sucursales no se puede separar desde el esquema,
 * y no existe hoy ninguna base desplegada que lo contenga.
 *
 * Se conserva el nombre del índice: quien lo busque por nombre sigue
 * encontrando la regla de unicidad, ahora con la sucursal dentro.
 */
const MIGRATION_028 = `
DROP INDEX inventory_lot_code_idx;
CREATE UNIQUE INDEX inventory_lot_code_idx
  ON inventory_lot(tenant_id, branch_id, presentation_id, lot_code);
`.trim();

/**
 * De qué lote viene un lote: la paca abierta y sus unidades.
 *
 * ## Para qué
 *
 * Abrir una paca de la tanda `L-0924` baja del lote de la paca, y las doce
 * unidades que salen **son** de esa tanda. Sin este enlace entraban sin lote y
 * el rastro de un retiro sanitario se cortaba en la paca: se sabía que se
 * abrió, no a quién se vendieron sus unidades.
 *
 * El lote de las unidades lleva el mismo código y las mismas fechas, y además
 * `origin_lot_id` apunta al lote de la paca. Con eso el rastro va en los dos
 * sentidos: de la paca a sus unidades y de las unidades a su paca.
 *
 * ## Por qué sin `REFERENCES`
 *
 * La misma razón que `MIGRATION_019`: `ADD COLUMN` sólo admite una FK de una
 * columna, y la PK de `inventory_lot` es `(tenant_id, id)` —una FK simple a
 * `id` se acepta al crearla y falla con `foreign key mismatch` la primera vez
 * que se usa—. Reconstruir la tabla no es opción: `inventory_lot_allocation`
 * la referencia. La integridad la sostiene el único escritor, que sólo pone
 * aquí el `id` de un lote que acaba de leer en la misma transacción.
 */
const MIGRATION_029 = `
ALTER TABLE inventory_lot
  ADD COLUMN origin_lot_id TEXT
  CHECK(origin_lot_id IS NULL OR length(origin_lot_id) = 36);
CREATE INDEX inventory_lot_origin_idx
  ON inventory_lot(tenant_id, origin_lot_id) WHERE origin_lot_id IS NOT NULL;
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
  { version: 10, sql: MIGRATION_010, checksum: createHash("sha256").update(MIGRATION_010).digest("hex") },
  { version: 11, sql: MIGRATION_011, checksum: createHash("sha256").update(MIGRATION_011).digest("hex") },
  { version: 12, sql: MIGRATION_012, checksum: createHash("sha256").update(MIGRATION_012).digest("hex") },
  { version: 13, sql: MIGRATION_013, checksum: createHash("sha256").update(MIGRATION_013).digest("hex") },
  { version: 14, sql: MIGRATION_014, checksum: createHash("sha256").update(MIGRATION_014).digest("hex") },
  { version: 15, sql: MIGRATION_015, checksum: createHash("sha256").update(MIGRATION_015).digest("hex") },
  { version: 16, sql: MIGRATION_016, checksum: createHash("sha256").update(MIGRATION_016).digest("hex") },
  { version: 17, sql: MIGRATION_017, checksum: createHash("sha256").update(MIGRATION_017).digest("hex") },
  { version: 18, sql: MIGRATION_018, checksum: createHash("sha256").update(MIGRATION_018).digest("hex") },
  { version: 19, sql: MIGRATION_019, checksum: createHash("sha256").update(MIGRATION_019).digest("hex") },
  { version: 20, sql: MIGRATION_020, checksum: createHash("sha256").update(MIGRATION_020).digest("hex") },
  { version: 21, sql: MIGRATION_021, checksum: createHash("sha256").update(MIGRATION_021).digest("hex") },
  { version: 22, sql: MIGRATION_022, checksum: createHash("sha256").update(MIGRATION_022).digest("hex") },
  { version: 23, sql: MIGRATION_023, checksum: createHash("sha256").update(MIGRATION_023).digest("hex") },
  { version: 24, sql: MIGRATION_024, checksum: createHash("sha256").update(MIGRATION_024).digest("hex") },
  { version: 25, sql: MIGRATION_025, checksum: createHash("sha256").update(MIGRATION_025).digest("hex") },
  { version: 26, sql: MIGRATION_026, checksum: createHash("sha256").update(MIGRATION_026).digest("hex") },
  { version: 27, sql: MIGRATION_027, checksum: createHash("sha256").update(MIGRATION_027).digest("hex") },
  { version: 28, sql: MIGRATION_028, checksum: createHash("sha256").update(MIGRATION_028).digest("hex") },
  { version: 29, sql: MIGRATION_029, checksum: createHash("sha256").update(MIGRATION_029).digest("hex") },
] as const;

/**
 * Última versión del esquema local, derivada de `MIGRATIONS`.
 *
 * Se exporta para que nadie tenga que escribir el número a mano: una prueba que
 * afirme «la migración llegó al final» debe seguir diciendo eso cuando se añada
 * la migración siguiente, no romperse por acoplamiento a un literal.
 */
export const LATEST_LOCAL_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

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
