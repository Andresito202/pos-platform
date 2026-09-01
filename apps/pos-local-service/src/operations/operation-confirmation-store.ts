import { createHash } from "node:crypto";
import type { LocalDatabase } from "@pos-platform/database-sqlite";
import { canonicalJson } from "../channel/canonical-json.js";
import type { DurableSyncStore, SyncScope } from "../sync/durable-sync-store.js";

const OPERATION_PAYLOAD_SCHEMA_VERSION = "1.0.0";

export interface OperationConfirmationContext {
  readonly scope: SyncScope;
  readonly sessionId: string;
  /**
   * The identity performing the operation. This runtime has no user/session
   * model yet (SEC-G01/G02/G03 remain NOT_EVALUATED) — the only authenticated
   * principal today is the device itself, so the device identity doubles as
   * the actor. This is intentionally NOT a user identity.
   */
  readonly actorId: string;
}

export interface OperationConfirmationRequest {
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly operationType: string;
  readonly payload: unknown;
}

export type ConfirmOutcome =
  | { readonly kind: "CONFIRMED"; readonly operationId: string; readonly resultCode: "CONFIRMED" }
  | { readonly kind: "ALREADY_CONFIRMED"; readonly operationId: string; readonly resultCode: string }
  | { readonly kind: "IDEMPOTENCY_CONFLICT"; readonly operationId: string };

interface RuntimeOperationRow {
  operation_id: string;
  payload_checksum: string;
  status: "PENDING" | "SUCCEEDED" | "REJECTED" | "UNKNOWN";
  result_code: string;
}

function checksum(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/**
 * Materializes the RT-006 vertical slice: a domain-agnostic operation
 * confirmation that proves request -> auth -> validation -> SQLite
 * transaction -> durable outbox -> response -> restart/retry -> audit,
 * without creating any commercial-domain table. Every commercial physical
 * model (Catalog/Pricing/Inventory/Sales/Cash/Payments) is documentally
 * CLOSED but its migration/DDL gate remains NO-GO
 * (docs/architecture/physical-model/traceability.md:271) — this store only
 * ever touches `runtime_operations` (MIGRATION_001, already GO_AUTHORIZED,
 * unused in production until now) and `local_operation_audit`
 * (MIGRATION_005, infrastructure-shaped like `local_security_audit`, not a
 * commercial aggregate).
 */
export class OperationConfirmationStore {
  constructor(
    private readonly database: LocalDatabase,
    private readonly durableSync: DurableSyncStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  confirm(context: OperationConfirmationContext, request: OperationConfirmationRequest): ConfirmOutcome {
    const payloadChecksum = checksum(request.payload);
    const nowIso = this.now().toISOString();

    const transaction = this.database.native.transaction((): ConfirmOutcome => {
      const existing = this.database.native.prepare(
        "SELECT operation_id, payload_checksum, status, result_code FROM runtime_operations WHERE idempotency_key=?",
      ).get(request.idempotencyKey) as RuntimeOperationRow | undefined;

      if (existing) {
        if (existing.operation_id !== request.operationId || existing.payload_checksum !== payloadChecksum) {
          return { kind: "IDEMPOTENCY_CONFLICT", operationId: request.operationId };
        }
        return { kind: "ALREADY_CONFIRMED", operationId: existing.operation_id, resultCode: existing.result_code };
      }

      this.database.native.prepare(
        `INSERT INTO runtime_operations(
          operation_id, idempotency_key, payload_checksum, status, result_code, created_at, updated_at
        ) VALUES (?, ?, ?, 'SUCCEEDED', 'CONFIRMED', ?, ?)`,
      ).run(request.operationId, request.idempotencyKey, payloadChecksum, nowIso, nowIso);

      this.database.native.prepare(
        `INSERT INTO local_operation_audit(
          tenant_id, company_id, branch_id, device_id, actor_type, actor_id, session_id,
          action_code, resource_type, resource_id, correlation_id, causation_id, reason_code,
          details_json, created_at
        ) VALUES (?, ?, ?, ?, 'DEVICE', ?, ?, 'OPERATION_CONFIRMED', ?, ?, ?, ?, NULL, ?, ?)`,
      ).run(
        context.scope.tenantId,
        context.scope.companyId,
        context.scope.branchId,
        context.scope.deviceId,
        context.actorId,
        context.sessionId,
        request.operationType,
        request.operationId,
        request.correlationId,
        request.causationId,
        canonicalJson({ operation_type: request.operationType, payload_checksum: payloadChecksum }),
        nowIso,
      );

      const nextSequence = (this.database.native.prepare(
        `SELECT COALESCE(MAX(local_sequence), 0) + 1 AS next_sequence FROM local_sync_outbox
          WHERE tenant_id=? AND company_id=? AND branch_id=? AND device_id=? AND installation_id=?`,
      ).get(
        context.scope.tenantId,
        context.scope.companyId,
        context.scope.branchId,
        context.scope.deviceId,
        context.scope.installationId,
      ) as { next_sequence: number }).next_sequence;

      this.durableSync.enqueue({
        operation_id: request.operationId,
        tenant_id: context.scope.tenantId,
        company_id: context.scope.companyId,
        branch_id: context.scope.branchId,
        device_id: context.scope.deviceId,
        installation_id: context.scope.installationId,
        session_id: context.sessionId,
        actor_id: context.actorId,
        aggregate_type: "RUNTIME_OPERATION",
        aggregate_id: request.operationId,
        operation_type: request.operationType,
        authority_policy: "LOCAL_AUTHORITATIVE_UNTIL_SYNC",
        local_sequence: nextSequence,
        idempotency_key: request.idempotencyKey,
        expected_version: null,
        payload_schema_version: OPERATION_PAYLOAD_SCHEMA_VERSION,
        payload: request.payload,
        payload_checksum: payloadChecksum,
        causation_id: request.causationId,
        correlation_id: request.correlationId,
        occurred_at_local: nowIso,
        recorded_at_local: nowIso,
      });

      return { kind: "CONFIRMED", operationId: request.operationId, resultCode: "CONFIRMED" };
    });

    return transaction();
  }
}
