import { createPublicKey, verify, type KeyObject } from "node:crypto";
import {
  SignedAuthorizationTrustCandidateSchema, unsignedAuthorizationTrustCandidateBytes, canonicalSessionTrustJson,
  type SignedAuthorizationTrustCandidate,
} from "@pos-platform/contracts";
import type { EncryptedFileSecretStore } from "./encrypted-secret-store.js";
import type { TrustedSigningKey } from "./license-verifier.js";
import type { TrustedClockGuard } from "./trusted-clock.js";
import { assertAuthorizationTrustSeparated } from "./authorization-trust-separation.js";

const SECRET = "authorization-trust-lab-candidate";
const rank = { ACTIVE: 0, VERIFY_ONLY: 1, REVOKED: 2 };
const material = (key: KeyObject) => key.export({ type: "spki", format: "der" }).toString("hex");

/** Single-writer Service owner. Synchronous read/check/atomic replace cannot
 * interleave within that owner. This is not a cross-process locking protocol.
 * OS-bound persistence protects the retained watermark, not administrator-led
 * restoration of an entire machine backup; the pinned bootstrap floor remains
 * an explicit input. Production root/floor distribution is still unapproved. */
export class AuthorizationTrustCandidateStore {
  constructor(
    private readonly secrets: EncryptedFileSecretStore,
    private readonly policy: {
      mode: "ISOLATED_VALIDATION"; issuer: string; authorityId: string;
      environment: "isolated-validation"; minimumGeneration: number; root: KeyObject;
    },
    private readonly sessionKeys: ReadonlyMap<string, TrustedSigningKey>,
    private readonly clock: TrustedClockGuard,
    private readonly now: () => Date,
  ) {
    if (policy.mode !== "ISOLATED_VALIDATION" || policy.environment !== "isolated-validation" ||
      !Number.isSafeInteger(policy.minimumGeneration) || policy.minimumGeneration < 1 ||
      policy.root.type !== "public" || policy.root.asymmetricKeyType !== "ed25519" || secrets.protection !== "OS_BOUND")
      throw Error("SAS_LAB_OS_BOUND_ROOT_POLICY_REQUIRED");
    // Freeze a private copy: changing a caller-owned policy cannot change trust.
    this.policy = Object.freeze({ ...policy });
  }

  private check(input: unknown, requireCurrent: boolean): SignedAuthorizationTrustCandidate {
    const bundle = SignedAuthorizationTrustCandidateSchema.parse(input), c = bundle.claims;
    // Authenticate the whole set BEFORE interpreting generation or revocation.
    if (!verify(null, unsignedAuthorizationTrustCandidateBytes(c), this.policy.root, Buffer.from(bundle.signature, "base64url")))
      throw Error("SAS_ROOT_SIGNATURE_INVALID");
    if (c.issuer !== this.policy.issuer || c.authority_id !== this.policy.authorityId ||
      c.environment !== this.policy.environment || c.generation < this.policy.minimumGeneration)
      throw Error("SAS_TRUST_BINDING_REJECTED");
    const now = this.now(); this.clock.accept(now);
    if (requireCurrent && (now.getTime() < Date.parse(c.valid_from) || now.getTime() >= Date.parse(c.valid_until)))
      throw Error("SAS_TRUST_WINDOW_REJECTED");
    const keys = new Map<string, TrustedSigningKey>(), materials = new Set<string>();
    for (const k of c.keys) {
      if (!k.public_key_pem.startsWith("-----BEGIN PUBLIC KEY-----")) throw Error("SAS_PUBLIC_KEY_REQUIRED");
      const key = createPublicKey(k.public_key_pem), bytes = material(key);
      if (materials.has(bytes)) throw Error("SAS_KEY_ALIAS_REJECTED");
      materials.add(bytes);
      keys.set(k.key_id, { key, status: k.status, validFrom: k.valid_from, validUntil: k.valid_until });
    }
    assertAuthorizationTrustSeparated(keys, this.sessionKeys);
    return bundle;
  }

  private load(requireCurrent: boolean): SignedAuthorizationTrustCandidate | null {
    return this.secrets.has(SECRET) ? this.check(JSON.parse(this.secrets.read(SECRET).toString("utf8")), requireCurrent) : null;
  }

  install(input: unknown): number {
    const next = this.check(input, true), old = this.load(false);
    if (old) {
      if (next.claims.generation < old.claims.generation) throw Error("SAS_GENERATION_ROLLBACK");
      if (next.claims.generation === old.claims.generation) {
        if (canonicalSessionTrustJson(next.claims) !== canonicalSessionTrustJson(old.claims)) throw Error("SAS_GENERATION_CONFLICT");
        return old.claims.generation;
      }
      if (Date.parse(next.claims.issued_at) < Date.parse(old.claims.issued_at)) throw Error("SAS_ISSUANCE_ROLLBACK");
      for (const previous of old.claims.keys) {
        const replacement = next.claims.keys.find(k => k.key_id === previous.key_id);
        if (!replacement || material(createPublicKey(replacement.public_key_pem)) !== material(createPublicKey(previous.public_key_pem)) ||
          replacement.version < previous.version || rank[replacement.status] < rank[previous.status] ||
          (previous.status === "REVOKED" && canonicalSessionTrustJson(replacement) !== canonicalSessionTrustJson(previous)) ||
          (replacement.version === previous.version && canonicalSessionTrustJson(replacement) !== canonicalSessionTrustJson(previous)))
          throw Error("SAS_KEY_HISTORY_REJECTED");
      }
    }
    // One protected envelope carries the signature, generation and tombstones.
    // No memory cache is changed if encryption/rename fails.
    this.secrets.write(SECRET, Buffer.from(JSON.stringify(next)));
    return next.claims.generation;
  }

  resolve(): ReadonlyMap<string, TrustedSigningKey> {
    try {
      const bundle = this.load(true);
      return new Map(bundle?.claims.keys.map(k => [k.key_id, {
        key: createPublicKey(k.public_key_pem), status: k.status,
        validFrom: new Date(Math.max(Date.parse(k.valid_from), Date.parse(bundle.claims.valid_from))).toISOString(),
        validUntil: new Date(Math.min(Date.parse(k.valid_until), Date.parse(bundle.claims.valid_until))).toISOString(),
      }]) ?? []);
    } catch { return new Map(); } // Corrupt/expired/untrusted persistence grants nothing.
  }

  /** Revalidates persisted root signature and clock at EVERY map read. */
  liveKeys(): ReadonlyMap<string, TrustedSigningKey> {
    const owner = this;
    return {
      get size() { return owner.resolve().size; },
      get: id => owner.resolve().get(id), has: id => owner.resolve().has(id),
      entries: () => owner.resolve().entries(), keys: () => owner.resolve().keys(), values: () => owner.resolve().values(),
      [Symbol.iterator]: () => owner.resolve()[Symbol.iterator](),
      forEach(callback, thisArg) { owner.resolve().forEach((value, key) => callback.call(thisArg, value, key, this)); },
    };
  }
}
