import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";
import type { EncryptedFileSecretStore } from "./encrypted-secret-store.js";

export class DeviceIdentity {
  private constructor(private readonly privateKey: KeyObject) {}

  static create(store: EncryptedFileSecretStore, secretName = "device-identity"): DeviceIdentity {
    const pair = generateKeyPairSync("ed25519");
    const pem = pair.privateKey.export({ type: "pkcs8", format: "pem" });
    const bytes = Buffer.from(pem);
    try {
      store.write(secretName, bytes);
    } finally {
      bytes.fill(0);
    }
    return new DeviceIdentity(pair.privateKey);
  }

  static load(store: EncryptedFileSecretStore, secretName = "device-identity"): DeviceIdentity {
    const bytes = store.read(secretName);
    try {
      return new DeviceIdentity(createPrivateKey(bytes));
    } finally {
      bytes.fill(0);
    }
  }

  publicKeyPem(): string {
    return createPublicKey(this.privateKey).export({ type: "spki", format: "pem" }).toString();
  }

  deviceKeyId(): string {
    const der = createPublicKey(this.privateKey).export({ type: "spki", format: "der" });
    return `DEVICE_KEY_${createHash("sha256").update(der).digest("hex").toUpperCase()}`;
  }

  signChallenge(challenge: Buffer): Buffer {
    if (challenge.byteLength < 32 || challenge.byteLength > 1024) {
      throw new Error("device challenge size rejected");
    }
    return sign(null, challenge, this.privateKey);
  }
}
