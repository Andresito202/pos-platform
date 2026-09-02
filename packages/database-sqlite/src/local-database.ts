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

/**
 * Bloque 22: materializes the 7 Cash tables designed in Bloques 13-21
 * (cash-physical-design.md, corrected B14/B17/B19/B21) — extends this same
 * ledger rather than a parallel migration system, per
 * cash-physical-design.md §5: "Único escritor: POS Local Service", the
 * exact service that owns this file. Decimal amounts and quantities are
 * TEXT (physical-conventions.md's canonical-string rule, matching
 * Money.toString()) — never REAL/number. Sign is enforced with a string
 * prefix check, not a numeric comparison: SQLite's type-affinity ordering
 * ranks any non-empty TEXT value above any number, so `amount > 0` on a
 * TEXT column would be vacuously true for every value, including a
 * negative one — this is a real SQLite semantic, verified against a live
 * database in this block's tests, not assumed.
 *
 * Column list and nullability were re-verified column-by-column against
 * `cash-counting-schema.md`'s logical schema (the closed, `PHY-G07` source)
 * while writing the adapter, catching real drift from an earlier draft of
 * this migration: `cash_shifts.opening_amount` was removed (the schema's
 * own rule 1 — "la base inicial se deriva de [la CashMovement OPENING_FLOAT]
 * y no tiene una segunda autoridad mutable" — forbids a second, redundant
 * authority for it; readers derive it from the shift's `shift_sequence = 1`
 * movement instead), `cash_movements.device_reported_at` was added (it was
 * missing outright), and nullability on `cash_movements.actor_id`/
 * `reason_code`/`correlation_id`, `cash_counts.calculation_policy_version`/
 * `calculation_checksum`/`tolerance_policy_version`/`tolerance_policy_checksum`/
 * `correlation_id`, `cash_difference_reviews.severity`/
 * `tolerance_policy_version`/`tolerance_policy_checksum`/`correlation_id`,
 * and `cash_difference_review_actions.reason_code`/
 * `authorization_policy_version` were corrected to match the schema
 * document's explicit `NULL` annotations (present = nullable, absent =
 * required — the same convention the schema uses consistently elsewhere).
 */
