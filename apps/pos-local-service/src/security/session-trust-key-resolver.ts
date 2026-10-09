import { readFileSync } from "node:fs";
import type { TrustedSigningKey } from "./license-verifier.js";
import { SessionTrustKeyStore } from "./session-trust-key-store.js";
import { SessionTrustKeyVerifier } from "./session-trust-key-verifier.js";

export interface SessionTrustKeyResolution {
  readonly keys: ReadonlyMap<string, TrustedSigningKey>;
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
    return this.resolveInternal(undefined, false);
  }

  /** Installs a freshly fetched artifact only after the store verifies its root signature. */
  resolveWithArtifact(artifact: unknown): SessionTrustKeyResolution {
    return this.resolveInternal(artifact, true);
  }

  private resolveInternal(remoteArtifact: unknown, hasRemoteArtifact: boolean): SessionTrustKeyResolution {
    try {
      if (hasRemoteArtifact) {
        try {
          this.store.install(remoteArtifact, this.verifier);
        } catch (error) {
          // A failed remote update must not discard a previously protected trust bundle.
          if (!this.store.has()) throw error;
        }
      }
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
      if (!this.store.has()) return { keys: new Map(), decision: "MISSING" };

      const bundle = this.store.load();
      const keys = new Map<string, TrustedSigningKey>();
      for (const artifact of bundle.keys) {
        const result = this.verifier.verify(artifact);
        if (result.decision === "REVOKED") continue;
        if (result.decision !== "VALID" || result.claims === null) {
          return { keys: new Map(), decision: "INVALID", reason: result.decision };
        }
        keys.set(result.claims.key_id, this.verifier.toTrustedSigningKey(result.claims));
      }
      if (keys.size === 0) {
        return { keys: new Map(), decision: "INVALID", reason: "NO_VALID_SESSION_TRUST_KEYS" };
      }
      return { keys, decision: "VALID" };
    } catch (error) {
      return {
        keys: new Map(),
        decision: "INVALID",
        reason: error instanceof Error ? error.message : "invalid session trust artifact",
      };
    }
  }
}
