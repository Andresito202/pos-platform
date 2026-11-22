import type { Pool } from "pg";
import { SignedWindowsScmCheckpointSchema, canonicalSessionTrustJson, type SignedWindowsScmCheckpoint } from "@pos-platform/contracts";
import { PostgresDeviceProofReplayVerifier, type DeviceProofRequest } from "./device-proof-replay-verifier.js";

export const SCM_CHECKPOINT_PATH = "/v1/scm/checkpoint";
export class PostgresScmDeviceProofVerifier extends PostgresDeviceProofReplayVerifier {
  verifyCheckpointAndConsume(input: DeviceProofRequest) {
    return this.verifyTargetAndConsume(input, SCM_CHECKPOINT_PATH);
  }
}

/** Append-only Central publication. The caller verifies signatures against its
 * independently provisioned root BEFORE publication. No device may publish. */
export class PostgresScmCheckpointRepository {
  constructor(private readonly pool: Pool) {}

  async publish(input: SignedWindowsScmCheckpoint): Promise<void> {
    const signed = SignedWindowsScmCheckpointSchema.parse(input), next = signed.checkpoint;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`scm:${next.installation_id}:${next.device_id}`]);
      const row = (await client.query("SELECT envelope FROM platform.scm_checkpoints WHERE installation_id=$1 AND device_id=$2 ORDER BY trust_revision DESC LIMIT 1", [next.installation_id, next.device_id])).rows[0];
      if (row) {
        const prior = SignedWindowsScmCheckpointSchema.parse(row.envelope);
        if (next.trust_revision === prior.checkpoint.trust_revision && canonicalSessionTrustJson(signed) === canonicalSessionTrustJson(prior)) {
          await client.query("COMMIT"); return;
        }
        const old = prior.checkpoint;
        if (next.trust_revision !== old.trust_revision + 1 ||
            next.authority_spki_sha256 !== old.authority_spki_sha256 || next.authority_public_key_pem !== old.authority_public_key_pem ||
            next.current_policy_revision !== old.current_policy_revision || next.current_candidate_sha256 !== old.current_candidate_sha256 ||
            next.not_before !== old.not_before || next.expires_at !== old.expires_at ||
            !old.revoked_policy_ids.every(id => next.revoked_policy_ids.includes(id)) ||
            !old.revoked_authority_pins.every(pin => next.revoked_authority_pins.includes(pin))) throw Error("SCM_CHECKPOINT_TRANSITION_REJECTED");
      } else if (next.trust_revision !== 1) throw Error("SCM_INITIAL_CHECKPOINT_REQUIRED");
      await client.query("INSERT INTO platform.scm_checkpoints(installation_id,device_id,trust_revision,envelope) VALUES($1,$2,$3,$4::jsonb)", [next.installation_id, next.device_id, next.trust_revision, JSON.stringify(signed)]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { client.release(); }
  }

  async latest(installationId: string, deviceId: string): Promise<SignedWindowsScmCheckpoint | null> {
    const row = (await this.pool.query("SELECT envelope FROM platform.scm_checkpoints WHERE installation_id=$1 AND device_id=$2 ORDER BY trust_revision DESC LIMIT 1", [installationId, deviceId])).rows[0];
    return row ? SignedWindowsScmCheckpointSchema.parse(row.envelope) : null;
  }
}
