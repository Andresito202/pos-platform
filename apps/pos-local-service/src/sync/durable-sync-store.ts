import { createHash, randomUUID } from "node:crypto";
import {
  SyncBatchResponseSchema,
  SyncOperationSchema,
  validateSyncBatchCorrespondence,
  type SyncBatchRequest,
  type SyncBatchResponse,
  type SyncOperation,
} from "@pos-platform/contracts";
import type { LocalDatabase } from "@pos-platform/database-sqlite";
import { canonicalJson } from "../channel/canonical-json.js";

export interface SyncScope {
  readonly tenantId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly deviceId: string;
  readonly installationId: string;
}

export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export type EnqueueResult = "ENQUEUED" | "ALREADY_ENQUEUED";

interface OutboxRow {
  operation_id: string;
  operation_json: string;
  local_sequence: number;
  status: "PENDING" | "IN_FLIGHT" | "RETRY_WAIT" | "ACKNOWLEDGED" | "DEAD_LETTER";
  attempt_count: number;
  next_attempt_at: string | null;
}

const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 5,
  baseDelayMs: 1_000,
  maxDelayMs: 60_000,
};

function assertRetryPolicy(policy: RetryPolicy): void {
  if (!Number.isSafeInteger(policy.maxAttempts) || policy.maxAttempts < 1) {
    throw new Error("maxAttempts must be a positive safe integer");
  }
  if (!Number.isSafeInteger(policy.baseDelayMs) || policy.baseDelayMs < 1) {
    throw new Error("baseDelayMs must be a positive safe integer");
  }
  if (!Number.isSafeInteger(policy.maxDelayMs) || policy.maxDelayMs < policy.baseDelayMs) {
    throw new Error("maxDelayMs must be >= baseDelayMs");
  }
}

function scopeValues(scope: SyncScope): readonly string[] {
  return [scope.tenantId, scope.companyId, scope.branchId, scope.deviceId, scope.installationId];
}

function retryDelayMs(attemptCount: number, policy: RetryPolicy): number {
  const exponent = Math.max(0, Math.min(attemptCount - 1, 30));
  return Math.min(policy.maxDelayMs, policy.baseDelayMs * (2 ** exponent));
}

