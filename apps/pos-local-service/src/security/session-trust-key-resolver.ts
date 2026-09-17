import type { TrustedSigningKey } from "./license-verifier.js";
import { SessionTrustKeyStore } from "./session-trust-key-store.js";
import { SessionTrustKeyVerifier } from "./session-trust-key-verifier.js";

export interface SessionTrustKeyResolution {
  readonly keys: ReadonlyMap<string, TrustedSigningKey>;
  readonly decision: "MISSING" | "INVALID" | "VALID";
  readonly reason?: string;
}

/**
 * Resolves the local, signed session-key artifact into the existing
 * `TrustedSigningKey` map consumed by the SSA verifier.
 *
 * Missing or invalid trust material returns an empty map. This preserves the
 * existing fail-closed session boundary without making unrelated local POS
 * startup depend on session trust being provisioned.
 */
export class SessionTrustKeyResolver {
  constructor(
    private readonly store: SessionTrustKeyStore,
    private readonly verifier: SessionTrustKeyVerifier,
  ) {}

  resolve(): SessionTrustKeyResolution {
    if (!this.store.has()) return { keys: new Map(), decision: "MISSING" };

    try {
      const artifact = this.store.load();
      const result = this.verifier.verify(artifact);
      if (result.decision !== "VALID" || result.claims === null) {
        return { keys: new Map(), decision: "INVALID", reason: result.decision };
      }
      const trusted = this.verifier.toTrustedSigningKey(result.claims);
      return {
        keys: new Map([[result.claims.key_id, trusted]]),
        decision: "VALID",
      };
    } catch (error) {
      return {
        keys: new Map(),
        decision: "INVALID",
        reason: error instanceof Error ? error.message : "invalid session trust artifact",
      };
    }
  }
}
