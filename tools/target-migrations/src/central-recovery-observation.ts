import type { PoolClient } from "pg";
import { SyncOperationSchema } from "@pos-platform/contracts";
import { canonicalJson } from "@pos-platform/local-channel";
import { createHash } from "node:crypto";

export type CentralRecoveryObservation =
  | "NOT_OBSERVED"
  | "ALREADY_ACCEPTED"
  | "CONFLICT_OR_REVIEW_REQUIRED";

/** Administrative reconciliation on the authoritative primary, not a public
 * endpoint. A missing row is a snapshot observation, never a repair permit.
 * Caller must independently authorize the maintenance scope and quiesce writers. */
export async function observeCentralRecovery(
  client: PoolClient,
  input: unknown,
  applyUnderExclusion?: (observation: CentralRecoveryObservation) => void,
): Promise<CentralRecoveryObservation> {
  const op = SyncOperationSchema.parse(input);
  const canonicalChecksum = createHash("sha256").update(canonicalJson(op.payload)).digest("hex");
  await client.query(applyUnderExclusion ? "BEGIN ISOLATION LEVEL READ COMMITTED" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const primary = await client.query<{ standby: boolean }>("SELECT pg_is_in_recovery() AS standby");
    if (primary.rows[0]?.standby !== false) throw new Error("SYNC_RECOVERY_PRIMARY_REQUIRED");
    if (applyUnderExclusion) {
      // Administrative maintenance only. The table lock conflicts with all
      // INSERT/UPDATE/DELETE writers, including Central Sync and other services.
      // READ COMMITTED ensures the observation is taken AFTER waiting for writers.
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '15s'");
      await client.query("SET LOCAL row_security = off");
      await client.query("LOCK TABLE sync.sync_operations IN SHARE ROW EXCLUSIVE MODE");
    }
    await client.query("SELECT set_config('app.tenant_id',$1,true)", [op.tenant_id]);
    const result = await client.query<{ exact: boolean }>(
      `SELECT COALESCE(
        id=$2 AND company_id=$5 AND branch_id=$6 AND aggregate_id=$7
        AND aggregate_type=$8 AND actor_id=$9 AND correlation_id=$10
        AND causation_id IS NOT DISTINCT FROM $11::uuid
        AND authority_policy=$12 AND expected_version IS NOT DISTINCT FROM $13::bigint
        AND schema_version=$14 AND payload_checksum=decode($15,'hex')
        AND payload=$16::jsonb AND operation_type=$3 AND idempotency_key=$4
        AND sync_status='SERVER_ACCEPTED' AND committed_at_server IS NOT NULL,
        false) AS exact
      FROM sync.sync_operations WHERE tenant_id=$1
      AND (id=$2 OR (operation_type=$3 AND idempotency_key=$4))`,
      [op.tenant_id,op.operation_id,op.operation_type,op.idempotency_key,
        op.company_id,op.branch_id,op.aggregate_id,op.aggregate_type,op.actor_id,
        op.correlation_id,op.causation_id,op.authority_policy,op.expected_version,
        Number(op.payload_schema_version.split(".")[0]),canonicalChecksum,JSON.stringify(op.payload)],
    );
    let observation: CentralRecoveryObservation = result.rows.length === 0 ? "NOT_OBSERVED"
      : result.rows.length === 1 && result.rows[0]?.exact === true ? "ALREADY_ACCEPTED"
      : "CONFLICT_OR_REVIEW_REQUIRED";
    if (applyUnderExclusion && observation === "NOT_OBSERVED") {
      // operation_id is globally unique; tenant RLS must not hide a collision.
      const collision = await client.query("SELECT 1 FROM sync.sync_operations WHERE id=$1", [op.operation_id]);
      if (collision.rowCount) observation = "CONFLICT_OR_REVIEW_REQUIRED";
    }
    // Synchronous callback: no async work can outlive the held exclusion.
    applyUnderExclusion?.(observation);
    await client.query("COMMIT");
    return observation;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}
