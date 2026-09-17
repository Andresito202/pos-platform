import type { KeyObject } from "node:crypto";
import {
  DeviceEnrollmentRequestSchema,
  DeviceEnrollmentResultSchema,
  type DeviceEnrollmentRequest,
  type DeviceEnrollmentResult,
  type SignedDeviceTrustCredential,
} from "@pos-platform/contracts";
import { DeviceRegistryEnrollmentRuntime } from "../../../apps/pos-local-service/src/security/d3-device-registry-runtime.js";
import { DeviceTrustVerifier, type DeviceTrustBinding } from "../../../apps/pos-local-service/src/security/device-trust-verifier.js";

export interface DeviceEnrollmentIssuer {
  issue(input: {
    activation_id: string;
    activation_secret: string;
    device_id: string;
    issued_at: string;
    expires_at: string;
    issuer_private_key: KeyObject;
  }): Promise<string>;
}

export interface DeviceEnrollmentEndpointDependencies {
  readonly issuer: DeviceEnrollmentIssuer;
  readonly issuerPrivateKey: KeyObject;
  readonly verifier: Pick<DeviceTrustVerifier, "verifyCredential">;
  readonly credentialLoader: (credentialId: string) => Promise<SignedDeviceTrustCredential | null>;
  readonly expiresAt: (issuedAt: string) => string;
}

/**
 * Central enrollment application boundary. It owns request validation and
 * binding checks but delegates credential issuance to the transactional
 * registry runtime and credential validation to the canonical D-3 verifier.
 * It intentionally contains no second cryptographic verification algorithm.
 */
export class DeviceEnrollmentEndpoint {
  constructor(private readonly dependencies: DeviceEnrollmentEndpointDependencies) {}

  async enroll(input: unknown): Promise<DeviceEnrollmentResult> {
    const request = DeviceEnrollmentRequestSchema.parse(input);
    const binding: DeviceTrustBinding = {
      tenantId: request.tenant_id,
      companyId: request.company_id,
      installationId: request.installation_id,
      deviceId: request.device_id,
    };

    const credentialId = await this.dependencies.issuer.issue({
      activation_id: request.activation_id,
      activation_secret: request.activation_secret,
      device_id: request.device_id,
      issued_at: request.requested_at,
      expires_at: this.dependencies.expiresAt(request.requested_at),
      issuer_private_key: this.dependencies.issuerPrivateKey,
    });

    const credential = await this.dependencies.credentialLoader(credentialId);
    if (!credential) {
      throw new Error("DEVICE_CREDENTIAL_PERSISTENCE_MISSING");
    }

    const verification = this.dependencies.verifier.verifyCredential(credential, binding);
    if (verification.decision !== "VALID") {
      throw new Error(`DEVICE_CREDENTIAL_${verification.decision}`);
    }

    return DeviceEnrollmentResultSchema.parse({
      status: "ENROLLED",
      activation_id: request.activation_id,
      credential_id: credentialId,
      enrolled_at: verification.evaluatedAt,
      reason: null,
      version: 1,
    });
  }
}

export function parseEnrollmentRequest(input: unknown): DeviceEnrollmentRequest {
  return DeviceEnrollmentRequestSchema.parse(input);
}

export function createEnrollmentEndpoint(dependencies: DeviceEnrollmentEndpointDependencies): DeviceEnrollmentEndpoint {
  return new DeviceEnrollmentEndpoint(dependencies);
}
