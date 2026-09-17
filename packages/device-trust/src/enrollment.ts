import { createHash, createPublicKey, randomBytes, sign, verify, type KeyObject } from "node:crypto";
import {
  DeviceEnrollmentRequestSchema,
  DeviceTrustChallengeSchema,
  DeviceTrustCredentialClaimsSchema,
  DeviceTrustKeyPurposeSchema,
  SignedDeviceTrustCredentialSchema,
  uuidV7FromModule,
  type DeviceEnrollmentRequest,
  type DeviceTrustChallenge,
} from "@pos-platform/contracts";
import { canonicalDeviceTrustJson } from "./index.js";

export type CentralDeviceRegistryStatus = "PENDING" | "ACTIVE" | "REVOKED" | "COMPROMISED" | "RETIRED";

export type CentralDeviceRegistryRow = {
  device_id: string;
  installation_id: string;
  tenant_id: string;
  company_id: string;
  device_key_id: string;
  device_public_key: string;
  status: CentralDeviceRegistryStatus;
  trust_key_id: string;
  trust_key_purpose: "DEVICE_TRUST";
};

export interface CentralDeviceEnrollmentRepository {
  findDevice(deviceId: string): Promise<CentralDeviceRegistryRow | null>;
  /** Must atomically consume the activation and persist the exact signed credential. */
  consumeActivationAndIssueCredential(input: {
    activationId: string;
    activationSecretChecksum: string;
    credential: ReturnType<typeof SignedDeviceTrustCredentialSchema.parse>;
    credentialChecksum: string;
  }): Promise<boolean>;
}

export interface DeviceEnrollmentClock {
  now(): Date;
}

export function activationSecretChecksum(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function enrollmentCredentialChecksum(
  credential: ReturnType<typeof SignedDeviceTrustCredentialSchema.parse>,
): string {
  return createHash("sha256").update(canonicalDeviceTrustJson(credential)).digest("hex");
}

export function createEnrollmentChallenge(input: {
  tenant_id: string;
  installation_id: string;
  device_id: string;
  issued_at: string;
  expires_at: string;
}): DeviceTrustChallenge {
  return DeviceTrustChallengeSchema.parse({
    challenge_id: uuidV7FromModule(),
    tenant_id: input.tenant_id,
    installation_id: input.installation_id,
    device_id: input.device_id,
    nonce: randomBytes(32).toString("base64url"),
    issued_at: input.issued_at,
    expires_at: input.expires_at,
  });
}

export class CentralDeviceCredentialIssuer {
  constructor(
    private readonly repository: CentralDeviceEnrollmentRepository,
    private readonly issuerPrivateKey: KeyObject,
    private readonly clock: DeviceEnrollmentClock,
  ) {}

  async issue(input: {
    request: DeviceEnrollmentRequest;
    challenge: DeviceTrustChallenge;
    expires_at: string | null;
  }): Promise<string> {
    const request = DeviceEnrollmentRequestSchema.parse(input.request);
    const challenge = DeviceTrustChallengeSchema.parse(input.challenge);
    const now = this.clock.now();
    const nowMs = now.getTime();

    if (challenge.challenge_id !== request.challenge_id) throw new Error("ENROLLMENT_CHALLENGE_MISMATCH");
    if (challenge.tenant_id !== request.tenant_id || challenge.installation_id !== request.installation_id || challenge.device_id !== request.device_id) {
      throw new Error("ENROLLMENT_CHALLENGE_BINDING_MISMATCH");
    }
    if (nowMs < Date.parse(challenge.issued_at) || nowMs > Date.parse(challenge.expires_at)) {
      throw new Error("ENROLLMENT_CHALLENGE_EXPIRED");
    }

    const device = await this.repository.findDevice(request.device_id);
    if (!device) throw new Error("DEVICE_UNKNOWN");
    if (device.status !== "PENDING" && device.status !== "ACTIVE") throw new Error(`DEVICE_${device.status}`);
    DeviceTrustKeyPurposeSchema.parse(device.trust_key_purpose);
    if (device.device_key_id !== request.device_key_id) throw new Error("DEVICE_KEY_ID_MISMATCH");
    if (device.device_public_key !== request.device_public_key_pem) throw new Error("DEVICE_PUBLIC_KEY_MISMATCH");

    const devicePublicKey = createPublicKey(device.device_public_key);
    const proofValid = verify(
      null,
      Buffer.from(canonicalDeviceTrustJson(challenge)),
      devicePublicKey,
      Buffer.from(request.proof.signature, "base64url"),
    );
    if (!proofValid) throw new Error("ENROLLMENT_PROOF_INVALID");

    const credentialClaims = DeviceTrustCredentialClaimsSchema.parse({
      credential_id: uuidV7FromModule(),
      key_id: device.trust_key_id,
      tenant_id: device.tenant_id,
      company_id: device.company_id,
      installation_id: device.installation_id,
      device_id: device.device_id,
      device_public_key_pem: device.device_public_key,
      issued_at: now.toISOString(),
      not_before: now.toISOString(),
      expires_at: input.expires_at,
      version: 1,
    });

    const signedCredential = SignedDeviceTrustCredentialSchema.parse({
      claims: credentialClaims,
      signature: sign(
        null,
        Buffer.from(canonicalDeviceTrustJson(credentialClaims)),
        this.issuerPrivateKey,
      ).toString("base64url"),
    });

    const committed = await this.repository.consumeActivationAndIssueCredential({
      activationId: request.activation_id,
      activationSecretChecksum: activationSecretChecksum(request.activation_secret),
      credential: signedCredential,
      credentialChecksum: enrollmentCredentialChecksum(signedCredential),
    });

    if (!committed) throw new Error("ACTIVATION_NOT_CONSUMABLE");
    return signedCredential.claims.credential_id;
  }
}
