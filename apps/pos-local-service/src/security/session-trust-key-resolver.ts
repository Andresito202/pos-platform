import { readFileSync } from "node:fs";
import type { SessionTrustKeyPurpose } from "@pos-platform/contracts";
import type { TrustedSigningKey } from "./license-verifier.js";
import { SessionTrustKeyStore } from "./session-trust-key-store.js";
import { SessionTrustKeyVerifier } from "./session-trust-key-verifier.js";

/**
 * Una clave publicada, con el propósito al que pertenece — `D-31`.
 *
 * **La resolución devolvía `Map<key_id, TrustedSigningKey>` y ahí se perdía el
 * propósito.** Daba igual mientras el contrato sólo admitía uno: `main.ts`
 * escribía `"SESSION_ASSERTION"` a mano al provisionar. Desde que el bundle
 * publica una clave por propósito, ese dato es lo que decide en qué ancla
 * entra cada clave, así que tiene que sobrevivir al viaje.
 *
 * Es una lista y no un mapa anidado porque se corresponde una a una con las
 * filas de `local_trust_anchor`, cuya clave primaria es `(purpose, key_id)`.
 */
export interface TrustedKeyPublication {
  readonly purpose: SessionTrustKeyPurpose;
  readonly keyId: string;
  readonly trusted: TrustedSigningKey;
}

export interface SessionTrustKeyResolution {
  readonly keys: readonly TrustedKeyPublication[];
  readonly decision: "MISSING" | "INVALID" | "VALID";
  readonly reason?: string;
}

/**
 * Resolves a signed session-key bundle into the existing `TrustedSigningKey`
 * map consumed by the SSA verifier. The installer artifact is an authenticated
 * distribution source: newer generations update the protected local store;
 * older generations never roll it back.
 */
export class SessionTrustKeyResolver {
  constructor(
    private readonly store: SessionTrustKeyStore,
    private readonly verifier: SessionTrustKeyVerifier,
    private readonly installerArtifactPath?: string,
  ) {}

  resolve(): SessionTrustKeyResolution {
    try {
      if (this.installerArtifactPath !== undefined) {
        try {
          const artifact = JSON.parse(readFileSync(this.installerArtifactPath, "utf8"));
          this.store.install(artifact, this.verifier);
        } catch (error) {
          // An already trusted local bundle remains usable offline. A first
          // bootstrap with no protected copy cannot continue without a valid
          // installer artifact, so that case remains fail-closed.
          if (!this.store.has()) throw error;
        }
      }
      if (!this.store.has()) return { keys: [], decision: "MISSING" };

      const bundle = this.store.load();
      const keys: TrustedKeyPublication[] = [];
      for (const artifact of bundle.keys) {
        const result = this.verifier.verify(artifact);
        if (result.decision === "REVOKED") continue;
        if (result.decision !== "VALID" || result.claims === null) {
          return { keys: [], decision: "INVALID", reason: result.decision };
        }
        keys.push({
          purpose: result.claims.key_purpose,
          keyId: result.claims.key_id,
          trusted: this.verifier.toTrustedSigningKey(result.claims),
        });
      }
      if (keys.length === 0) {
        return { keys: [], decision: "INVALID", reason: "NO_VALID_SESSION_TRUST_KEYS" };
      }
      return { keys, decision: "VALID" };
    } catch (error) {
      return {
        keys: [],
        decision: "INVALID",
        reason: error instanceof Error ? error.message : "invalid session trust artifact",
      };
    }
  }
}
