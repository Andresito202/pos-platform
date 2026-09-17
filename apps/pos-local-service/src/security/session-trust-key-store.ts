import {
  SignedSessionAssertionOperationalKeySchema,
  type SignedSessionAssertionOperationalKey,
} from "@pos-platform/contracts";
import { EncryptedFileSecretStore } from "./encrypted-secret-store.js";
import { SessionTrustKeyVerifier } from "./session-trust-key-verifier.js";

const SECRET_NAME = "session-assertion-trust";

/** Protected local persistence for the signed public trust artifact. */
export class SessionTrustKeyStore {
  constructor(private readonly store: EncryptedFileSecretStore) {}

  has(): boolean {
    return this.store.has(SECRET_NAME);
  }

  load(): SignedSessionAssertionOperationalKey {
    return SignedSessionAssertionOperationalKeySchema.parse(
      JSON.parse(this.store.read(SECRET_NAME).toString("utf8")),
    );
  }

  install(
    artifact: unknown,
    verifier: SessionTrustKeyVerifier,
  ): void {
    const parsed = SignedSessionAssertionOperationalKeySchema.parse(artifact);
    const result = verifier.verify(parsed);
    if (result.decision !== "VALID" || result.claims === null) {
      throw new Error(`session trust artifact rejected: ${result.decision}`);
    }
    this.store.write(SECRET_NAME, Buffer.from(JSON.stringify(parsed), "utf8"));
  }
}
