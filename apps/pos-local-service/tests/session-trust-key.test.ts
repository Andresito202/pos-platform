import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  SessionAssertionOperationalKeyClaimsSchema,
  unsignedSessionAssertionOperationalKeyBytes,
} from "@pos-platform/contracts";
import { SessionTrustKeyVerifier } from "../src/security/session-trust-key-verifier.js";

const NOW = new Date("2026-09-17T00:00:00.000Z");

type TestClaims = {
  key_id: string;
  key_purpose: "SESSION_ASSERTION";
  environment: string;
  public_key_pem: string;
  status: "ACTIVE" | "VERIFY_ONLY" | "REVOKED";
  valid_from: string;
  valid_until: string | null;
  version: number;
};

function baseClaims(): TestClaims {
  return {
    key_id: "ssa-2026-01",
    key_purpose: "SESSION_ASSERTION" as const,
    environment: "production",
    public_key_pem: "placeholder",
    status: "ACTIVE" as const,
    valid_from: "2026-01-01T00:00:00.000Z",
    valid_until: null,
    version: 1,
  };
}

function artifact(overrides: Partial<ReturnType<typeof baseClaims>> = {}) {
  const root = generateKeyPairSync("ed25519");
  const operational = generateKeyPairSync("ed25519");
  const claims = {
    ...baseClaims(),
    ...overrides,
    public_key_pem: operational.publicKey.export({ type: "spki", format: "pem" }) as string,
  };
  const parsed = SessionAssertionOperationalKeyClaimsSchema.parse(claims);
  return {
    root,
    artifact: {
      claims: parsed,
      signature: sign(null, unsignedSessionAssertionOperationalKeyBytes(parsed), root.privateKey).toString("base64url"),
    },
  };
}

describe("SessionTrustKeyVerifier", () => {
  it("accepts a root-signed SESSION_ASSERTION key for the expected environment", () => {
    const value = artifact();
    const check = new SessionTrustKeyVerifier(value.root.publicKey, "production", () => NOW).verify(value.artifact);
    expect(check.decision).toBe("VALID");
    expect(check.claims?.key_purpose).toBe("SESSION_ASSERTION");
  });

  it("rejects an environment mismatch", () => {
    const value = artifact({ environment: "staging" });
    const check = new SessionTrustKeyVerifier(value.root.publicKey, "production", () => NOW).verify(value.artifact);
    expect(check.decision).toBe("ENVIRONMENT_MISMATCH");
  });

  it("rejects revoked and expired keys", () => {
    const revoked = artifact({ status: "REVOKED" });
    expect(new SessionTrustKeyVerifier(revoked.root.publicKey, "production", () => NOW).verify(revoked.artifact).decision).toBe("REVOKED");

    const expired = artifact({ valid_until: "2026-09-17T00:00:00.000Z" });
    expect(new SessionTrustKeyVerifier(expired.root.publicKey, "production", () => NOW).verify(expired.artifact).decision).toBe("EXPIRED");
  });

  it("rejects a root signature that was made by another root", () => {
    const value = artifact();
    const otherRoot = generateKeyPairSync("ed25519");
    const signature = sign(null, unsignedSessionAssertionOperationalKeyBytes(value.artifact.claims), otherRoot.privateKey).toString("base64url");
    const check = new SessionTrustKeyVerifier(value.root.publicKey, "production", () => NOW).verify({
      ...value.artifact,
      signature,
    });
    expect(check.decision).toBe("ROOT_SIGNATURE_INVALID");
  });

  it("rejects malformed trust purpose instead of coercing it", () => {
    const value = artifact();
    expect(() => new SessionTrustKeyVerifier(value.root.publicKey, "production", () => NOW).verify({
      ...value.artifact,
      claims: { ...value.artifact.claims, key_purpose: "DEVICE_TRUST" },
    })).toThrow();
  });
});