const MIGRATION_006 = `
CREATE TABLE cash_registers (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) = 36),
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) = 36),
  company_id TEXT NOT NULL CHECK(length(company_id) = 36),
  branch_id TEXT NOT NULL CHECK(length(branch_id) = 36),
  code TEXT NOT NULL,
  code_normalized TEXT NOT NULL,
  name TEXT NOT NULL,
  currency_code TEXT NOT NULL CHECK(length(currency_code) = 3),
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','RETIRED')),
  created_at TEXT NOT NULL,
  retired_at TEXT,
  version INTEGER NOT NULL CHECK(version > 0),
  UNIQUE(tenant_id, company_id, branch_id, code_normalized),
  UNIQUE(tenant_id, id),
  UNIQUE(tenant_id, company_id, branch_id, id)
) STRICT;

CREATE TABLE cash_shifts (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) = 36),
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) = 36),
  company_id TEXT NOT NULL CHECK(length(company_id) = 36),
  branch_id TEXT NOT NULL CHECK(length(branch_id) = 36),
  cash_register_id TEXT NOT NULL CHECK(length(cash_register_id) = 36),
  origin_device_id TEXT NOT NULL CHECK(length(origin_device_id) = 36),
  opened_by_actor_type TEXT NOT NULL CHECK(opened_by_actor_type IN ('USER','DEVICE')),
  opened_by_actor_id TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  business_date TEXT NOT NULL,
  timezone_id TEXT NOT NULL,
  utc_offset_minutes INTEGER NOT NULL,
  currency_code TEXT NOT NULL CHECK(length(currency_code) = 3),
  status TEXT NOT NULL CHECK(status IN ('OPEN','CLOSING','CLOSED')),
  closed_by_actor_type TEXT CHECK(closed_by_actor_type IN ('USER','DEVICE')),
  closed_by_actor_id TEXT,
  closed_at TEXT,
  opening_idempotency_key TEXT NOT NULL,
  opening_request_checksum TEXT NOT NULL,
  closing_idempotency_key TEXT,
  closing_request_checksum TEXT,
  last_movement_sequence INTEGER NOT NULL DEFAULT 0 CHECK(last_movement_sequence >= 0),
  version INTEGER NOT NULL CHECK(version > 0),
  created_at TEXT NOT NULL,
  server_recorded_at TEXT,
  FOREIGN KEY (tenant_id, company_id, branch_id, cash_register_id) REFERENCES cash_registers(tenant_id, company_id, branch_id, id),
  UNIQUE(tenant_id, id),
  UNIQUE(tenant_id, company_id, branch_id, id),
  UNIQUE(tenant_id, origin_device_id, opening_idempotency_key),
  UNIQUE(tenant_id, origin_device_id, closing_idempotency_key)
) STRICT;
CREATE UNIQUE INDEX cash_shifts_incompatible_idx
  ON cash_shifts(tenant_id, branch_id, cash_register_id, origin_device_id)
  WHERE status IN ('OPEN','CLOSING');

CREATE TABLE cash_movements (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) = 36),
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) = 36),
  company_id TEXT NOT NULL CHECK(length(company_id) = 36),
  branch_id TEXT NOT NULL CHECK(length(branch_id) = 36),
  cash_register_id TEXT NOT NULL CHECK(length(cash_register_id) = 36),
  cash_shift_id TEXT NOT NULL CHECK(length(cash_shift_id) = 36),
  shift_sequence INTEGER NOT NULL CHECK(shift_sequence > 0),
  movement_type TEXT NOT NULL CHECK(movement_type IN (
    'OPENING_FLOAT','CASH_SALE','CASH_PAYMENT','CHANGE_GIVEN','CASH_REFUND',
    'CASH_REVERSAL_COMPENSATION','CASH_WITHDRAWAL','CASH_DEPOSIT','COURIER_COLLECTION',
    'CASH_EXPENSE','CASH_ADJUSTMENT_POSITIVE','CASH_ADJUSTMENT_NEGATIVE','TRANSFER_TO_SAFE',
    'TRANSFER_FROM_SAFE','CLOSING_TRANSFER','OTHER_AUTHORIZED'
  )),
  direction TEXT NOT NULL CHECK(direction IN ('IN','OUT')),
  amount TEXT NOT NULL CHECK(substr(amount,1,1) != '-' AND amount != '0.000000'),
  currency_code TEXT NOT NULL CHECK(length(currency_code) = 3),
  status TEXT NOT NULL CHECK(status IN ('CREATED','PENDING_APPROVAL','APPROVED','POSTED','REJECTED','FAILED','CANCELLED')),
  reference_type TEXT NOT NULL,
  reference_id TEXT,
  original_cash_movement_id TEXT,
  reason_code TEXT NOT NULL,
  evidence_reference TEXT,
  actor_type TEXT NOT NULL CHECK(actor_type IN ('USER','DEVICE')),
  actor_id TEXT,
  approved_by_actor_type TEXT CHECK(approved_by_actor_type IN ('USER','DEVICE')),
  approved_by_actor_id TEXT,
  business_date TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  device_reported_at TEXT NOT NULL,
  origin_device_id TEXT NOT NULL CHECK(length(origin_device_id) = 36),
  idempotency_key TEXT NOT NULL,
  request_checksum TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version > 0),
  created_at TEXT NOT NULL,
  server_recorded_at TEXT,
  FOREIGN KEY (tenant_id, company_id, branch_id, cash_shift_id) REFERENCES cash_shifts(tenant_id, company_id, branch_id, id),
  FOREIGN KEY (tenant_id, company_id, branch_id, cash_register_id) REFERENCES cash_registers(tenant_id, company_id, branch_id, id),
  UNIQUE(tenant_id, id),
  UNIQUE(tenant_id, cash_shift_id, shift_sequence),
  UNIQUE(tenant_id, origin_device_id, idempotency_key)
) STRICT;
CREATE INDEX cash_movements_shift_status_idx ON cash_movements(tenant_id, cash_shift_id, status);

CREATE TABLE cash_counts (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) = 36),
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) = 36),
  company_id TEXT NOT NULL CHECK(length(company_id) = 36),
  branch_id TEXT NOT NULL CHECK(length(branch_id) = 36),
  cash_register_id TEXT NOT NULL CHECK(length(cash_register_id) = 36),
  cash_shift_id TEXT NOT NULL CHECK(length(cash_shift_id) = 36),
  count_type TEXT NOT NULL CHECK(count_type IN ('PARTIAL','CLOSING','CORRECTION')),
  status TEXT NOT NULL CHECK(status IN ('IN_PROGRESS','COMPLETED','ABORTED')),
  blind_mode INTEGER NOT NULL CHECK(blind_mode IN (0,1)),
  started_shift_version INTEGER NOT NULL CHECK(started_shift_version > 0),
  movement_cutoff_sequence INTEGER NOT NULL CHECK(movement_cutoff_sequence >= 0),
  calculation_policy_version TEXT NOT NULL,
  calculation_checksum TEXT NOT NULL,
  expected_amount TEXT CHECK(expected_amount IS NULL OR substr(expected_amount,1,1) != '-'),
  counted_amount TEXT CHECK(counted_amount IS NULL OR substr(counted_amount,1,1) != '-'),
  difference_amount TEXT,
  difference_type TEXT CHECK(difference_type IS NULL OR difference_type IN ('SHORTAGE','EXACT','OVERAGE')),
  severity TEXT,
  currency_code TEXT NOT NULL CHECK(length(currency_code) = 3),
  denomination_breakdown_status TEXT NOT NULL CHECK(denomination_breakdown_status IN ('PROVIDED','NOT_PROVIDED')),
  tolerance_policy_version TEXT NOT NULL,
  tolerance_policy_checksum TEXT NOT NULL,
  supersedes_cash_count_id TEXT,
  started_by_actor_type TEXT NOT NULL CHECK(started_by_actor_type IN ('USER','DEVICE')),
  started_by_actor_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_by_actor_type TEXT CHECK(completed_by_actor_type IN ('USER','DEVICE')),
  completed_by_actor_id TEXT,
  completed_at TEXT,
  aborted_by_actor_type TEXT CHECK(aborted_by_actor_type IN ('USER','DEVICE')),
  aborted_by_actor_id TEXT,
  aborted_at TEXT,
  abort_reason_code TEXT,
  origin_device_id TEXT NOT NULL CHECK(length(origin_device_id) = 36),
  start_idempotency_key TEXT NOT NULL,
  start_request_checksum TEXT NOT NULL,
  completion_idempotency_key TEXT,
  completion_request_checksum TEXT,
  correlation_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version > 0),
  created_at TEXT NOT NULL,
  server_recorded_at TEXT,
  FOREIGN KEY (tenant_id, company_id, branch_id, cash_shift_id) REFERENCES cash_shifts(tenant_id, company_id, branch_id, id),
  FOREIGN KEY (tenant_id, supersedes_cash_count_id) REFERENCES cash_counts(tenant_id, id),
  UNIQUE(tenant_id, id),
  UNIQUE(tenant_id, company_id, branch_id, id),
  UNIQUE(tenant_id, origin_device_id, start_idempotency_key),
  UNIQUE(tenant_id, origin_device_id, completion_idempotency_key),
  UNIQUE(tenant_id, supersedes_cash_count_id)
) STRICT;
CREATE UNIQUE INDEX cash_counts_one_completed_closing_idx
  ON cash_counts(tenant_id, cash_shift_id)
  WHERE count_type = 'CLOSING' AND status = 'COMPLETED';

CREATE TABLE cash_count_denominations (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) = 36),
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) = 36),
  cash_count_id TEXT NOT NULL CHECK(length(cash_count_id) = 36),
  line_number INTEGER NOT NULL CHECK(line_number > 0),
  denomination_code TEXT NOT NULL,
  denomination_value TEXT NOT NULL CHECK(substr(denomination_value,1,1) != '-' AND denomination_value != '0.000000'),
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  line_amount TEXT NOT NULL CHECK(substr(line_amount,1,1) != '-' AND line_amount != '0.000000'),
  currency_code TEXT NOT NULL CHECK(length(currency_code) = 3),
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id, cash_count_id) REFERENCES cash_counts(tenant_id, id),
  UNIQUE(tenant_id, cash_count_id, line_number),
  UNIQUE(tenant_id, cash_count_id, denomination_code)
) STRICT;

CREATE TABLE cash_difference_reviews (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) = 36),
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) = 36),
  company_id TEXT NOT NULL CHECK(length(company_id) = 36),
  branch_id TEXT NOT NULL CHECK(length(branch_id) = 36),
  cash_shift_id TEXT NOT NULL CHECK(length(cash_shift_id) = 36),
  cash_count_id TEXT NOT NULL CHECK(length(cash_count_id) = 36),
  status TEXT NOT NULL CHECK(status IN ('REVIEW_REQUIRED','ACCEPTED','ESCALATED','RESOLVED')),
  severity TEXT NOT NULL,
  tolerance_policy_version TEXT NOT NULL,
  tolerance_policy_checksum TEXT NOT NULL,
  requires_segregation INTEGER NOT NULL CHECK(requires_segregation IN (0,1)),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  version INTEGER NOT NULL CHECK(version > 0),
  correlation_id TEXT NOT NULL,
  FOREIGN KEY (tenant_id, company_id, branch_id, cash_count_id) REFERENCES cash_counts(tenant_id, company_id, branch_id, id),
  FOREIGN KEY (tenant_id, company_id, branch_id, cash_shift_id) REFERENCES cash_shifts(tenant_id, company_id, branch_id, id),
  UNIQUE(tenant_id, id),
  UNIQUE(tenant_id, cash_count_id)
) STRICT;

CREATE TABLE cash_difference_review_actions (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) = 36),
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) = 36),
  cash_difference_review_id TEXT NOT NULL CHECK(length(cash_difference_review_id) = 36),
  action_type TEXT NOT NULL CHECK(action_type IN ('CREATED','ACCEPTED','ESCALATED','RESOLVED')),
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  note TEXT,
  evidence_reference TEXT,
  actor_type TEXT NOT NULL CHECK(actor_type IN ('USER','DEVICE')),
  actor_id TEXT,
  authorization_policy_version TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_checksum TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  origin_device_id TEXT NOT NULL CHECK(length(origin_device_id) = 36),
  created_at TEXT NOT NULL,
  server_recorded_at TEXT,
  FOREIGN KEY (tenant_id, cash_difference_review_id) REFERENCES cash_difference_reviews(tenant_id, id),
  UNIQUE(tenant_id, origin_device_id, idempotency_key)
) STRICT;
CREATE TRIGGER cash_difference_review_actions_no_update
  BEFORE UPDATE ON cash_difference_review_actions
  BEGIN SELECT RAISE(ABORT, 'cash difference review actions are append-only'); END;
CREATE TRIGGER cash_difference_review_actions_no_delete
  BEFORE DELETE ON cash_difference_review_actions
  BEGIN SELECT RAISE(ABORT, 'cash difference review actions are append-only'); END;
CREATE TRIGGER cash_movements_no_update
  BEFORE UPDATE ON cash_movements
  BEGIN SELECT RAISE(ABORT, 'cash movements are append-only once POSTED'); END;
CREATE TRIGGER cash_movements_no_delete
  BEFORE DELETE ON cash_movements
  BEGIN SELECT RAISE(ABORT, 'cash movements are append-only once POSTED'); END;
`.trim();

