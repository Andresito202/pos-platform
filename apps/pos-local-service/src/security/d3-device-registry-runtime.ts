import { createHash, randomUUID, sign } from "node:crypto";
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

export interface DeviceRegistryRepository {
  findDevice(deviceId: string): Promise<DeviceRegistryRow | null>;
  consumeActivation(activationId: string, requestChecksum: string): Promise<boolean>;
  issueCredential(input: {
    device: DeviceRegistryRow;
    activationId: string;
    generation: number;
    issuedAt: string;
    expiresAt: string;
    issuerSignature: string;
  }): Promise<void>;
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

    const consumed = await this.repository.consumeActivation(input.activation_id, input.request_checksum);
    if (!consumed) throw new Error("ACTIVATION_NOT_CONSUMABLE");

    const credentialId = randomUUID();
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
    const issuerSignature = sign(null, Buffer.from(canonicalJson(credentialBody)), input.issuer_private_key).toString("base64url");
    await this.repository.issueCredential({ device, activationId: input.activation_id, generation: input.generation, issuedAt: input.issued_at, expiresAt: input.expires_at, issuerSignature });
    return credentialId;
  }
}
