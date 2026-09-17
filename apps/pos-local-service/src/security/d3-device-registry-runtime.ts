import { createHash, randomBytes, sign, type KeyObject } from "node:crypto";
import {
  DeviceTrustCredentialClaimsSchema,
  DeviceTrustKeyPurposeSchema,
  SignedDeviceTrustCredentialSchema,
  uuidV7FromModule,
} from "@pos-platform/contracts";
import { canonicalJson } from "@pos-platform/local-channel";

export type DeviceRegistryStatus = "PENDING" | "ACTIVE" | "REVOKED" | "COMPROMISED" | "RETIRED";

export type DeviceRegistryRow = {
  device_id: string;
  installation_id: string;
  tenant_id: string;
  company_id: string;
  device_key_id: string;
  device_public_key: string;
  status: DeviceRegistryStatus;
  trust_key_id: string;
  trust_key_purpose: "DEVICE_TRUST";
};

export type DeviceCredentialIssue = {
  signedCredential: ReturnType<typeof SignedDeviceTrustCredentialSchema.parse>;
  activationId: string;
  activationSecretChecksum: string;
};

export interface DeviceRegistryRepository {
  findDevice(deviceId: string): Promise<DeviceRegistryRow | null>;
  /** Atomically consumes the one-shot activation and persists the exact signed credential. */
  consumeActivationAndIssueCredential(input: {
    activationId: string;
    activationSecretChecksum: string;
    credential: DeviceCredentialIssue;
  }): Promise<boolean>;
}

export function activationSecretChecksum(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function credentialChecksum(credential: DeviceCredentialIssue["signedCredential"]): string {
  return createHash("sha256")
    .update(canonicalJson(credential))
    .digest("hex");
}

export class DeviceRegistryEnrollmentRuntime {
  constructor(private readonly repository: DeviceRegistryRepository) {}

  async issue(input: {
    activation_id: string;
    activation_secret: string;
    device_id: string;
    issued_at: string;
    expires_at: string;
    issuer_private_key: KeyObject;
  }): Promise<string> {
    const device = await this.repository.findDevice(input.device_id);
    if (!device) throw new Error("DEVICE_UNKNOWN");
    if (device.status !== "PENDING" && device.status !== "ACTIVE") throw new Error(`DEVICE_${device.status}`);
    if (device.trust_key_purpose !== "DEVICE_TRUST") throw new Error("DEVICE_WRONG_PURPOSE");
    DeviceTrustKeyPurposeSchema.parse(device.trust_key_purpose);

    const credentialClaims = DeviceTrustCredentialClaimsSchema.parse({
      credential_id: uuidV7FromModule(),
      key_id: device.trust_key_id,
      tenant_id: device.tenant_id,
      company_id: device.company_id,
      installation_id: device.installation_id,
      device_id: device.device_id,
      device_public_key_pem: device.device_public_key,
      issued_at: input.issued_at,
      not_before: input.issued_at,
      expires_at: input.expires_at,
      version: 1,
    });

    const signedCredential = SignedDeviceTrustCredentialSchema.parse({
      claims: credentialClaims,
      signature: sign(
        null,
        Buffer.from(canonicalJson(credentialClaims)),
        input.issuer_private_key,
      ).toString("base64url"),
    });

    const committed = await this.repository.consumeActivationAndIssueCredential({
      activationId: input.activation_id,
      activationSecretChecksum: activationSecretChecksum(input.activation_secret),
      credential: {
        signedCredential,
        activationId: input.activation_id,
        activationSecretChecksum: activationSecretChecksum(input.activation_secret),
      },
    });

    if (!committed) throw new Error("ACTIVATION_NOT_CONSUMABLE");
    return signedCredential.claims.credential_id;
  }

  createChallenge(): string {
    return randomBytes(32).toString("base64url");
  }
}