/**
 * Bloque 23: corrective migration found while materializing CASH-002 (close)
 * for real. `cash_counts`/`cash_difference_reviews` (MIGRATION_006) were
 * built to the full logical schema in cash-counting-schema.md, which
 * describes a richer CashCount/CashDifferenceReview lifecycle (PARTIAL/
 * CORRECTION counts, blind-count mode, a versioned calculation algorithm, a
 * tolerance policy, severity classification, segregation-of-duties) than
 * `CashCount`/`CashDifferenceReview`/`CloseCashShiftUseCase` actually
 * implement today (an atomic CLOSING-only count with none of that policy
 * layer — both classes' own doc comments already say so). Nine columns were
 * `NOT NULL` with no legitimate value: no algorithm-version or
 * tolerance-policy concept exists anywhere in this codebase to populate
 * `calculation_policy_version`/`calculation_checksum`/
 * `tolerance_policy_version`/`tolerance_policy_checksum`, no blind-mode flag
 * is tracked (`blind_mode`), and no severity/segregation policy exists
 * (`severity`, `requires_segregation` on reviews). Writing placeholder
 * values would have been exactly the kind of fabrication this project
 * forbids; owner-approved resolution (Bloque 23) is to relax these nine
 * columns to nullable, so the adapter can persist NULL where there is
 * genuinely no data instead of inventing policy this application doesn't
 * have yet — a real physical correction, not a design decision disguised as
 * one. SQLite has no `ALTER TABLE ... DROP NOT NULL`, so both tables are
 * rebuilt (create corrected shape, copy any existing rows, drop, rename) —
 * safe here because neither table has ever had a writer: `SqliteCashShiftRepository.saveClose`
 * threw `NOT_IMPLEMENTED_CLOSE` unconditionally until this same block, so
 * both are guaranteed empty, but the copy step is unconditional rather than
 * assuming that to stay correct even if that ever stops being true.
 */
