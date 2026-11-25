import { createHash } from "node:crypto";
import { basename } from "node:path";
import { SyncOperationSchema, type SyncOperation } from "@pos-platform/contracts";
import type { LocalDatabase } from "@pos-platform/database-sqlite";
import { canonicalJson } from "../channel/canonical-json.js";
import { inspectPendingOutbox } from "./outbox-recovery-inspection.js";
import type { SyncScope } from "./durable-sync-store.js";

type Observation = "NOT_OBSERVED" | "ALREADY_ACCEPTED" | "CONFLICT_OR_REVIEW_REQUIRED";

/**
 * Internal maintenance primitive only. Caller must own the LocalDatabase
 * writer lock, stop the dispatcher, authorize the scope and hold Central
 * exclusion for the entire callback. No renderer or IPC exposure.
 * Never use a cached observation or a replica.
 */
export async function repairLegacySaleOutbox(
  database: LocalDatabase,
  scope: SyncScope,
  operationId: string,
  withCentralExclusion: (operation: SyncOperation, apply: (observation: Observation) => void) => Promise<void>,
): Promise<{ backupPath: string; operationId: string }> {
  const read = () => database.native.prepare(`SELECT operation_json,payload_checksum
    FROM local_sync_outbox WHERE operation_id=? AND tenant_id=? AND company_id=?
    AND branch_id=? AND device_id=? AND installation_id=?`).get(operationId,scope.tenantId,
    scope.companyId,scope.branchId,scope.deviceId,scope.installationId) as
    {operation_json:string;payload_checksum:string} | undefined;
  const eligible = () => inspectPendingOutbox(database,scope).some(
    finding => finding.operationId === operationId && finding.result === "SALE_CREATE_EVIDENCE_MATCH");
  if (!eligible()) throw new Error("SYNC_RECOVERY_EVIDENCE_REQUIRED");
  const original = read();
  if (!original) throw new Error("SYNC_RECOVERY_OPERATION_MISSING");
  const operation = SyncOperationSchema.parse(JSON.parse(original.operation_json));
  const corrected = createHash("sha256").update(canonicalJson(operation.payload)).digest("hex");
  const backupPath = database.createVerifiedBackup("sync-recovery");
  let applied = false;
  await withCentralExclusion(operation, observation => {
    if (applied) throw new Error("SYNC_RECOVERY_ALREADY_APPLIED");
    if (observation !== "NOT_OBSERVED") throw new Error("SYNC_RECOVERY_CENTRAL_REVIEW_REQUIRED");
    const repair = database.native.transaction(() => {
      const current = read();
      if (!current || current.operation_json !== original.operation_json
        || current.payload_checksum !== original.payload_checksum || !eligible()) {
        throw new Error("SYNC_RECOVERY_EVIDENCE_CHANGED");
      }
      const now = new Date().toISOString();
      const updated = database.native.prepare(`UPDATE local_sync_outbox
        SET operation_json=?,payload_checksum=?,updated_at=?
        WHERE operation_id=? AND operation_json=? AND payload_checksum=?
        AND status='PENDING' AND attempt_count=0`).run(
        canonicalJson({...operation,payload_checksum:corrected}),corrected,now,
        operationId,original.operation_json,original.payload_checksum);
      if (updated.changes !== 1) throw new Error("SYNC_RECOVERY_WRITE_CONFLICT");
      database.native.prepare(`INSERT INTO local_operation_audit
        (tenant_id,company_id,branch_id,device_id,actor_type,actor_id,session_id,
        action_code,resource_type,resource_id,correlation_id,causation_id,reason_code,details_json,created_at)
        VALUES (?,?,?,?,'SYSTEM',NULL,?,'SYNC_OUTBOX_CHECKSUM_REPAIRED','SYNC_OPERATION',?,?,?,
        'LEGACY_REQUEST_CHECKSUM',?,?)`).run(scope.tenantId,scope.companyId,scope.branchId,
        scope.deviceId,operation.session_id,operationId,operation.correlation_id,operation.causation_id,
        canonicalJson({previous_checksum:original.payload_checksum,corrected_checksum:corrected,
          original_operation_json:original.operation_json,backup_file:basename(backupPath)}),now);
    });
    repair.immediate();
    applied = true;
  });
  if (!applied) throw new Error("SYNC_RECOVERY_CENTRAL_EXCLUSION_NOT_APPLIED");
  return {backupPath,operationId};
}
