import { createHash, randomBytes, verify } from "node:crypto";
import {
  DeviceAuthenticationRequestSchema,
  DeviceCredentialSchema,
  type DeviceAuthenticationRequest,
  type DeviceCredential,
} from "@pos-platform/contracts";
import { canonicalJson } from "@pos-platform/local-channel";

export type DeviceRegistryRecord = {
  credential: DeviceCredential;
  device_public_key: string;
};

export interface DeviceRegistry {
  getCredential(credentialId: string): Promise<DeviceRegistryRecord | null>;
}

export interface DeviceRegistryClock {
  now(): Date;
}

export class DeviceRegistryAuthenticator {
  constructor(private readonly registry: DeviceRegistry, private readonly clock: DeviceRegistryClock) {}

  async authenticate(input: DeviceAuthenticationRequest): Promise<void> {
    const request = DeviceAuthenticationRequestSchema.parse(input);
    const record = await this.registry.getCredential(request.credential_id);
    if (!record) throw new Error("DEVICE_CREDENTIAL_UNKNOWN");

    const credential = DeviceCredentialSchema.parse(record.credential);
    if (credential.status !== "ACTIVE") throw new Error(`DEVICE_CREDENTIAL_${credential.status}`);
    if (credential.key_purpose !== "DEVICE_TRUST") throw new Error("DEVICE_CREDENTIAL_WRONG_PURPOSE");
    if (credential.device_id !== request.device_id || credential.installation_id !== request.installation_id) {
      throw new Error("DEVICE_BINDING_MISMATCH");
    }
    if (credential.tenant_id !== request.tenant_id || credential.company_id !== request.company_id) {
      throw new Error("DEVICE_SCOPE_MISMATCH");
    }

    const now = this.clock.now();
    if (now.toISOString() < credential.issued_at || now.toISOString() >= credential.expires_at) {
      throw new Error("DEVICE_CREDENTIAL_EXPIRED");
    }

    const challengeDigest = createHash("sha256")
      .update(canonicalJson({
        challenge: request.challenge,
        credential_id: request.credential_id,
        device_id: request.device_id,
        installation_id: request.installation_id,
        tenant_id: request.tenant_id,
        company_id: request.company_id,
      }))
      .digest("hex");

    const signature = Buffer.from(request.proof_signature, "base64url");
    const publicKey = Buffer.from(record.device_public_key, "base64url");
    if (publicKey.length !== 32 || signature.length === 0) throw new Error("DEVICE_PROOF_MALFORMED");

    const keyObject = {
      key: Buffer.concat([
        Buffer.from("302a300506032b6570032100", "hex"),
        publicKey,
      ]),
      format: "der" as const,
      type: "spki" as const,
    };
    if (!verify(null, Buffer.from(challengeDigest, "utf8"), keyObject, signature)) {
      throw new Error("DEVICE_PROOF_INVALID");
    }
  }

  static createChallenge(): string {
    return randomBytes(32).toString("base64url");
  }
}
