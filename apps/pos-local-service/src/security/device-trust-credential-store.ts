import type { SignedDeviceTrustCredential } from "@pos-platform/contracts";
import { SignedDeviceTrustCredentialSchema } from "@pos-platform/contracts";
import type { EncryptedFileSecretStore } from "./encrypted-secret-store.js";

const SECRET_NAME = "device-trust-credential";

export class DeviceTrustCredentialStore {
  constructor(private readonly secrets: EncryptedFileSecretStore) {}

  has(): boolean {
    return this.secrets.has(SECRET_NAME);
  }

  save(credentialInput: unknown): SignedDeviceTrustCredential {
    const credential = SignedDeviceTrustCredentialSchema.parse(credentialInput);
    const plaintext = Buffer.from(JSON.stringify(credential), "utf8");
    try {
      this.secrets.write(SECRET_NAME, plaintext);
    } finally {
      plaintext.fill(0);
    }
    return credential;
  }

  load(): SignedDeviceTrustCredential {
    const plaintext = this.secrets.read(SECRET_NAME);
    try {
      return SignedDeviceTrustCredentialSchema.parse(JSON.parse(plaintext.toString("utf8")));
    } finally {
      plaintext.fill(0);
    }
  }
}
