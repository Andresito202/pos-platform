import { createHash } from "node:crypto";
import { SyncOperationSchema } from "@pos-platform/contracts";
import type { LocalDatabase } from "@pos-platform/database-sqlite";
import { canonicalJson } from "../channel/canonical-json.js";
import type { SyncScope } from "./durable-sync-store.js";

type Finding = {
  operationId: string;
  sequence: number;
  result: "VALID" | "SALE_CREATE_EVIDENCE_MATCH" | "REVIEW_REQUIRED";
};

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/** Read-only diagnostic. Matching local evidence is not permission to rewrite
 * an operation: Central absence, backup and exclusive maintenance are separate gates. */
export function inspectPendingOutbox(database: LocalDatabase, scope: SyncScope): Finding[] {
  const inspect = database.native.transaction(() => {
    const rows = database.native.prepare(`SELECT operation_id,operation_json,payload_checksum,
      local_sequence,operation_type,idempotency_key,status,attempt_count
      FROM local_sync_outbox WHERE tenant_id=? AND company_id=? AND branch_id=?
      AND device_id=? AND installation_id=? AND status!='ACKNOWLEDGED'
      ORDER BY local_sequence`).all(scope.tenantId,scope.companyId,scope.branchId,
      scope.deviceId,scope.installationId) as {
        operation_id: string; operation_json: string; payload_checksum: string;
        local_sequence: number; operation_type: string; idempotency_key: string;
        status: string; attempt_count: number;
      }[];
    return rows.map((row): Finding => {
      const base = { operationId: row.operation_id, sequence: row.local_sequence };
      const review: Finding = { ...base, result: "REVIEW_REQUIRED" };
      try {
        const op = SyncOperationSchema.parse(JSON.parse(row.operation_json));
        if (op.operation_id !== row.operation_id || op.local_sequence !== row.local_sequence
          || op.operation_type !== row.operation_type || op.idempotency_key !== row.idempotency_key
          || op.tenant_id !== scope.tenantId || op.company_id !== scope.companyId
          || op.branch_id !== scope.branchId || op.device_id !== scope.deviceId
          || op.installation_id !== scope.installationId || op.payload_checksum !== row.payload_checksum) return review;
        if (digest(op.payload) === row.payload_checksum) return { ...base, result: "VALID" };
        // Never infer a cancellation request checksum from its creation record.
        if (op.operation_type !== "SALE_CREATED" || op.aggregate_type !== "SALE"
          || op.payload_schema_version !== "1.0.0" || row.status !== "PENDING"
          || row.attempt_count !== 0 || op.expected_version !== null
          || op.authority_policy !== "LOCAL_AUTHORITATIVE_UNTIL_SYNC") return review;
        if (database.native.prepare("SELECT 1 FROM local_sync_inbox WHERE operation_id=?").get(op.operation_id)) return review;
        if (database.native.prepare("SELECT 1 FROM local_sync_dead_letter WHERE operation_id=?").get(op.operation_id)) return review;
        const checkpoint = database.native.prepare(`SELECT acknowledged_through_local_sequence AS sequence FROM local_sync_checkpoint
          WHERE tenant_id=? AND company_id=? AND branch_id=? AND device_id=? AND installation_id=?`)
          .get(scope.tenantId,scope.companyId,scope.branchId,scope.deviceId,scope.installationId) as {sequence:number} | undefined;
        if (op.local_sequence <= (checkpoint?.sequence ?? 0)) return review;
        const sale = database.native.prepare(`SELECT id,customer_id,document_series,sale_number,
          calculation_checksum,currency_code,payable_amount,request_checksum,correlation_id,
          causation_id,operator_actor_id,created_at FROM sales_sales
          WHERE tenant_id=? AND company_id=? AND branch_id=? AND origin_device_id=?
          AND installation_id=? AND id=? AND operation_id=? AND idempotency_key=?`)
          .get(scope.tenantId,scope.companyId,scope.branchId,scope.deviceId,scope.installationId,
            op.aggregate_id,op.operation_id,op.idempotency_key) as {
            id:string; customer_id:string|null; document_series:string; sale_number:number;
            calculation_checksum:string; currency_code:string; payable_amount:string;
            request_checksum:string; correlation_id:string; causation_id:string|null;
            operator_actor_id:string; created_at:string;
          } | undefined;
        if (!sale || sale.request_checksum !== row.payload_checksum
          || sale.correlation_id !== op.correlation_id || sale.causation_id !== op.causation_id
          || sale.operator_actor_id !== op.actor_id || sale.created_at !== op.occurred_at_local
          || sale.created_at !== op.recorded_at_local) return review;
        const runtime = database.native.prepare(`SELECT 1 FROM runtime_operations
          WHERE operation_id=? AND idempotency_key=? AND payload_checksum=?
          AND status='SUCCEEDED' AND result_code='SALE_CREATED'`)
          .get(op.operation_id,op.idempotency_key,row.payload_checksum);
        if (!runtime) return review;
        const expected = { sale_id:sale.id, ...(sale.customer_id ? {customer_id:sale.customer_id}:{}),
          document_series:sale.document_series,sale_number:sale.sale_number,
          calculation_checksum:sale.calculation_checksum,currency_code:sale.currency_code,
          payable_amount:sale.payable_amount };
        if (canonicalJson(expected) !== canonicalJson(op.payload)) return review;
        const audits = database.native.prepare(`SELECT details_json FROM local_operation_audit
          WHERE tenant_id=? AND company_id=? AND branch_id=? AND device_id=?
          AND actor_type='USER' AND actor_id=? AND session_id=? AND action_code='SALE_CREATED'
          AND resource_type='SALE' AND resource_id=? AND correlation_id=? AND causation_id IS ?
          AND created_at=?`).all(scope.tenantId,scope.companyId,scope.branchId,scope.deviceId,
          op.actor_id,op.session_id,sale.id,op.correlation_id,op.causation_id,sale.created_at) as {details_json:string}[];
        if (audits.length !== 1 || canonicalJson(JSON.parse(audits[0]!.details_json)) !== canonicalJson(expected)) return review;
        return { ...base, result: "SALE_CREATE_EVIDENCE_MATCH" };
      } catch {
        return review;
      }
    });
  });
  return inspect();
}