const MIGRATION_007 = `
CREATE TABLE cash_counts_new (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) = 36),
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) = 36),
  company_id TEXT NOT NULL CHECK(length(company_id) = 36),
  branch_id TEXT NOT NULL CHECK(length(branch_id) = 36),
  cash_register_id TEXT NOT NULL CHECK(length(cash_register_id) = 36),
  cash_shift_id TEXT NOT NULL CHECK(length(cash_shift_id) = 36),
  count_type TEXT NOT NULL CHECK(count_type IN ('PARTIAL','CLOSING','CORRECTION')),
  status TEXT NOT NULL CHECK(status IN ('IN_PROGRESS','COMPLETED','ABORTED')),
  blind_mode INTEGER CHECK(blind_mode IS NULL OR blind_mode IN (0,1)),
  started_shift_version INTEGER NOT NULL CHECK(started_shift_version > 0),
  movement_cutoff_sequence INTEGER NOT NULL CHECK(movement_cutoff_sequence >= 0),
  calculation_policy_version TEXT,
  calculation_checksum TEXT,
  expected_amount TEXT CHECK(expected_amount IS NULL OR substr(expected_amount,1,1) != '-'),
  counted_amount TEXT CHECK(counted_amount IS NULL OR substr(counted_amount,1,1) != '-'),
  difference_amount TEXT,
  difference_type TEXT CHECK(difference_type IS NULL OR difference_type IN ('SHORTAGE','EXACT','OVERAGE')),
  severity TEXT,
  currency_code TEXT NOT NULL CHECK(length(currency_code) = 3),
  denomination_breakdown_status TEXT NOT NULL CHECK(denomination_breakdown_status IN ('PROVIDED','NOT_PROVIDED')),
  tolerance_policy_version TEXT,
  tolerance_policy_checksum TEXT,
  supersedes_cash_count_id TEXT,
  started_by_actor_type TEXT NOT NULL CHECK(started_by_actor_type IN ('USER','DEVICE')),
  started_by_actor_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_by_actor_type TEXT CHECK(completed_by_actor_type IN ('USER','DEVICE')),
  completed_by_actor_id TEXT,
  completed_at TEXT,
  aborted_by_actor_type TEXT CHECK(aborted_by_actor_type IN ('USER','DEVICE')),
  aborted_by_actor_id TEXT,
  aborted_at TEXT,
  abort_reason_code TEXT,
  origin_device_id TEXT NOT NULL CHECK(length(origin_device_id) = 36),
  start_idempotency_key TEXT NOT NULL,
  start_request_checksum TEXT NOT NULL,
  completion_idempotency_key TEXT,
  completion_request_checksum TEXT,
  correlation_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version > 0),
  created_at TEXT NOT NULL,
  server_recorded_at TEXT,
  FOREIGN KEY (tenant_id, company_id, branch_id, cash_shift_id) REFERENCES cash_shifts(tenant_id, company_id, branch_id, id),
  FOREIGN KEY (tenant_id, supersedes_cash_count_id) REFERENCES cash_counts_new(tenant_id, id),
  UNIQUE(tenant_id, id),
  UNIQUE(tenant_id, company_id, branch_id, id),
  UNIQUE(tenant_id, origin_device_id, start_idempotency_key),
  UNIQUE(tenant_id, origin_device_id, completion_idempotency_key),
  UNIQUE(tenant_id, supersedes_cash_count_id)
) STRICT;
INSERT INTO cash_counts_new SELECT * FROM cash_counts;
DROP TABLE cash_counts;
ALTER TABLE cash_counts_new RENAME TO cash_counts;
CREATE UNIQUE INDEX cash_counts_one_completed_closing_idx
  ON cash_counts(tenant_id, cash_shift_id)
  WHERE count_type = 'CLOSING' AND status = 'COMPLETED';

CREATE TABLE cash_difference_reviews_new (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) = 36),
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) = 36),
  company_id TEXT NOT NULL CHECK(length(company_id) = 36),
  branch_id TEXT NOT NULL CHECK(length(branch_id) = 36),
  cash_shift_id TEXT NOT NULL CHECK(length(cash_shift_id) = 36),
  cash_count_id TEXT NOT NULL CHECK(length(cash_count_id) = 36),
  status TEXT NOT NULL CHECK(status IN ('REVIEW_REQUIRED','ACCEPTED','ESCALATED','RESOLVED')),
  severity TEXT,
  tolerance_policy_version TEXT,
  tolerance_policy_checksum TEXT,
  requires_segregation INTEGER CHECK(requires_segregation IS NULL OR requires_segregation IN (0,1)),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  version INTEGER NOT NULL CHECK(version > 0),
  correlation_id TEXT NOT NULL,
  FOREIGN KEY (tenant_id, company_id, branch_id, cash_count_id) REFERENCES cash_counts(tenant_id, company_id, branch_id, id),
  FOREIGN KEY (tenant_id, company_id, branch_id, cash_shift_id) REFERENCES cash_shifts(tenant_id, company_id, branch_id, id),
  UNIQUE(tenant_id, id),
  UNIQUE(tenant_id, cash_count_id)
) STRICT;
INSERT INTO cash_difference_reviews_new SELECT * FROM cash_difference_reviews;
DROP TABLE cash_difference_reviews;
ALTER TABLE cash_difference_reviews_new RENAME TO cash_difference_reviews;
`.trim();

