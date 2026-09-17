import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  SessionAssertionOperationalKeyClaimsSchema,
  SessionAssertionTrustBundleSchema,
  unsignedSessionAssertionOperationalKeyBytes,
} from "@pos-platform/contracts";
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
});
