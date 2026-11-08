import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SessionAssertionOperationalKeyClaimsSchema,
  SessionAssertionTrustBundleSchema,
  unsignedSessionAssertionOperationalKeyBytes,
} from "@pos-platform/contracts";
import { EncryptedFileSecretStore, InsecureDerivedKeyProvider, SessionTrustKeyStore, SessionTrustKeyVerifier } from "../src/security/index.js";

const NOW = new Date("2026-09-17T12:00:00.000Z");

function signedKey(
  root: ReturnType<typeof generateKeyPairSync>,
  keyId: string,
  status: "ACTIVE" | "VERIFY_ONLY" | "REVOKED",
) {
  const operational = generateKeyPairSync("ed25519");
  const claims = SessionAssertionOperationalKeyClaimsSchema.parse({
    key_id: keyId,
    key_purpose: "SESSION_ASSERTION",
    environment: "production",
    public_key_pem: operational.publicKey.export({ type: "spki", format: "pem" }),
    status,
    valid_from: "2026-01-01T00:00:00.000Z",
    valid_until: null,
    version: 1,
  });
  return {
    claims,
    signature: sign(null, unsignedSessionAssertionOperationalKeyBytes(claims), root.privateKey).toString("base64url"),
  };
}

describe("SessionTrustKeyStore", () => {
  it("does not persist an unauthenticated revocation over previously verified trust", () => {
    const root = generateKeyPairSync("ed25519");
    const temp = mkdtempSync(join(process.cwd(), ".session-trust-store-test-"));
    try {
      const encrypted = new EncryptedFileSecretStore(temp, new InsecureDerivedKeyProvider(temp), "revocation-test");
      const store = new SessionTrustKeyStore(encrypted);
      const verifier = new SessionTrustKeyVerifier(root.publicKey, "production", () => NOW);
      const active = signedKey(root, "ssa-valid", "ACTIVE");
      store.install({ version: 1, keys: [active] }, verifier);
      expect(() => store.install({ version: 2, keys: [{ ...active, claims: { ...active.claims, status: "REVOKED" } }] }, verifier))
        .toThrow("ROOT_SIGNATURE_INVALID");
      expect(store.load()).toEqual({ version: 1, keys: [active] });
      expect(new SessionTrustKeyStore(encrypted).load().keys[0]?.claims.status).toBe("ACTIVE");
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });
  it("accepts newer bundles, preserves older local state and rejects same-version conflicts", () => {
    const root = generateKeyPairSync("ed25519");
    const temp = mkdtempSync(join(process.cwd(), ".session-trust-store-test-"));
    try {
      const secretStore = new EncryptedFileSecretStore(
        temp,
        new InsecureDerivedKeyProvider(temp),
        "session-trust-store-test",
      );
      const store = new SessionTrustKeyStore(secretStore);
      const verifier = new SessionTrustKeyVerifier(root.publicKey, "production", () => NOW);
      const v1 = SessionAssertionTrustBundleSchema.parse({
        version: 1,
        keys: [signedKey(root, "ssa-2026-01", "ACTIVE")],
      });
      const v2 = SessionAssertionTrustBundleSchema.parse({
        version: 2,
        keys: [
          signedKey(root, "ssa-2026-01", "VERIFY_ONLY"),
          signedKey(root, "ssa-2026-02", "ACTIVE"),
        ],
      });
      const revokedV3 = SessionAssertionTrustBundleSchema.parse({
        version: 3,
        keys: [signedKey(root, "ssa-2026-01", "REVOKED")],
      });

      expect(store.install(v1, verifier).version).toBe(1);
      expect(store.install(v2, verifier).version).toBe(2);
      expect(store.install(v1, verifier).version).toBe(2);
      expect(store.install(revokedV3, verifier).version).toBe(3);
      expect(store.load().keys[0]?.claims.status).toBe("REVOKED");

      const conflictingV3 = SessionAssertionTrustBundleSchema.parse({
        version: 3,
        keys: [signedKey(root, "ssa-other", "ACTIVE")],
      });
      expect(() => store.install(conflictingV3, verifier)).toThrow("SESSION_TRUST_BUNDLE_VERSION_CONFLICT");
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
