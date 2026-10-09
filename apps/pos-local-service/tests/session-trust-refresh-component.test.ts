import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  SessionAssertionOperationalKeyClaimsSchema,
  SessionAssertionTrustBundleSchema,
  unsignedSessionAssertionOperationalKeyBytes,
} from "@pos-platform/contracts";
import {
  EncryptedFileSecretStore,
  InsecureDerivedKeyProvider,
  SessionTrustKeyResolver,
  SessionTrustKeyStore,
  SessionTrustKeyVerifier,
  SessionTrustRefreshComponent,
} from "../src/security/index.js";

const NOW = new Date("2026-10-09T12:00:00.000Z");

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

describe("SessionTrustRefreshComponent", () => {
  it("applies operational-key rotation and revocation to the live verifier map", async () => {
    const root = generateKeyPairSync("ed25519");
    const temp = mkdtempSync(join(process.cwd(), ".session-trust-refresh-test-"));
    try {
      const store = new SessionTrustKeyStore(new EncryptedFileSecretStore(
        temp, new InsecureDerivedKeyProvider(temp), "session-trust-refresh-test",
      ));
      const verifier = new SessionTrustKeyVerifier(root.publicKey, "production", () => NOW);
      const resolver = new SessionTrustKeyResolver(store, verifier);
      const v1 = SessionAssertionTrustBundleSchema.parse({
        version: 1,
        keys: [signedKey(root, "ssa-old", "ACTIVE")],
      });
      const v2 = SessionAssertionTrustBundleSchema.parse({
        version: 2,
        keys: [signedKey(root, "ssa-old", "VERIFY_ONLY"), signedKey(root, "ssa-new", "ACTIVE")],
      });
      const v3 = SessionAssertionTrustBundleSchema.parse({
        version: 3,
        keys: [signedKey(root, "ssa-old", "REVOKED"), signedKey(root, "ssa-new", "ACTIVE")],
      });
      store.install(v1, verifier);
      const liveKeys = new Map(resolver.resolve().keys);
      const bundles = [v2, v3];
      const fetchBundle = vi.fn(async () => {
        const next = bundles.shift();
        if (next === undefined) throw new Error("no test bundle remaining");
        return next;
      });
      const report = vi.fn();
      const component = new SessionTrustRefreshComponent(
        fetchBundle,
        (artifact) => resolver.resolveWithArtifact(artifact),
        liveKeys,
        report,
      );

      await component.refreshNow();
      expect([...liveKeys.keys()].sort()).toEqual(["ssa-new", "ssa-old"]);
      expect(store.load().version).toBe(2);

      await component.refreshNow();
      expect([...liveKeys.keys()]).toEqual(["ssa-new"]);
      expect(store.load().version).toBe(3);
      expect(report).toHaveBeenCalledWith("UPDATED", expect.objectContaining({ decision: "VALID", key_count: 1 }));
      await component.stop();
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it("retains the last verified keys when the central endpoint is temporarily unavailable", async () => {
    const root = generateKeyPairSync("ed25519");
    const temp = mkdtempSync(join(process.cwd(), ".session-trust-refresh-test-"));
    try {
      const store = new SessionTrustKeyStore(new EncryptedFileSecretStore(
        temp, new InsecureDerivedKeyProvider(temp), "session-trust-refresh-test",
      ));
      const verifier = new SessionTrustKeyVerifier(root.publicKey, "production", () => NOW);
      const resolver = new SessionTrustKeyResolver(store, verifier);
      store.install(SessionAssertionTrustBundleSchema.parse({
        version: 1,
        keys: [signedKey(root, "ssa-cached", "ACTIVE")],
      }), verifier);
      const liveKeys = new Map(resolver.resolve().keys);
      const report = vi.fn();
      const component = new SessionTrustRefreshComponent(
        async () => { throw new Error("central unavailable"); },
        (artifact) => resolver.resolveWithArtifact(artifact),
        liveKeys,
        report,
      );

      await component.refreshNow();
      expect([...liveKeys.keys()]).toEqual(["ssa-cached"]);
      expect(report).toHaveBeenCalledWith("FAILED", expect.objectContaining({
        fallback: "retain_last_verified_trust",
      }));
      await component.stop();
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
