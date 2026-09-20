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

function signedKey(
  root: ReturnType<typeof generateKeyPairSync>,
  keyId: string,
  status: "ACTIVE" | "VERIFY_ONLY" | "REVOKED",
  purpose: "SESSION_ASSERTION" | "AUTHORIZATION_SNAPSHOT" = "SESSION_ASSERTION",
) {
  const operational = generateKeyPairSync("ed25519");
  const claims = SessionAssertionOperationalKeyClaimsSchema.parse({
    key_id: keyId,
    key_purpose: purpose,
    environment: "PRODUCTION",
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
        signedKey(root, "SSA-2026-01", "VERIFY_ONLY"),
        signedKey(root, "SSA-2026-02", "ACTIVE"),
        signedKey(root, "SSA-2025-01", "REVOKED"),
      ],
    });
    const store = {
      has: () => true,
      load: () => bundle,
    } as never;
    const verifier = new SessionTrustKeyVerifier(root.publicKey, "PRODUCTION", () => NOW);
    const result = new SessionTrustKeyResolver(store, verifier).resolve();
    expect(result.decision).toBe("VALID");
    expect(result.keys.map((publication) => publication.keyId)).toEqual(["SSA-2026-01", "SSA-2026-02"]);
  });

  it("does not read the ambient artifact environment when the validated config path is absent", () => {
    const previous = process.env.POS_SESSION_TRUST_ARTIFACT_PATH;
    process.env.POS_SESSION_TRUST_ARTIFACT_PATH = "/path/that/must/not/be/read.json";
    try {
      const root = generateKeyPairSync("ed25519");
      const store = { has: () => false } as never;
      const verifier = new SessionTrustKeyVerifier(root.publicKey, "PRODUCTION", () => NOW);
      const result = new SessionTrustKeyResolver(store, verifier).resolve();
      expect(result).toEqual({ keys: [], decision: "MISSING" });
    } finally {
      if (previous === undefined) delete process.env.POS_SESSION_TRUST_ARTIFACT_PATH;
      else process.env.POS_SESSION_TRUST_ARTIFACT_PATH = previous;
    }
  });

  /**
   * `D-31`. La resolucion devolvia `Map<key_id, …>` y el proposito se perdia
   * ahi: `main.ts` escribia `"SESSION_ASSERTION"` a mano al provisionar, de
   * modo que el ancla de `AUTHORIZATION_SNAPSHOT` no tenia forma de poblarse y
   * `DEC-025` se detenia en su segundo sobre en **todo** arranque.
   *
   * Se afirma la correspondencia completa —que cada clave conserve SU
   * proposito— y no solo que aparezcan los dos: un mapeo cruzado tendria los
   * dos propositos presentes y mandaria cada clave al ancla equivocada.
   */
  it("conserva el proposito de cada clave publicada, que es lo que decide su ancla", () => {
    const root = generateKeyPairSync("ed25519");
    const bundle = SessionAssertionTrustBundleSchema.parse({
      version: 1,
      keys: [
        signedKey(root, "SSA-2026-01", "ACTIVE", "SESSION_ASSERTION"),
        signedKey(root, "SAS-2026-01", "ACTIVE", "AUTHORIZATION_SNAPSHOT"),
      ],
    });
    const store = { has: () => true, load: () => bundle } as never;
    const verifier = new SessionTrustKeyVerifier(root.publicKey, "PRODUCTION", () => NOW);
    const result = new SessionTrustKeyResolver(store, verifier).resolve();

    expect(result.decision).toBe("VALID");
    expect(result.keys.map(({ purpose, keyId }) => `${purpose}/${keyId}`)).toEqual([
      "SESSION_ASSERTION/SSA-2026-01",
      "AUTHORIZATION_SNAPSHOT/SAS-2026-01",
    ]);
  });
});