/**
 * Bloque 23-D: restores Bloque 15's D1 decision (`cash-human-decisions.md`,
 * RESOLVED, never actually superseded), which MIGRATION_007 contradicted
 * without knowing D1 existed. D1: `*_policy_version = UUID NOT NULL sin FK
 * física`, `*_checksum = TEXT NOT NULL` — a reference toward the future,
 * unmaterialized `CashPolicyVersion` entity, not a new entity itself.
 *
 * `CASH_NO_POLICY_SENTINEL_UUID` is the RFC 4122 nil UUID
 * (`00000000-0000-0000-0000-000000000000`) — deliberately not a UUID v7 (the
 * version nibble is `0`, never `7`), so it can never collide with a real,
 * generated `CashPolicyVersion.id` once that entity exists. It does not
 * claim a published policy exists; it is a fixed, documented technical
 * marker for "no CashPolicyVersion applies to this row", identical across
 * every row for the same reason `schema_version` columns elsewhere in this
 * project (`sync.sync_operations`, `audit.audit_events`) are `NOT NULL`
 * without a backing `SchemaVersion` entity.
 *
 * The two `*_checksum` values are real SHA-256 digests of a fixed, accurate,
 * English description of the CURRENT, already-implemented behavior (not an
 * invented business rule): `CASH_CALCULATION_BEHAVIOR_V0` describes
 * `calculateExpectedCash` (unconditional POSTED-movement fold, no policy),
 * `CASH_TOLERANCE_BEHAVIOR_V0` describes `CloseCashShiftUseCase`'s review
 * creation (unconditional whenever `difference_type != 'EXACT'`, no
 * threshold). Both source strings and their hashes are exported below so
 * the adapter and this migration's backfill share one literal, never two
 * hand-copied values that could silently drift apart.
 *
 * Same table-rebuild pattern as MIGRATION_007 (SQLite has no `ALTER COLUMN
 * ... SET NOT NULL`). The `COALESCE` in the copy step both backfills any
 * row that could somehow already hold NULL (defensive — B23-C confirmed
 * neither table has ever had a real writer, so this is expected to be a
 * no-op) and works unchanged whether this runs v1->v8 fresh or v7->v8 on an
 * already-migrated database.
 */
