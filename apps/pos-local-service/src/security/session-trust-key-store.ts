import {
  canonicalSessionTrustJson,
  SessionAssertionTrustBundleSchema,
  type SessionAssertionTrustBundle,
} from "@pos-platform/contracts";
import { EncryptedFileSecretStore } from "./encrypted-secret-store.js";
import { SessionTrustKeyVerifier } from "./session-trust-key-verifier.js";

const SECRET_NAME = "session-assertion-trust";

/** Protected local persistence for the signed public trust bundle. */
export class SessionTrustKeyStore {
  constructor(private readonly store: EncryptedFileSecretStore) {}

  has(): boolean {
    return this.store.has(SECRET_NAME);
  }

  load(): SessionAssertionTrustBundle {
    return SessionAssertionTrustBundleSchema.parse(
      JSON.parse(this.store.read(SECRET_NAME).toString("utf8")),
    );
  }

  /**
   * Installs a verified bundle monotonically. `version` is the trust-bundle
   * generation, not a schema version: newer generations may rotate/revoke
   * operational keys, while an older installer artifact can never roll the
   * protected local trust state backwards.
   */
  install(artifact: unknown, verifier: SessionTrustKeyVerifier): SessionAssertionTrustBundle {
    const parsed = SessionAssertionTrustBundleSchema.parse(artifact);
    for (const key of parsed.keys) {
      const result = verifier.verify(key);
      if (result.decision !== "VALID" && result.decision !== "REVOKED") {
        throw new Error(`session trust artifact rejected: ${result.decision}`);
      }
    }

    if (this.has()) {
      const current = this.load();
      if (parsed.version < current.version) return current;
      if (parsed.version === current.version) {
        if (canonicalSessionTrustJson(parsed) !== canonicalSessionTrustJson(current)) {
          throw new Error("SESSION_TRUST_BUNDLE_VERSION_CONFLICT");
        }
        return current;
      }
    }

    this.store.write(SECRET_NAME, Buffer.from(JSON.stringify(parsed), "utf8"));
    return parsed;
  }
}
