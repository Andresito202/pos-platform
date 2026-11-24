import { createHash, createPublicKey } from "node:crypto";
import { lstatSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import * as z from "zod";
import { SignedLicenseCapacitySchema } from "@pos-platform/contracts";
import type { LocalDatabase } from "@pos-platform/database-sqlite";
import type { SyncScope } from "../sync/durable-sync-store.js";
import { canonicalJson } from "../channel/canonical-json.js";
import { LicenseVerifier, type TrustedSigningKey } from "./license-verifier.js";
import { LocalSecurityLifecycle } from "./security-lifecycle.js";
import { TrustedClockGuard } from "./trusted-clock.js";

/** Survives SQLite wipe when stored outside the DB file (beside provision). */
export type LicenseCapacitySeal = {
  installation_id: string;
  license_id: string;
  version: number;
  digest: string;
};

export interface LicenseCapacitySealStore {
  read(): LicenseCapacitySeal | null;
  write(seal: LicenseCapacitySeal): void;
}

const SealSchema = z.strictObject({
  installation_id: z.string().min(1).max(128),
  license_id: z.string().min(1).max(128),
  version: z.number().int().positive(),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
});

/** Absolute file seal outside `pos-local.db` so truncating SQLite alone cannot reset capacity. */
export function fileLicenseCapacitySealStore(absolutePath: string): LicenseCapacitySealStore {
  const path = resolve(absolutePath);
  if (!isAbsolute(path)) throw Error("LICENSE_SEAL_ABSOLUTE_PATH_REQUIRED");
  return {
    read() {
      if (!existsSync(path)) return null;
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) return null;
      try {
        return SealSchema.parse(JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path)),
        ));
      } catch {
        return null;
      }
    },
    write(seal) {
      const parsed = SealSchema.parse(seal);
      writeFileSync(path, `${JSON.stringify(parsed)}\n`, { mode: 0o600 });
    },
  };
}

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
/** Sector/module entitlement check against the same signed capacity artifact. */
export type SectorLicenseGate = (scope: SyncScope, entitlement: string) => string | null;
export interface OperationalLicenseInformation {
  status:"UNVERIFIED"|"CURRENT"|"EXPIRED"|"SUSPENDED"|"REVOKED";
  signedValidUntil:string|null;lastAcceptedLocalCheck:string|null;evaluatedAt:string|null;
}

/** Existing activation and append-only audit owners. Re-verifies signature/time
 * per operation. The high-water mark survives restart; no local slot allocation. */
export class LicenseCapacityGate {
  constructor(private readonly database: LocalDatabase,
    private readonly load: () => { artifact: unknown; keys: ReadonlyMap<string, TrustedSigningKey> },
    private readonly now: () => Date = () => new Date(),
    private readonly seal: LicenseCapacitySealStore | null = null) {}

