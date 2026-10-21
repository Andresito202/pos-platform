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
 * `MIGRATION_016` — Documento electrónico y rango de numeración (`DEC-021` F1).
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

/**
 * `MIGRATION_017` — preferencias explícitas de comunicaciones comerciales.
 *
 * Separada de `customers_customers`: el registro fiscal no implica consentimiento
 * comercial. V1 materializa sólo el tema "Novedades del POS" por correo.
 */
const MIGRATION_017 = `
CREATE TABLE customer_marketing_subscriptions (
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) = 36),
  company_id TEXT NOT NULL CHECK(length(company_id) = 36),
  customer_id TEXT NOT NULL CHECK(length(customer_id) = 36),
  channel TEXT NOT NULL CHECK(channel = 'EMAIL'),
  topic TEXT NOT NULL CHECK(topic = 'POS_NEWS'),
  status TEXT NOT NULL CHECK(status IN ('SUBSCRIBED','UNSUBSCRIBED')),
  consent_version TEXT,
  consented_at TEXT,
  unsubscribed_at TEXT,
  source TEXT NOT NULL CHECK(source = 'POS'),
  updated_by_actor_id TEXT NOT NULL CHECK(length(updated_by_actor_id) = 36),
  session_id TEXT NOT NULL CHECK(length(session_id) = 36),
  correlation_id TEXT NOT NULL CHECK(length(correlation_id) = 36),
  causation_id TEXT CHECK(causation_id IS NULL OR length(causation_id) = 36),
  version INTEGER NOT NULL CHECK(version >= 1),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, company_id, customer_id, channel, topic),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers_customers(tenant_id, id),
  CHECK(status <> 'SUBSCRIBED' OR (consent_version IS NOT NULL AND consented_at IS NOT NULL)),
  CHECK(status <> 'UNSUBSCRIBED' OR unsubscribed_at IS NOT NULL)
) WITHOUT ROWID, STRICT;
CREATE INDEX customer_marketing_subscriptions_status_idx
  ON customer_marketing_subscriptions(tenant_id, company_id, topic, channel, status);
`.trim();

const MIGRATION_016 = `
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


// Hardware owns execution metadata only. Receipts remain projections (DEC-019).
const MIGRATION_018 = `
CREATE TABLE hardware_bindings (
 id TEXT PRIMARY KEY NOT NULL,tenant_id TEXT NOT NULL,company_id TEXT NOT NULL,branch_id TEXT NOT NULL,
 cash_register_id TEXT NOT NULL,device_id TEXT NOT NULL,profile_json TEXT NOT NULL CHECK(json_valid(profile_json)),
 created_at TEXT NOT NULL,UNIQUE(tenant_id,branch_id,cash_register_id,device_id)
) STRICT;
CREATE TABLE hardware_jobs (
 id TEXT PRIMARY KEY NOT NULL,tenant_id TEXT NOT NULL,company_id TEXT NOT NULL,branch_id TEXT NOT NULL,
 binding_id TEXT NOT NULL REFERENCES hardware_bindings(id),source_payment_id TEXT UNIQUE,kind TEXT NOT NULL CHECK(kind IN ('PRINT_TEST','PRINT_RECEIPT','DRAWER_OPEN','CUT')),
 sale_id TEXT,reason TEXT NOT NULL,actor_id TEXT NOT NULL,session_id TEXT NOT NULL,
 request_checksum TEXT NOT NULL CHECK(length(request_checksum)=64),
 state TEXT NOT NULL CHECK(state IN ('PENDING','DISPATCHING','TRANSPORT_ACCEPTED','FAILED','UNKNOWN')),
 result_code TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE hardware_events (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,job_id TEXT,actor_id TEXT NOT NULL,session_id TEXT NOT NULL,
 event_code TEXT NOT NULL,reason TEXT NOT NULL,recorded_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER hardware_events_no_update BEFORE UPDATE ON hardware_events BEGIN SELECT RAISE(ABORT,'hardware audit is append-only'); END;
CREATE TRIGGER hardware_events_no_delete BEFORE DELETE ON hardware_events BEGIN SELECT RAISE(ABORT,'hardware audit is append-only'); END;
CREATE INDEX hardware_jobs_pending_idx ON hardware_jobs(tenant_id,branch_id,state,created_at);
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
