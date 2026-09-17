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
 * map consumed by the SSA verifier. The first install may seed the encrypted
 * local store from the public installer artifact; all subsequent starts use
 * the protected local copy.
 */
export class SessionTrustKeyResolver {
  constructor(
    private readonly store: SessionTrustKeyStore,
    private readonly verifier: SessionTrustKeyVerifier,
    private readonly installerArtifactPath = process.env.POS_SESSION_TRUST_ARTIFACT_PATH,
  ) {}

  resolve(): SessionTrustKeyResolution {
    try {
      if (!this.store.has() && this.installerArtifactPath !== undefined) {
        const artifact = JSON.parse(readFileSync(this.installerArtifactPath, "utf8"));
        this.store.install(artifact, this.verifier);
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
