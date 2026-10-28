import { createHash, createPublicKey } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import * as z from "zod";
import { SignedLicenseCapacitySchema } from "@pos-platform/contracts";
import type { LocalDatabase } from "@pos-platform/database-sqlite";
import type { SyncScope } from "../sync/durable-sync-store.js";
import { canonicalJson } from "../channel/canonical-json.js";
import { LicenseVerifier, type TrustedSigningKey } from "./license-verifier.js";
import { LocalSecurityLifecycle } from "./security-lifecycle.js";
import { TrustedClockGuard } from "./trusted-clock.js";

const Provision = z.strictObject({
  profile: z.literal("CAMACHO_LICENSE_CAPACITY_PROVISION_V2"),
  keys: z.array(z.strictObject({
    key_id: z.string().min(1).max(128), public_key_pem: z.string().min(80).max(4096),
    spki_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    status: z.enum(["ACTIVE", "VERIFY_ONLY", "REVOKED"]),
  })).min(1).max(32),
  artifact: SignedLicenseCapacitySchema,
});
export const LicenseCapacityProvisionSchema=Provision;

/** Installer-owned public trust and signed artifact only. No IPC can set this
 * file or supply keys. License trust is independent of SSA/SAS/DeviceTrust. */
export function readLicenseCapacityProvision(path: string) {
  if (!isAbsolute(path)) throw Error("LICENSE_MANAGED_ABSOLUTE_FILE_REQUIRED");
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 262144) throw Error("LICENSE_MANAGED_FILE_REJECTED");
  return parseLicenseCapacityProvision(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path))));
}
export function parseLicenseCapacityProvision(input:unknown){
  const p = Provision.parse(input);
  return {artifact:p.artifact,keys:parseLicenseCapacityKeys(p.keys)};
}
export function parseLicenseCapacityKeys(input:unknown){
  const records=Provision.shape.keys.parse(input);
  const keys = new Map<string, TrustedSigningKey>();
  for (const k of records) {
    const key = createPublicKey(k.public_key_pem);
    if (keys.has(k.key_id) || key.asymmetricKeyType !== "ed25519" ||
        createHash("sha256").update(key.export({ type: "spki", format: "der" })).digest("hex") !== k.spki_sha256)
      throw Error("LICENSE_MANAGED_TRUST_REJECTED");
    keys.set(k.key_id, { key, status: k.status });
  }
  return keys;
}

export type CashRegisterLicenseGate = (scope: SyncScope, registerId: string) => string | null;

/** Existing activation and append-only audit owners. Re-verifies signature/time
 * per operation. The high-water mark survives restart; no local slot allocation. */
export class LicenseCapacityGate {
  constructor(private readonly database: LocalDatabase,
    private readonly load: () => { artifact: unknown; keys: ReadonlyMap<string, TrustedSigningKey> },
    private readonly now: () => Date = () => new Date()) {}

  authorize(scope: SyncScope, registerId: string): string | null {
    try {
      const { artifact, keys } = this.load();
      const verifier = new LicenseVerifier(keys, new TrustedClockGuard(this.database), this.now);
      // No inferred network/grace policy: current validity is mandatory here.
      const result = verifier.verifyCapacity(artifact, scope, true);
      const c = result.claims;
      if (result.decision !== "VALID" || !c) return `LICENSE_${result.decision}`;
      if (c.tenant_id !== scope.tenantId || c.company_id !== scope.companyId) return "LICENSE_SCOPE_MISMATCH";
      if(this.database.native.prepare("SELECT 1 FROM local_security_audit WHERE event_type='LICENSE_CAPACITY_REVOCATION_ACCEPTED' AND subject_id=? LIMIT 1").get(c.license_id))return "LICENSE_REVOKED";
      if (!c.cash_register_capacity.allocations.some(a => a.register_id === registerId && a.branch_id === scope.branchId))
        return "LICENSE_REGISTER_NOT_ALLOCATED";
      const digest = createHash("sha256").update(canonicalJson(c)).digest("hex");
      const lifecycle = new LocalSecurityLifecycle(this.database, this.now);
      return this.database.native.transaction(() => {
        const row = this.database.native.prepare(`SELECT details_json FROM local_security_audit
          WHERE event_type='LICENSE_CAPACITY_ACCEPTED' AND subject_id=? ORDER BY sequence DESC LIMIT 1`).get(scope.installationId) as { details_json: string } | undefined;
        const previous = row ? JSON.parse(row.details_json) as { license_id: string; version: number; digest: string } : undefined;
        if (previous && (previous.license_id !== c.license_id || previous.version > c.license_version ||
            (previous.version === c.license_version && previous.digest !== digest))) return "LICENSE_ROLLBACK_OR_CONFLICT";
        const activation = this.database.native.prepare("SELECT status FROM local_license_activation_state WHERE license_id=?").get(c.license_id) as {status:string} | undefined;
        // A renewed artifact never silently clears administrative suspension/revocation.
        if (activation && activation.status !== "ACTIVE") return `LICENSE_${activation.status}`;
        if (!activation) lifecycle.activateLicense(result);
        const decision = lifecycle.capabilityDecision("CASH_REGISTER", result);
        if (decision !== "ALLOW") throw Error(`LICENSE_${decision}`);
        if (!previous || previous.version < c.license_version) {
          this.database.native.prepare(`INSERT INTO local_security_audit(event_type,subject_id,details_json,created_at)
            VALUES ('LICENSE_CAPACITY_ACCEPTED',?,?,?)`).run(scope.installationId,
            JSON.stringify({ license_id: c.license_id, version: c.license_version, digest }), result.evaluatedAt);
        }
        return null;
      }).immediate();
    } catch {
      return "LICENSE_CAPACITY_UNAVAILABLE";
    }
  }
}