export const CASH_NO_POLICY_SENTINEL_UUID = "00000000-0000-0000-0000-000000000000";
export const CASH_CALCULATION_BEHAVIOR_V0 =
  "ExpectedCash is computed as an unconditional fold of all POSTED CashMovement rows for the shift up to the closing cutoff sequence, signed by direction (IN adds, OUT subtracts), with no configurable tolerance, rounding, or policy engine; no CashPolicyVersion is applied.";
export const CASH_TOLERANCE_BEHAVIOR_V0 =
  "A CashDifferenceReview is created unconditionally whenever the closing count's difference_type is not EXACT (SHORTAGE or OVERAGE); there is no configurable tolerance threshold, materiality band, or approval policy - every non-exact difference is routed to review with no exception.";
export const CASH_CALCULATION_BEHAVIOR_CHECKSUM = createHash("sha256").update(CASH_CALCULATION_BEHAVIOR_V0).digest("hex");
export const CASH_TOLERANCE_BEHAVIOR_CHECKSUM = createHash("sha256").update(CASH_TOLERANCE_BEHAVIOR_V0).digest("hex");

const MIGRATION_008 = `
CREATE TABLE cash_counts_new (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) = 36),
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) = 36),
  company_id TEXT NOT NULL CHECK(length(company_id) = 36),
  branch_id TEXT NOT NULL CHECK(length(branch_id) = 36),
  cash_register_id TEXT NOT NULL CHECK(length(cash_register_id) = 36),
  cash_shift_id TEXT NOT NULL CHECK(length(cash_shift_id) = 36),
  count_type TEXT NOT NULL CHECK(count_type IN ('PARTIAL','CLOSING','CORRECTION')),
  status TEXT NOT NULL CHECK(status IN ('IN_PROGRESS','COMPLETED','ABORTED')),
  blind_mode INTEGER CHECK(blind_mode IS NULL OR blind_mode IN (0,1)),
  started_shift_version INTEGER NOT NULL CHECK(started_shift_version > 0),
  movement_cutoff_sequence INTEGER NOT NULL CHECK(movement_cutoff_sequence >= 0),
  calculation_policy_version TEXT NOT NULL CHECK(length(calculation_policy_version) = 36),
  calculation_checksum TEXT NOT NULL CHECK(length(calculation_checksum) = 64),
  expected_amount TEXT CHECK(expected_amount IS NULL OR substr(expected_amount,1,1) != '-'),
  counted_amount TEXT CHECK(counted_amount IS NULL OR substr(counted_amount,1,1) != '-'),
  difference_amount TEXT,
  difference_type TEXT CHECK(difference_type IS NULL OR difference_type IN ('SHORTAGE','EXACT','OVERAGE')),
  severity TEXT,
  currency_code TEXT NOT NULL CHECK(length(currency_code) = 3),
  denomination_breakdown_status TEXT NOT NULL CHECK(denomination_breakdown_status IN ('PROVIDED','NOT_PROVIDED')),
  tolerance_policy_version TEXT NOT NULL CHECK(length(tolerance_policy_version) = 36),
  tolerance_policy_checksum TEXT NOT NULL CHECK(length(tolerance_policy_checksum) = 64),
  supersedes_cash_count_id TEXT,
  started_by_actor_type TEXT NOT NULL CHECK(started_by_actor_type IN ('USER','DEVICE')),
  started_by_actor_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_by_actor_type TEXT CHECK(completed_by_actor_type IN ('USER','DEVICE')),
  completed_by_actor_id TEXT,
  completed_at TEXT,
  aborted_by_actor_type TEXT CHECK(aborted_by_actor_type IN ('USER','DEVICE')),
  aborted_by_actor_id TEXT,
  aborted_at TEXT,
  abort_reason_code TEXT,
  origin_device_id TEXT NOT NULL CHECK(length(origin_device_id) = 36),
  start_idempotency_key TEXT NOT NULL,
  start_request_checksum TEXT NOT NULL,
  completion_idempotency_key TEXT,
  completion_request_checksum TEXT,
  correlation_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version > 0),
  created_at TEXT NOT NULL,
  server_recorded_at TEXT,
  FOREIGN KEY (tenant_id, company_id, branch_id, cash_shift_id) REFERENCES cash_shifts(tenant_id, company_id, branch_id, id),
  FOREIGN KEY (tenant_id, supersedes_cash_count_id) REFERENCES cash_counts_new(tenant_id, id),
  UNIQUE(tenant_id, id),
  UNIQUE(tenant_id, company_id, branch_id, id),
  UNIQUE(tenant_id, origin_device_id, start_idempotency_key),
  UNIQUE(tenant_id, origin_device_id, completion_idempotency_key),
  UNIQUE(tenant_id, supersedes_cash_count_id)
) STRICT;
INSERT INTO cash_counts_new (
  id, tenant_id, company_id, branch_id, cash_register_id, cash_shift_id, count_type, status,
  blind_mode, started_shift_version, movement_cutoff_sequence, calculation_policy_version,
  calculation_checksum, expected_amount, counted_amount, difference_amount, difference_type,
  severity, currency_code, denomination_breakdown_status, tolerance_policy_version,
  tolerance_policy_checksum, supersedes_cash_count_id, started_by_actor_type,
  started_by_actor_id, started_at, completed_by_actor_type, completed_by_actor_id, completed_at,
  aborted_by_actor_type, aborted_by_actor_id, aborted_at, abort_reason_code, origin_device_id,
  start_idempotency_key, start_request_checksum, completion_idempotency_key,
  completion_request_checksum, correlation_id, version, created_at, server_recorded_at
)
SELECT
  id, tenant_id, company_id, branch_id, cash_register_id, cash_shift_id, count_type, status,
  blind_mode, started_shift_version, movement_cutoff_sequence,
  COALESCE(calculation_policy_version, '${CASH_NO_POLICY_SENTINEL_UUID}'),
  COALESCE(calculation_checksum, '${CASH_CALCULATION_BEHAVIOR_CHECKSUM}'),
  expected_amount, counted_amount, difference_amount, difference_type, severity, currency_code,
  denomination_breakdown_status,
  COALESCE(tolerance_policy_version, '${CASH_NO_POLICY_SENTINEL_UUID}'),
  COALESCE(tolerance_policy_checksum, '${CASH_TOLERANCE_BEHAVIOR_CHECKSUM}'),
  supersedes_cash_count_id, started_by_actor_type, started_by_actor_id, started_at,
  completed_by_actor_type, completed_by_actor_id, completed_at, aborted_by_actor_type,
  aborted_by_actor_id, aborted_at, abort_reason_code, origin_device_id, start_idempotency_key,
  start_request_checksum, completion_idempotency_key, completion_request_checksum,
  correlation_id, version, created_at, server_recorded_at
FROM cash_counts;
DROP TABLE cash_counts;
ALTER TABLE cash_counts_new RENAME TO cash_counts;
CREATE UNIQUE INDEX cash_counts_one_completed_closing_idx
  ON cash_counts(tenant_id, cash_shift_id)
  WHERE count_type = 'CLOSING' AND status = 'COMPLETED';

CREATE TABLE cash_difference_reviews_new (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) = 36),
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) = 36),
  company_id TEXT NOT NULL CHECK(length(company_id) = 36),
  branch_id TEXT NOT NULL CHECK(length(branch_id) = 36),
  cash_shift_id TEXT NOT NULL CHECK(length(cash_shift_id) = 36),
  cash_count_id TEXT NOT NULL CHECK(length(cash_count_id) = 36),
  status TEXT NOT NULL CHECK(status IN ('REVIEW_REQUIRED','ACCEPTED','ESCALATED','RESOLVED')),
  severity TEXT,
  tolerance_policy_version TEXT NOT NULL CHECK(length(tolerance_policy_version) = 36),
  tolerance_policy_checksum TEXT NOT NULL CHECK(length(tolerance_policy_checksum) = 64),
  requires_segregation INTEGER CHECK(requires_segregation IS NULL OR requires_segregation IN (0,1)),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  version INTEGER NOT NULL CHECK(version > 0),
  correlation_id TEXT NOT NULL,
  FOREIGN KEY (tenant_id, company_id, branch_id, cash_count_id) REFERENCES cash_counts(tenant_id, company_id, branch_id, id),
  FOREIGN KEY (tenant_id, company_id, branch_id, cash_shift_id) REFERENCES cash_shifts(tenant_id, company_id, branch_id, id),
  UNIQUE(tenant_id, id),
  UNIQUE(tenant_id, cash_count_id)
) STRICT;
INSERT INTO cash_difference_reviews_new (
  id, tenant_id, company_id, branch_id, cash_shift_id, cash_count_id, status, severity,
  tolerance_policy_version, tolerance_policy_checksum, requires_segregation, created_at,
  resolved_at, version, correlation_id
)
SELECT
  id, tenant_id, company_id, branch_id, cash_shift_id, cash_count_id, status, severity,
  COALESCE(tolerance_policy_version, '${CASH_NO_POLICY_SENTINEL_UUID}'),
  COALESCE(tolerance_policy_checksum, '${CASH_TOLERANCE_BEHAVIOR_CHECKSUM}'),
  requires_segregation, created_at, resolved_at, version, correlation_id
FROM cash_difference_reviews;
DROP TABLE cash_difference_reviews;
ALTER TABLE cash_difference_reviews_new RENAME TO cash_difference_reviews;
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
