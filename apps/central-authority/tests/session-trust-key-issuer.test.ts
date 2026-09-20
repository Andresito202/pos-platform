import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  unsignedSessionAssertionOperationalKeyBytes,
  type SessionAssertionOperationalKeyClaims,
} from "@pos-platform/contracts";
import { SessionTrustKeyIssuer } from "../src/session-trust-key-issuer.js";

describe("SessionTrustKeyIssuer", () => {
  it("issues a root-signed public operational-key artifact", () => {
    const issuerKeys = generateKeyPairSync("ed25519");
    const operationalKeys = generateKeyPairSync("ed25519");
    const claims: SessionAssertionOperationalKeyClaims = {
      key_id: "ssa-2026-01",
      key_purpose: "SESSION_ASSERTION",
      environment: "production",
      public_key_pem: operationalKeys.publicKey.export({ type: "spki", format: "pem" }) as string,
      status: "ACTIVE",
      valid_from: "2026-01-01T00:00:00.000Z",
      valid_until: null,
      version: 1,
    };

    const artifact = new SessionTrustKeyIssuer(issuerKeys.privateKey).issue(claims);

    expect(artifact.claims).toEqual(claims);
    expect(verify(
      null,
      unsignedSessionAssertionOperationalKeyBytes(artifact.claims),
      issuerKeys.publicKey,
      Buffer.from(artifact.signature, "base64url"),
    )).toBe(true);
  });
});
