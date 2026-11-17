/**
 * Typed Central Sync domain consumers for the existing central-sync-server.
 *
 * Durable receive remains `persistOperation` → `sync.sync_operations` with
 * `SERVER_ACCEPTED`. This module performs *application* after that durable
 * write: payload shape checks, causal parent presence, inventory conflict
 * detection across accepted operations, and audit-grade result codes.
 *
 * It does NOT invent a second sync engine, commercial POS schema, or silent
 * rewrites of historical sync rows. Confirmed sales stay durable; conflicts
 * surface as `CONFLICT` / `REVIEW_REQUIRED` with review flags.
 */
import type { PoolClient } from "pg";
import type { SyncOperation } from "@pos-platform/contracts";
import { uuidV7FromModule } from "@pos-platform/contracts";
import { createHash } from "node:crypto";
import { canonicalJson } from "@pos-platform/local-channel";

export type DomainApplyOutcome = {
  readonly server_status: "SERVER_ACCEPTED" | "CONFLICT" | "REVIEW_REQUIRED";
  readonly server_result_code: string;
  readonly review_required: boolean;
  readonly applied: boolean;
};

const SALE_TYPES = new Set([
  "SALE_CREATED",
  "SALE_CANCELLED",
  "SALE_COMPLETED",
]);
const PAYMENT_TYPES = new Set([
  "PAYMENT_REGISTERED",
  "PAYMENT_CONFIRMED",
  "PAYMENT_CANCELLED",
]);
const INVENTORY_TYPES = new Set([
  "INVENTORY_MOVEMENT_APPEND",
  "INVENTORY_RESERVATION_CREATE",
  "INVENTORY_RESERVATION_RELEASE",
  "INVENTORY_RESERVATION_EXPIRE",
  "INVENTORY_RESERVATION_CONSUME",
  "INVENTORY_TRANSFORM_POST",
]);
const PRODUCTION_TYPES = new Set([
  "BAKERY_PRODUCTION_ORDER_CREATED",
  "BAKERY_PRODUCTION_ORDER_PLANNED",
  "BAKERY_PRODUCTION_RELEASED",
  "BAKERY_PRODUCTION_CONFIRMED",
  "BAKERY_PRODUCTION_DEVIATION_AUTHORIZED",
  "BAKERY_RECIPE_DRAFT_CREATED",
  "BAKERY_RECIPE_APPROVED",
]);
const AUDIT_TYPES = new Set([
  "AUDIT_EVENT_RECORDED",
  "LOCAL_OPERATION_AUDIT",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function presentationIdOf(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const value = payload.presentation_id;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function quantityOf(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const value = payload.quantity;
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

export function classifyDomainFamily(operationType: string): string {
  if (SALE_TYPES.has(operationType)) return "SALES";
  if (PAYMENT_TYPES.has(operationType)) return "PAYMENTS";
  if (INVENTORY_TYPES.has(operationType)) return "INVENTORY";
  if (PRODUCTION_TYPES.has(operationType)) return "PRODUCTION";
  if (AUDIT_TYPES.has(operationType)) return "AUDIT";
  if (operationType.startsWith("INVENTORY_") && operationType.includes("SHRINK")) return "INVENTORY";
  return "UNTYPED";
}

function domainFamily(operationType: string): string {
  return classifyDomainFamily(operationType);
}

async function parentSatisfied(client: PoolClient, operation: SyncOperation): Promise<boolean> {
  if (operation.causation_id === null) return true;
  const result = await client.query(
    `SELECT 1 FROM sync.sync_operations
      WHERE tenant_id = $1 AND id = $2 AND sync_status IN ('SERVER_ACCEPTED','CONFLICT','REVIEW_REQUIRED')
      LIMIT 1`,
    [operation.tenant_id, operation.causation_id],
  );
  return (result.rowCount ?? 0) > 0;
}

function projectionStatusOf(outcome: DomainApplyOutcome): "APPLIED" | "CONFLICT" | "REVIEW_REQUIRED" | "REJECTED" {
  if (outcome.applied && outcome.server_status === "SERVER_ACCEPTED") return "APPLIED";
  if (outcome.server_status === "CONFLICT") return "CONFLICT";
  if (outcome.server_status === "REVIEW_REQUIRED") return "REVIEW_REQUIRED";
  return "REJECTED";
}

/**
 * Persist typed domain application into sync.domain_projections (028).
 * Idempotent on (tenant_id, operation_id). Untyped durable receives skip this.
 */
export async function upsertDomainProjection(
  client: PoolClient,
  operation: SyncOperation,
  outcome: DomainApplyOutcome,
): Promise<void> {
  const family = domainFamily(operation.operation_type);
  if (family === "UNTYPED") return;
  if (!operation.company_id || !operation.branch_id) return;
  const projectionStatus = projectionStatusOf(outcome);
  const payloadChecksum = createHash("sha256").update(canonicalJson(operation.payload)).digest("hex");
  await client.query(
    `INSERT INTO sync.domain_projections (
       id, tenant_id, company_id, branch_id, operation_id, operation_type, family,
       aggregate_type, aggregate_id, projection_status, result_code, payload, payload_checksum, applied_at, version
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7,
       $8, $9, $10, $11, $12::jsonb, $13, clock_timestamp(), 1
     )
     ON CONFLICT (tenant_id, operation_id) DO NOTHING`,
    [
      uuidV7FromModule(),
      operation.tenant_id,
      operation.company_id,
      operation.branch_id,
      operation.operation_id,
      operation.operation_type,
      family,
      operation.aggregate_type,
      operation.aggregate_id,
      projectionStatus,
      outcome.server_result_code,
      JSON.stringify(operation.payload),
      payloadChecksum,
    ],
  );
}

async function recordApplicationAudit(
  client: PoolClient,
  operation: SyncOperation,
  outcome: DomainApplyOutcome,
  detail: Record<string, unknown>,
): Promise<void> {
  const reportedAt = new Date().toISOString();
  const newValue = {
    family: domainFamily(operation.operation_type),
    operation_type: operation.operation_type,
    apply: outcome,
    detail,
  };
  const payloadChecksum = createHash("sha256").update(canonicalJson(newValue)).digest("hex");
  await client.query(
    `INSERT INTO audit.audit_events (
       id, tenant_id, company_id, branch_id, actor_type, actor_id, session_id, device_id,
       action_code, resource_type, resource_reference_kind, resource_id, operation_id,
       correlation_id, causation_id, schema_version, reported_at, server_recorded_at,
       result, reason_code, reason_detail, previous_value, new_value,
       reviewer_actor_type, reviewer_actor_id, approver_actor_type, approver_actor_id,
       evidence_reference, evidence_checksum, payload_checksum
     ) VALUES (
       $1, $2, $3, $4, 'SYSTEM', NULL, NULL, NULL,
       'SYNC_DOMAIN_APPLY', $5, 'BATCH', NULL, $6,
       $7, $8, 1, $9, clock_timestamp(),
       $10, $11, $12, NULL, $13::jsonb,
       NULL, NULL, NULL, NULL,
       NULL, NULL, $14
     )`,
    [
      uuidV7FromModule(),
      operation.tenant_id,
      operation.company_id,
      operation.branch_id,
      domainFamily(operation.operation_type),
      operation.operation_id,
      operation.correlation_id,
      operation.causation_id,
      reportedAt,
      outcome.server_status === "SERVER_ACCEPTED" ? "APPLIED" : outcome.server_status,
      outcome.server_result_code,
      JSON.stringify(detail).slice(0, 2000),
      JSON.stringify(newValue),
      payloadChecksum,
    ],
  );
}

async function detectInventoryConflict(
  client: PoolClient,
  operation: SyncOperation,
): Promise<{ conflict: boolean; reason: string | null }> {
  if (
    operation.operation_type !== "INVENTORY_RESERVATION_CREATE"
    && operation.operation_type !== "INVENTORY_MOVEMENT_APPEND"
  ) {
    return { conflict: false, reason: null };
  }
  const presentationId = presentationIdOf(operation.payload);
  if (!presentationId) {
    return { conflict: false, reason: null };
  }
  const peers = await client.query<{
    id: string;
    operation_type: string;
    actor_id: string;
    payload: unknown;
  }>(
    `SELECT id, operation_type, actor_id::text, payload
       FROM sync.sync_operations
      WHERE tenant_id = $1 AND company_id = $2 AND branch_id = $3
        AND id <> $4
        AND operation_type IN ('INVENTORY_RESERVATION_CREATE','INVENTORY_MOVEMENT_APPEND')
        AND sync_status IN ('SERVER_ACCEPTED','CONFLICT','REVIEW_REQUIRED')
      ORDER BY received_at_server ASC
      LIMIT 200`,
    [operation.tenant_id, operation.company_id, operation.branch_id, operation.operation_id],
  );
  for (const peer of peers.rows) {
    if (presentationIdOf(peer.payload) !== presentationId) continue;
    if (peer.actor_id === operation.actor_id) continue;
    // Distinct actors (typically distinct cajas) claiming the same presentation
    // at the same branch while offline — durable receive kept; application flags
    // authorized review. Does not invent global stock or erase either sale.
    return {
      conflict: true,
      reason: `INVENTORY_CROSS_DEVICE_OVERLAP peer=${peer.id} type=${peer.operation_type} presentation=${presentationId} qty=${quantityOf(operation.payload) ?? "n/a"}`,
    };
  }
  return { conflict: false, reason: null };
}

function validateTypedPayload(operation: SyncOperation): DomainApplyOutcome | null {
  const family = domainFamily(operation.operation_type);
  if (family === "UNTYPED") {
    return {
      server_status: "SERVER_ACCEPTED",
      server_result_code: "DURABLE_RECEIVED_UNTYPED",
      review_required: false,
      applied: false,
    };
  }
  if (!isRecord(operation.payload)) {
    return {
      server_status: "REVIEW_REQUIRED",
      server_result_code: "DOMAIN_PAYLOAD_NOT_OBJECT",
      review_required: true,
      applied: false,
    };
  }
  if (family === "SALES" && typeof operation.payload.sale_id !== "string") {
    return {
      server_status: "REVIEW_REQUIRED",
      server_result_code: "SALE_PAYLOAD_INCOMPLETE",
      review_required: true,
      applied: false,
    };
  }
  if (
    family === "PAYMENTS"
    && typeof operation.payload.payment_id !== "string"
    && typeof operation.payload.paymentId !== "string"
    && typeof operation.payload.sale_id !== "string"
  ) {
    return {
      server_status: "REVIEW_REQUIRED",
      server_result_code: "PAYMENT_PAYLOAD_INCOMPLETE",
      review_required: true,
      applied: false,
    };
  }
  if (family === "INVENTORY" && operation.operation_type.includes("RESERVATION") && typeof operation.payload.reservation_id !== "string") {
    return {
      server_status: "REVIEW_REQUIRED",
      server_result_code: "RESERVATION_PAYLOAD_INCOMPLETE",
      review_required: true,
      applied: false,
    };
  }
  if (family === "PRODUCTION" && typeof operation.payload.order_id !== "string" && typeof operation.payload.recipe_id !== "string") {
    return {
      server_status: "REVIEW_REQUIRED",
      server_result_code: "PRODUCTION_PAYLOAD_INCOMPLETE",
      review_required: true,
      applied: false,
    };
  }
  return null;
}

/**
 * Apply one already-persisted sync operation to the Central domain projection
 * layer (typed validation + conflict policy + audit). Call only after durable
 * `persistOperation` in the same tenant transaction.
 */
export async function applyCentralDomainOperation(
  client: PoolClient,
  operation: SyncOperation,
): Promise<DomainApplyOutcome> {
  const early = validateTypedPayload(operation);
  if (early?.server_result_code === "DURABLE_RECEIVED_UNTYPED") {
    await recordApplicationAudit(client, operation, early, { stage: "untyped" });
    return early;
  }
  if (early && early.server_status !== "SERVER_ACCEPTED") {
    await recordApplicationAudit(client, operation, early, { stage: "payload" });
    await upsertDomainProjection(client, operation, early);
    await client.query(
      `UPDATE sync.sync_operations
          SET sync_status = $3, version = version + 1
        WHERE tenant_id = $1 AND id = $2`,
      [operation.tenant_id, operation.operation_id, early.server_status],
    );
    return early;
  }

  if (!(await parentSatisfied(client, operation))) {
    const waiting: DomainApplyOutcome = {
      server_status: "REVIEW_REQUIRED",
      server_result_code: "CAUSAL_PARENT_MISSING",
      review_required: true,
      applied: false,
    };
    await recordApplicationAudit(client, operation, waiting, { stage: "causality" });
    await upsertDomainProjection(client, operation, waiting);
    await client.query(
      `UPDATE sync.sync_operations
          SET sync_status = 'REVIEW_REQUIRED', version = version + 1
        WHERE tenant_id = $1 AND id = $2`,
      [operation.tenant_id, operation.operation_id],
    );
    return waiting;
  }

  if (domainFamily(operation.operation_type) === "INVENTORY") {
    const overlap = await detectInventoryConflict(client, operation);
    if (overlap.conflict) {
      const conflict: DomainApplyOutcome = {
        server_status: "CONFLICT",
        server_result_code: "INVENTORY_DISTRIBUTED_OVERLAP",
        review_required: true,
        applied: false,
      };
      await recordApplicationAudit(client, operation, conflict, {
        stage: "inventory_conflict",
        reason: overlap.reason,
      });
      await upsertDomainProjection(client, operation, conflict);
      await client.query(
        `UPDATE sync.sync_operations
            SET sync_status = 'CONFLICT', version = version + 1
          WHERE tenant_id = $1 AND id = $2`,
        [operation.tenant_id, operation.operation_id],
      );
      return conflict;
    }
  }

  const applied: DomainApplyOutcome = {
    server_status: "SERVER_ACCEPTED",
    server_result_code: `DOMAIN_APPLIED_${domainFamily(operation.operation_type)}`,
    review_required: false,
    applied: true,
  };
  await recordApplicationAudit(client, operation, applied, { stage: "applied" });
  await upsertDomainProjection(client, operation, applied);
  return applied;
}
