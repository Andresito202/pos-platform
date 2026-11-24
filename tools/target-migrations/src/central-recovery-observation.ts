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
): Promise<CentralRecoveryObservation> {
  const op = SyncOperationSchema.parse(input);
  const canonicalChecksum = createHash("sha256").update(canonicalJson(op.payload)).digest("hex");
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const primary = await client.query<{ standby: boolean }>("SELECT pg_is_in_recovery() AS standby");
    if (primary.rows[0]?.standby !== false) throw new Error("SYNC_RECOVERY_PRIMARY_REQUIRED");
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
    await client.query("COMMIT");
    if (result.rows.length === 0) return "NOT_OBSERVED";
    if (result.rows.length === 1 && result.rows[0]?.exact === true) return "ALREADY_ACCEPTED";
    return "CONFLICT_OR_REVIEW_REQUIRED";
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}
