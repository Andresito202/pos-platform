import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  SessionAssertionOperationalKeyClaimsSchema,
  unsignedSessionAssertionOperationalKeyBytes,
  type SessionAssertionClaims,
} from "@pos-platform/contracts";
import { SessionActivationService } from "../src/session/session-activation.js";
import { SessionAssertionVerifier, unsignedSessionAssertionBytes } from "../src/security/session-assertion-verifier.js";
import { SessionTrustKeyVerifier } from "../src/security/session-trust-key-verifier.js";

describe("G1.2 session bootstrap runtime boundary", () => {
  it("activates, recovers and rejects replay after restart against the provisioned trust key", () => {
    const root = generateKeyPairSync("ed25519");
    const operational = generateKeyPairSync("ed25519");
    const now = new Date("2026-09-17T12:00:00.000Z");
    const claims = SessionAssertionOperationalKeyClaimsSchema.parse({
      key_id: "ssa-runtime-01",
      key_purpose: "SESSION_ASSERTION",
      environment: "production",
      public_key_pem: operational.publicKey.export({ type: "spki", format: "pem" }),
      status: "ACTIVE",
      valid_from: "2026-01-01T00:00:00.000Z",
      valid_until: null,
      version: 1,
    });
    const operationalArtifact = {
      claims,
      signature: sign(null, unsignedSessionAssertionOperationalKeyBytes(claims), root.privateKey).toString("base64url"),
    };
    const trustVerifier = new SessionTrustKeyVerifier(root.publicKey, "production", () => now);
    const trustResult = trustVerifier.verify(operationalArtifact);
    expect(trustResult.decision).toBe("VALID");

    const binding = {
      userId: "018f0000-0000-7000-8000-0000000000a1",
      installationId: "018f0000-0000-7000-8000-0000000000a2",
      deviceId: "018f0000-0000-7000-8000-0000000000a3",
    };
    const ssaClaims: SessionAssertionClaims = {
      session_id: "018f0000-0000-7000-8000-0000000000b0",
      user_id: binding.userId,
      tenant_membership_id: "018f0000-0000-7000-8000-0000000000b1",
      installation_id: binding.installationId,
      device_id: binding.deviceId,
      issued_at: "2026-09-17T00:00:00.000Z",
      offline_valid_until: "2026-09-18T00:00:00.000Z",
      sequence: 1,
      key_id: claims.key_id,
    };
    const signedSsa = {
      claims: ssaClaims,
      signature: sign(null, unsignedSessionAssertionBytes(ssaClaims), operational.privateKey).toString("base64url"),
    };

    let stored: typeof signedSsa | null = null;
    const store = {
      highestAcceptedSequence: () => stored === null ? null : stored.claims.sequence,
      activate: (value: typeof signedSsa) => {
        if (stored !== null && value.claims.sequence <= stored.claims.sequence) {
          return { kind: "STALE_SEQUENCE" as const, currentSequence: stored.claims.sequence };
        }
        stored = value;
        return { kind: "ACTIVATED" as const, sequence: value.claims.sequence };
      },
      loadActive: () => stored === null ? null : { claims: stored.claims, signature: stored.signature },
    };

    const trustedSigningKey = trustVerifier.toTrustedSigningKey(claims);
    const verifier = new SessionAssertionVerifier(
      new Map([[claims.key_id, trustedSigningKey]]),
      { accept: () => undefined } as never,
      () => now,
    );
    const activation = new SessionActivationService(verifier, store as never);
    expect(activation.activate(signedSsa, binding)).toEqual({ kind: "ACTIVATED", sequence: 1 });
    expect(activation.recover(binding).kind).toBe("ACTIVE");
    expect(activation.activate(signedSsa, binding).kind).toBe("REJECTED");

    const revokedVerifier = new SessionAssertionVerifier(
      new Map([[claims.key_id, { ...trustedSigningKey, status: "REVOKED" as const }]]),
      { accept: () => undefined } as never,
      () => now,
    );
    expect(new SessionActivationService(revokedVerifier, store as never).activate({ ...signedSsa, claims: { ...signedSsa.claims, sequence: 2 } }, binding)).toEqual({
      kind: "REJECTED",
      decision: "SIGNING_KEY_REVOKED",
    });
  });
});
