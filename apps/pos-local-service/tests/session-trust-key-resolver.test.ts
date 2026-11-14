import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SessionAssertionOperationalKeyClaimsSchema,
  SessionAssertionTrustBundleSchema,
  unsignedSessionAssertionOperationalKeyBytes,
} from "@pos-platform/contracts";
import { EncryptedFileSecretStore, InsecureDerivedKeyProvider, SessionTrustKeyStore } from "../src/security/index.js";
import { SessionTrustKeyResolver } from "../src/security/session-trust-key-resolver.js";
import { SessionTrustKeyVerifier } from "../src/security/session-trust-key-verifier.js";

const NOW = new Date("2026-09-17T12:00:00.000Z");

function signedKey(root: ReturnType<typeof generateKeyPairSync>, keyId: string, status: "ACTIVE" | "VERIFY_ONLY" | "REVOKED") {
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

describe("SessionTrustKeyResolver", () => {
  it("keeps ACTIVE and VERIFY_ONLY keys during rotation and removes REVOKED keys", () => {
    const root = generateKeyPairSync("ed25519");
    const bundle = SessionAssertionTrustBundleSchema.parse({
      version: 2,
      keys: [
        signedKey(root, "ssa-2026-01", "VERIFY_ONLY"),
        signedKey(root, "ssa-2026-02", "ACTIVE"),
        signedKey(root, "ssa-2025-01", "REVOKED"),
      ],
    });
    const store = {
      has: () => true,
      load: () => bundle,
    } as never;
    const verifier = new SessionTrustKeyVerifier(root.publicKey, "production", () => NOW);
    const result = new SessionTrustKeyResolver(store, verifier).resolve();
    expect(result.decision).toBe("VALID");
    expect([...result.keys.keys()]).toEqual(["ssa-2026-01", "ssa-2026-02"]);
  });

  it("does not read the ambient artifact environment when the validated config path is absent", () => {
    const previous = process.env.POS_SESSION_TRUST_ARTIFACT_PATH;
    process.env.POS_SESSION_TRUST_ARTIFACT_PATH = "/path/that/must/not/be/read.json";
    try {
      const root = generateKeyPairSync("ed25519");
      const store = { has: () => false } as never;
      const verifier = new SessionTrustKeyVerifier(root.publicKey, "production", () => NOW);
      const result = new SessionTrustKeyResolver(store, verifier).resolve();
      expect(result).toEqual({ keys: new Map(), decision: "MISSING" });
    } finally {
      if (previous === undefined) delete process.env.POS_SESSION_TRUST_ARTIFACT_PATH;
      else process.env.POS_SESSION_TRUST_ARTIFACT_PATH = previous;
    }
  });
  it("installs a valid centrally fetched bundle into protected local persistence", () => {
    const root = generateKeyPairSync("ed25519");
    const temp = mkdtempSync(join(process.cwd(), ".session-trust-resolver-test-"));
    try {
      const store = new SessionTrustKeyStore(new EncryptedFileSecretStore(
        temp, new InsecureDerivedKeyProvider(temp), "session-trust-resolver-test",
      ));
      const verifier = new SessionTrustKeyVerifier(root.publicKey, "production", () => NOW);
      const bundle = SessionAssertionTrustBundleSchema.parse({
        version: 1,
        keys: [signedKey(root, "ssa-central-1", "ACTIVE")],
      });
      const result = new SessionTrustKeyResolver(store, verifier).resolveWithArtifact(bundle);
      expect(result.decision).toBe("VALID");
      expect([...result.keys.keys()]).toEqual(["ssa-central-1"]);
      expect(store.load().version).toBe(1);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it("rejects an invalid remote update and keeps a previously trusted bundle", () => {
    const root = generateKeyPairSync("ed25519");
    const temp = mkdtempSync(join(process.cwd(), ".session-trust-resolver-test-"));
    try {
      const store = new SessionTrustKeyStore(new EncryptedFileSecretStore(
        temp, new InsecureDerivedKeyProvider(temp), "session-trust-resolver-test",
      ));
      const verifier = new SessionTrustKeyVerifier(root.publicKey, "production", () => NOW);
      const trusted = SessionAssertionTrustBundleSchema.parse({
        version: 1,
        keys: [signedKey(root, "ssa-cached-1", "ACTIVE")],
      });
      store.install(trusted, verifier);
      const otherRoot = generateKeyPairSync("ed25519");
      const untrusted = SessionAssertionTrustBundleSchema.parse({
        version: 2,
        keys: [signedKey(otherRoot, "ssa-untrusted-2", "ACTIVE")],
      });

      const result = new SessionTrustKeyResolver(store, verifier).resolveWithArtifact(untrusted);
      expect(result.decision).toBe("VALID");
      expect([...result.keys.keys()]).toEqual(["ssa-cached-1"]);
      expect(store.load().version).toBe(1);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it("fails closed when the first remote bundle is not signed by the configured root", () => {
    const root = generateKeyPairSync("ed25519");
    const otherRoot = generateKeyPairSync("ed25519");
    const temp = mkdtempSync(join(process.cwd(), ".session-trust-resolver-test-"));
    try {
      const store = new SessionTrustKeyStore(new EncryptedFileSecretStore(
        temp, new InsecureDerivedKeyProvider(temp), "session-trust-resolver-test",
      ));
      const verifier = new SessionTrustKeyVerifier(root.publicKey, "production", () => NOW);
      const untrusted = SessionAssertionTrustBundleSchema.parse({
        version: 1,
        keys: [signedKey(otherRoot, "ssa-untrusted-1", "ACTIVE")],
      });
      const result = new SessionTrustKeyResolver(store, verifier).resolveWithArtifact(untrusted);
      expect(result.decision).toBe("INVALID");
      expect(result.keys.size).toBe(0);
      expect(store.has()).toBe(false);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it("falls back to a valid installer artifact when the first central bundle is not trusted", () => {
    const root = generateKeyPairSync("ed25519");
    const otherRoot = generateKeyPairSync("ed25519");
    const temp = mkdtempSync(join(process.cwd(), ".session-trust-resolver-test-"));
    try {
      const store = new SessionTrustKeyStore(new EncryptedFileSecretStore(
        temp, new InsecureDerivedKeyProvider(temp), "session-trust-resolver-test",
      ));
      const verifier = new SessionTrustKeyVerifier(root.publicKey, "production", () => NOW);
      const installerBundle = SessionAssertionTrustBundleSchema.parse({
        version: 1,
        keys: [signedKey(root, "ssa-installer", "ACTIVE")],
      });
      const untrustedRemoteBundle = SessionAssertionTrustBundleSchema.parse({
        version: 2,
        keys: [signedKey(otherRoot, "ssa-untrusted-remote", "ACTIVE")],
      });
      const installerPath = join(temp, "session-trust-installer.json");
      writeFileSync(installerPath, JSON.stringify(installerBundle), { flag: "wx", mode: 0o600 });

      const result = new SessionTrustKeyResolver(store, verifier, installerPath)
        .resolveWithArtifact(untrustedRemoteBundle);
      expect(result.decision).toBe("VALID");
      expect([...result.keys.keys()]).toEqual(["ssa-installer"]);
      expect(store.load().version).toBe(1);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

});
