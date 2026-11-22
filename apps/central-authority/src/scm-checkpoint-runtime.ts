import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { WindowsScmPolicyTrustSchema } from "@pos-platform/contracts";
import { PostgresScmCheckpointRepository, PostgresScmDeviceProofVerifier, type Pool } from "@pos-platform/database-postgres";
import { ScmCheckpointIssuer } from "./scm-checkpoint-issuer.js";
import { createScmCheckpointHandler } from "./scm-checkpoint-http.js";

function managed(file: string): string {
  if (typeof file !== "string" || !isAbsolute(file)) throw Error("SCM_MANAGED_FILE_REQUIRED");
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536 || process.platform !== "win32" && (stat.mode & 0o077) !== 0) throw Error("SCM_MANAGED_FILE_REQUIRED");
  return new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(file));
}
/** Central operator provision, never accepted from a device or HTTP body.
 * Revisions are published on startup, transactionally and idempotently. */
export async function prepareScmCheckpointRuntime(pool: Pool, provisionFile: string) {
  const provision = JSON.parse(managed(provisionFile)) as { signer_private_file: string; root_public_key_file: string; checkpoints: unknown[] };
  const key = createPrivateKey(managed(provision.signer_private_file));
  const root = createPublicKey(managed(provision.root_public_key_file));
  if (key.asymmetricKeyType !== "ed25519" || root.asymmetricKeyType !== "ed25519" ||
      !createPublicKey(key).export({ type: "spki", format: "der" }).equals(root.export({ type: "spki", format: "der" }))) throw Error("SCM_CENTRAL_SIGNER_REJECTED");
  const pin = createHash("sha256").update(root.export({ type: "spki", format: "der" })).digest("hex");
  if (!Array.isArray(provision.checkpoints) || provision.checkpoints.length === 0 || provision.checkpoints.length > 128) throw Error("SCM_CHECKPOINT_PROVISION_REQUIRED");
  const issuer = new ScmCheckpointIssuer({ sign: async bytes => sign(null, bytes, key) });
  const repository = new PostgresScmCheckpointRepository(pool);
  for (const input of provision.checkpoints) {
    const checkpoint = WindowsScmPolicyTrustSchema.parse(input);
    if (checkpoint.authority_spki_sha256 !== pin || !createPublicKey(checkpoint.authority_public_key_pem).export({ type: "spki", format: "der" }).equals(root.export({ type: "spki", format: "der" }))) throw Error("SCM_CHECKPOINT_ROOT_REJECTED");
    await repository.publish(await issuer.issue(checkpoint));
  }
  return createScmCheckpointHandler(new PostgresScmDeviceProofVerifier(pool), repository);
}