function checksum(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export class DurableSyncStore {
  private readonly retryPolicy: RetryPolicy;

  constructor(
    private readonly database: LocalDatabase,
    retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY,
    private readonly now: () => Date = () => new Date(),
  ) {
    assertRetryPolicy(retryPolicy);
    this.retryPolicy = retryPolicy;
  }

  enqueue(input: unknown): EnqueueResult {
    const parsed = SyncOperationSchema.parse(input);
    // `payload_checksum` is a property of the serialized payload, not of the
    // originating request. Recompute it at the single-writer sync boundary so
    // every producer (Sale/Cash/Catalog/Inventory/Customer/Payments) shares one
    // invariant and an incorrect producer cannot persist a misleading digest.
    const operation: SyncOperation = {
      ...parsed,
      payload_checksum: checksum(parsed.payload),
    };
    const operationJson = canonicalJson(operation);
    const createdAt = this.now().toISOString();

    const transaction = this.database.native.transaction((): EnqueueResult => {
      const byOperation = this.database.native.prepare(
        "SELECT operation_json FROM local_sync_outbox WHERE operation_id=?",
      ).get(operation.operation_id) as { operation_json: string } | undefined;
      if (byOperation) {
        if (byOperation.operation_json !== operationJson) {
          throw new Error("sync operation_id collision with different content");
        }
        return "ALREADY_ENQUEUED";
      }

      const byIdempotency = this.database.native.prepare(
        "SELECT operation_id,operation_json FROM local_sync_outbox WHERE tenant_id=? AND operation_type=? AND idempotency_key=?",
      ).get(operation.tenant_id, operation.operation_type, operation.idempotency_key) as
        | { operation_id: string; operation_json: string }
        | undefined;
      if (byIdempotency) {
        if (byIdempotency.operation_json !== operationJson) {
          throw new Error("sync idempotency conflict with different content");
        }
        return "ALREADY_ENQUEUED";
      }

      this.database.native.prepare(
        `INSERT INTO local_sync_outbox(
          operation_id,tenant_id,company_id,branch_id,device_id,installation_id,
          operation_type,idempotency_key,local_sequence,operation_json,payload_checksum,
          status,attempt_count,next_attempt_at,last_error_code,created_at,updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,'PENDING',0,NULL,NULL,?,?)`,
      ).run(
        operation.operation_id,
        operation.tenant_id,
        operation.company_id,
        operation.branch_id,
        operation.device_id,
        operation.installation_id,
        operation.operation_type,
        operation.idempotency_key,
        operation.local_sequence,
        operationJson,
        operation.payload_checksum,
        createdAt,
        createdAt,
      );
      return "ENQUEUED";
    });

    return transaction();
  }

  checkpoint(scope: SyncScope): number {
    const row = this.database.native.prepare(
      `SELECT acknowledged_through_local_sequence AS sequence
         FROM local_sync_checkpoint
        WHERE tenant_id=? AND company_id=? AND branch_id=? AND device_id=? AND installation_id=?`,
    ).get(...scopeValues(scope)) as { sequence: number } | undefined;
    return row?.sequence ?? 0;
  }

  claimBatch(scope: SyncScope, maxOperations: number): SyncBatchRequest | null {
    if (!Number.isSafeInteger(maxOperations) || maxOperations < 1 || maxOperations > 1_000) {
      throw new Error("maxOperations must be between 1 and 1000");
    }

    const at = this.now();
    const checkpoint = this.checkpoint(scope);
    const rows = this.database.native.prepare(
      `SELECT operation_id,operation_json,local_sequence,status,attempt_count,next_attempt_at
         FROM local_sync_outbox
        WHERE tenant_id=? AND company_id=? AND branch_id=? AND device_id=? AND installation_id=?
          AND local_sequence>?
        ORDER BY local_sequence
        LIMIT ?`,
    ).all(...scopeValues(scope), checkpoint, maxOperations) as OutboxRow[];

    if (rows.length === 0) return null;

    const selected: OutboxRow[] = [];
    let expected = checkpoint + 1;
    for (const row of rows) {
      if (row.local_sequence !== expected) break;
      if (row.status === "ACKNOWLEDGED") {
        expected += 1;
        continue;
      }
      const retryReady = row.status === "RETRY_WAIT"
        && row.next_attempt_at !== null
        && Date.parse(row.next_attempt_at) <= at.getTime();
      if (row.status !== "PENDING" && !retryReady) break;
      selected.push(row);
      expected += 1;
    }
    if (selected.length === 0) return null;

    const updatedAt = at.toISOString();
    const claim = this.database.native.transaction(() => {
      const update = this.database.native.prepare(
        `UPDATE local_sync_outbox
            SET status='IN_FLIGHT', attempt_count=attempt_count+1,
                next_attempt_at=NULL, last_error_code=NULL, updated_at=?
          WHERE operation_id=? AND status IN ('PENDING','RETRY_WAIT')`,
      );
      for (const row of selected) {
        if (update.run(updatedAt, row.operation_id).changes !== 1) {
          throw new Error("sync outbox claim lost");
        }
      }
    });
    claim();

    const operations = selected.map((row) => SyncOperationSchema.parse(JSON.parse(row.operation_json)));
    return {
      batch_id: randomUUID(),
      tenant_id: scope.tenantId,
      company_id: scope.companyId,
      branch_id: scope.branchId,
      device_id: scope.deviceId,
      installation_id: scope.installationId,
      checkpoint_local_sequence: checkpoint === 0 ? null : checkpoint,
      operations,
    };
  }

  recordResponse(request: SyncBatchRequest, responseInput: unknown): SyncBatchResponse {
    const response = SyncBatchResponseSchema.parse(responseInput);
    if (!validateSyncBatchCorrespondence(request, response)) {
      throw new Error("sync response does not correspond to request");
    }

    const recordedAt = this.now().toISOString();
    const transaction = this.database.native.transaction(() => {
      for (const result of response.results) {
        const resultJson = canonicalJson(result);
        this.database.native.prepare(
          `INSERT OR IGNORE INTO local_sync_inbox(
            operation_id,result_checksum,result_json,server_status,committed_at_server,recorded_at_local
          ) VALUES (?,?,?,?,?,?)`,
        ).run(
          result.operation_id,
          checksum(result),
          resultJson,
          result.server_status,
          result.committed_at_server,
          recordedAt,
        );

        const row = this.database.native.prepare(
          "SELECT attempt_count FROM local_sync_outbox WHERE operation_id=?",
        ).get(result.operation_id) as { attempt_count: number } | undefined;
        if (!row) throw new Error("sync response references unknown outbox operation");

        if (result.server_status === "SERVER_ACCEPTED" || result.server_status === "SERVER_REJECTED") {
          this.database.native.prepare(
            `UPDATE local_sync_outbox
                SET status='ACKNOWLEDGED',next_attempt_at=NULL,last_error_code=NULL,updated_at=?
              WHERE operation_id=?`,
          ).run(recordedAt, result.operation_id);
        } else if (
          (result.server_status === "RETRY_SCHEDULED" || result.server_status === "WAITING_FOR_DEPENDENCY")
          && result.retryable
        ) {
          this.scheduleRetry(result.operation_id, row.attempt_count, result.server_result_code, recordedAt);
        } else {
          this.deadLetter(result.operation_id, row.attempt_count, result.server_result_code, recordedAt);
        }
      }

      if (response.acknowledged_through_local_sequence !== null) {
        this.advanceCheckpoint(
          {
            tenantId: request.tenant_id,
            companyId: request.company_id,
            branchId: request.branch_id,
            deviceId: request.device_id,
            installationId: request.installation_id,
          },
          response.acknowledged_through_local_sequence,
          recordedAt,
        );
      }
    });
    transaction();
    return response;
  }

  recordTransportFailure(batch: SyncBatchRequest, errorCode: string): void {
    if (!errorCode.trim() || errorCode.length > 128) throw new Error("transport error code is required");
    const at = this.now().toISOString();
    const transaction = this.database.native.transaction(() => {
      for (const operation of batch.operations) {
        const row = this.database.native.prepare(
          "SELECT status,attempt_count FROM local_sync_outbox WHERE operation_id=?",
        ).get(operation.operation_id) as { status: string; attempt_count: number } | undefined;
        if (!row || row.status !== "IN_FLIGHT") continue;
        if (row.attempt_count >= this.retryPolicy.maxAttempts) {
          this.deadLetter(operation.operation_id, row.attempt_count, errorCode, at);
        } else {
          this.scheduleRetry(operation.operation_id, row.attempt_count, errorCode, at);
        }
      }
    });
    transaction();
  }

  recoverInterruptedDispatches(): number {
    const at = this.now().toISOString();
    const result = this.database.native.prepare(
      `UPDATE local_sync_outbox
          SET status='RETRY_WAIT',next_attempt_at=?,last_error_code='PROCESS_RESTART',updated_at=?
        WHERE status='IN_FLIGHT'`,
    ).run(at, at);
    return result.changes;
  }

  requeueDeadLetter(operationId: string): void {
    const at = this.now().toISOString();
    const transaction = this.database.native.transaction(() => {
      const row = this.database.native.prepare(
        "SELECT status FROM local_sync_outbox WHERE operation_id=?",
      ).get(operationId) as { status: string } | undefined;
      if (!row || row.status !== "DEAD_LETTER") throw new Error("sync dead-letter operation not found");

      this.database.native.prepare(
        "UPDATE local_sync_dead_letter SET recovered_at=? WHERE operation_id=? AND recovered_at IS NULL",
      ).run(at, operationId);
      this.database.native.prepare(
        `UPDATE local_sync_outbox
            SET status='PENDING',attempt_count=0,next_attempt_at=NULL,last_error_code=NULL,updated_at=?
          WHERE operation_id=?`,
      ).run(at, operationId);
    });
    transaction();
  }

  outboxState(operationId: string): Readonly<OutboxRow> | null {
    return (this.database.native.prepare(
      `SELECT operation_id,operation_json,local_sequence,status,attempt_count,next_attempt_at
         FROM local_sync_outbox WHERE operation_id=?`,
    ).get(operationId) as OutboxRow | undefined) ?? null;
  }

  private scheduleRetry(operationId: string, attemptCount: number, errorCode: string, at: string): void {
    if (attemptCount >= this.retryPolicy.maxAttempts) {
      this.deadLetter(operationId, attemptCount, errorCode, at);
      return;
    }
    const next = new Date(Date.parse(at) + retryDelayMs(attemptCount, this.retryPolicy)).toISOString();
    this.database.native.prepare(
      `UPDATE local_sync_outbox
          SET status='RETRY_WAIT',next_attempt_at=?,last_error_code=?,updated_at=?
        WHERE operation_id=?`,
    ).run(next, errorCode, at, operationId);
  }

  private deadLetter(operationId: string, attempts: number, reasonCode: string, at: string): void {
    this.database.native.prepare(
      `UPDATE local_sync_outbox
          SET status='DEAD_LETTER',next_attempt_at=NULL,last_error_code=?,updated_at=?
        WHERE operation_id=?`,
    ).run(reasonCode, at, operationId);
    this.database.native.prepare(
      `INSERT INTO local_sync_dead_letter(operation_id,reason_code,attempts,failed_at,recovered_at)
       VALUES (?,?,?,?,NULL)
       ON CONFLICT(operation_id) DO UPDATE SET
         reason_code=excluded.reason_code,
         attempts=excluded.attempts,
         failed_at=excluded.failed_at,
         recovered_at=NULL`,
    ).run(operationId, reasonCode, attempts, at);
  }

  private advanceCheckpoint(scope: SyncScope, sequence: number, at: string): void {
    this.database.native.prepare(
      `INSERT INTO local_sync_checkpoint(
        tenant_id,company_id,branch_id,device_id,installation_id,
        acknowledged_through_local_sequence,updated_at
      ) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(tenant_id,company_id,branch_id,device_id,installation_id)
      DO UPDATE SET
        acknowledged_through_local_sequence=
          MAX(local_sync_checkpoint.acknowledged_through_local_sequence,excluded.acknowledged_through_local_sequence),
        updated_at=excluded.updated_at`,
    ).run(...scopeValues(scope), sequence, at);
  }
}