  /** Read model only: does not activate a license, accept a new version, renew,
   * authorize a sale, contact a provider or infer offline/subscription grace.
   * Only a locally accepted, still authentic artifact can inform this view. */
  information(scope:SyncScope):OperationalLicenseInformation{
    const unknown:OperationalLicenseInformation={status:"UNVERIFIED",signedValidUntil:null,lastAcceptedLocalCheck:null,evaluatedAt:null};
    try{
      const {artifact,keys}=this.load(),result=new LicenseVerifier(keys,new TrustedClockGuard(this.database),this.now).verifyCapacity(artifact,scope,true),c=result.claims;
      if(!c||!["VALID","EXPIRED"].includes(result.decision)||c.tenant_id!==scope.tenantId||c.company_id!==scope.companyId)return unknown;
      const accepted=this.database.native.prepare(`SELECT details_json,created_at FROM local_security_audit
        WHERE event_type='LICENSE_CAPACITY_ACCEPTED' AND subject_id=? ORDER BY sequence DESC LIMIT 1`).get(scope.installationId) as {details_json:string;created_at:string}|undefined;
      if(!accepted)return unknown;
      const previous=JSON.parse(accepted.details_json),digest=createHash("sha256").update(canonicalJson(c)).digest("hex");
      if(previous.license_id!==c.license_id||previous.version!==c.license_version||previous.digest!==digest)return unknown;
      const activation=this.database.native.prepare('SELECT status FROM local_license_activation_state WHERE license_id=?').get(c.license_id) as {status:string}|undefined;
      const revoked=this.database.native.prepare("SELECT 1 FROM local_security_audit WHERE event_type='LICENSE_CAPACITY_REVOCATION_ACCEPTED' AND subject_id=? LIMIT 1").get(c.license_id);
      const status=revoked||activation?.status==='REVOKED'?'REVOKED':activation?.status==='SUSPENDED'?'SUSPENDED':activation?.status==='ACTIVE'?result.decision==='EXPIRED'?'EXPIRED':'CURRENT':'UNVERIFIED';
      return {status,signedValidUntil:c.expires_at,lastAcceptedLocalCheck:accepted.created_at,evaluatedAt:result.evaluatedAt};
    }catch{return unknown;}
  }

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
        const wipe = this.detectWipeRecoveryRequired(scope.installationId, previous);
        if (wipe) return wipe;
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
        this.persistSeal(scope.installationId, c.license_id, c.license_version, digest);
        return null;
      }).immediate();
    } catch {
      return "LICENSE_CAPACITY_UNAVAILABLE";
    }
  }

  /**
   * Authorize a contracted sector/module entitlement for this company scope.
   * Same signed artifact and activation rules as cash register; no local
   * entitlement editing — missing codes fail closed.
   */
  authorizeEntitlement(scope: SyncScope, entitlement: string): string | null {
    try {
      const { artifact, keys } = this.load();
      const verifier = new LicenseVerifier(keys, new TrustedClockGuard(this.database), this.now);
      const result = verifier.verifyCapacity(artifact, scope, true);
      const c = result.claims;
      if (result.decision !== "VALID" || !c) return `LICENSE_${result.decision}`;
      if (c.tenant_id !== scope.tenantId || c.company_id !== scope.companyId) return "LICENSE_SCOPE_MISMATCH";
      if (this.database.native.prepare(
        "SELECT 1 FROM local_security_audit WHERE event_type='LICENSE_CAPACITY_REVOCATION_ACCEPTED' AND subject_id=? LIMIT 1",
      ).get(c.license_id)) return "LICENSE_REVOKED";
      const digest = createHash("sha256").update(canonicalJson(c)).digest("hex");
      const lifecycle = new LocalSecurityLifecycle(this.database, this.now);
      return this.database.native.transaction(() => {
        const row = this.database.native.prepare(`SELECT details_json FROM local_security_audit
          WHERE event_type='LICENSE_CAPACITY_ACCEPTED' AND subject_id=? ORDER BY sequence DESC LIMIT 1`)
          .get(scope.installationId) as { details_json: string } | undefined;
        const previous = row
          ? JSON.parse(row.details_json) as { license_id: string; version: number; digest: string }
          : undefined;
        const wipe = this.detectWipeRecoveryRequired(scope.installationId, previous);
        if (wipe) return wipe;
        if (previous && (previous.license_id !== c.license_id || previous.version > c.license_version ||
            (previous.version === c.license_version && previous.digest !== digest))) {
          return "LICENSE_ROLLBACK_OR_CONFLICT";
        }
        const activation = this.database.native.prepare(
          "SELECT status FROM local_license_activation_state WHERE license_id=?",
        ).get(c.license_id) as { status: string } | undefined;
        if (activation && activation.status !== "ACTIVE") return `LICENSE_${activation.status}`;
        if (!activation) lifecycle.activateLicense(result);
        const decision = lifecycle.capabilityDecision(entitlement, result);
        if (decision !== "ALLOW") return `LICENSE_${decision}`;
        if (!previous || previous.version < c.license_version) {
          this.database.native.prepare(`INSERT INTO local_security_audit(event_type,subject_id,details_json,created_at)
            VALUES ('LICENSE_CAPACITY_ACCEPTED',?,?,?)`).run(scope.installationId,
            JSON.stringify({ license_id: c.license_id, version: c.license_version, digest }),
            result.evaluatedAt);
        }
        this.persistSeal(scope.installationId, c.license_id, c.license_version, digest);
        return null;
      }).immediate();
    } catch {
      return "LICENSE_CAPACITY_UNAVAILABLE";
    }
  }

  /**
   * Seal outside SQLite: empty audit + existing seal ⇒ wipe/reinstall abuse.
   * Recovery requires Central re-provision (physical/ops path), not silent re-accept.
   */
  private detectWipeRecoveryRequired(
    installationId: string,
    previous: { license_id: string; version: number; digest: string } | undefined,
  ): string | null {
    if (previous || !this.seal) return null;
    const sealed = this.seal.read();
    if (!sealed) return null;
    // Seal outside SQLite survived a DB wipe: refuse silent first-accept (trial/capacity reset).
    if (sealed.installation_id !== installationId) return "LICENSE_WIPE_RECOVERY_REQUIRED";
    return "LICENSE_WIPE_RECOVERY_REQUIRED";
  }

  private persistSeal(
    installationId: string,
    licenseId: string,
    version: number,
    digest: string,
  ): void {
    if (!this.seal) return;
    this.seal.write({
      installation_id: installationId,
      license_id: licenseId,
      version,
      digest,
    });
  }

  /** Read-model projection of signed entitlements for navigation. Never authorizes. */
  listEntitlements(scope: SyncScope): readonly string[] {
    try {
      const { artifact, keys } = this.load();
      const result = new LicenseVerifier(keys, new TrustedClockGuard(this.database), this.now)
        .verifyCapacity(artifact, scope, true);
      const c = result.claims;
      if (!c || !["VALID", "EXPIRED"].includes(result.decision)) return [];
      if (c.tenant_id !== scope.tenantId || c.company_id !== scope.companyId) return [];
      const accepted = this.database.native.prepare(`SELECT details_json FROM local_security_audit
        WHERE event_type='LICENSE_CAPACITY_ACCEPTED' AND subject_id=? ORDER BY sequence DESC LIMIT 1`)
        .get(scope.installationId) as { details_json: string } | undefined;
      if (!accepted) return [];
      const previous = JSON.parse(accepted.details_json) as { license_id: string; version: number; digest: string };
      const digest = createHash("sha256").update(canonicalJson(c)).digest("hex");
      if (previous.license_id !== c.license_id || previous.version !== c.license_version || previous.digest !== digest) {
        return [];
      }
      if (this.database.native.prepare(
        "SELECT 1 FROM local_security_audit WHERE event_type='LICENSE_CAPACITY_REVOCATION_ACCEPTED' AND subject_id=? LIMIT 1",
      ).get(c.license_id)) return [];
      const activation = this.database.native.prepare(
        "SELECT status FROM local_license_activation_state WHERE license_id=?",
      ).get(c.license_id) as { status: string } | undefined;
      if (!activation || activation.status !== "ACTIVE") return [];
      return c.entitlements;
    } catch {
      return [];
    }
  }
}
