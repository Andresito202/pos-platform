import { createHash, randomBytes, sign } from "node:crypto";
import { canonicalJson } from "@pos-platform/local-channel";
import { uuidV7FromModule } from "@pos-platform/contracts";

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
  credentialId: string;
  device: DeviceRegistryRow;
  activationId: string;
  generation: number;
  issuedAt: string;
  expiresAt: string;
  issuerSignature: string;
};

export interface DeviceRegistryRepository {
  findDevice(deviceId: string): Promise<DeviceRegistryRow | null>;
  /**
   * Atomically consumes the activation and persists the issued credential.
   * Implementations MUST execute both state transitions in one transaction.
   */
  consumeActivationAndIssueCredential(input: {
    activationId: string;
    requestChecksum: string;
    credential: DeviceCredentialIssue;
  }): Promise<boolean>;
}

export function enrollmentChecksum(input: unknown): string {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}

export class DeviceRegistryEnrollmentRuntime {
  constructor(private readonly repository: DeviceRegistryRepository) {}

  async issue(input: {
    activation_id: string;
    device_id: string;
    request_checksum: string;
    generation: number;
    issued_at: string;
    expires_at: string;
    issuer_private_key: Parameters<typeof sign>[2];
  }): Promise<string> {
    const device = await this.repository.findDevice(input.device_id);
    if (!device) throw new Error("DEVICE_UNKNOWN");
    if (device.status !== "PENDING" && device.status !== "ACTIVE") throw new Error(`DEVICE_${device.status}`);
    if (device.trust_key_purpose !== "DEVICE_TRUST") throw new Error("DEVICE_WRONG_PURPOSE");
    if (!Number.isInteger(input.generation) || input.generation < 1) throw new Error("INVALID_GENERATION");

    const credentialId = uuidV7FromModule();
    const credentialBody = {
      credential_id: credentialId,
      device_id: device.device_id,
      installation_id: device.installation_id,
      tenant_id: device.tenant_id,
      company_id: device.company_id,
      device_key_id: device.device_key_id,
      trust_key_id: device.trust_key_id,
      key_purpose: "DEVICE_TRUST" as const,
      generation: input.generation,
      issued_at: input.issued_at,
      expires_at: input.expires_at,
    };

    // Sign before consuming the one-shot activation. A signing failure must not
    // leave an activation irreversibly consumed without a credential.
    const issuerSignature = sign(
      null,
      Buffer.from(canonicalJson(credentialBody)),
      input.issuer_private_key,
    ).toString("base64url");

    const committed = await this.repository.consumeActivationAndIssueCredential({
      activationId: input.activation_id,
      requestChecksum: input.request_checksum,
      credential: {
        credentialId,
        device,
        activationId: input.activation_id,
        generation: input.generation,
        issuedAt: input.issued_at,
        expiresAt: input.expires_at,
        issuerSignature,
      },
    });

    if (!committed) throw new Error("ACTIVATION_NOT_CONSUMABLE");
    return credentialId;
  }

  createChallenge(): string {
    return randomBytes(32).toString("base64url");
  }
}
