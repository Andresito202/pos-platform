import type { DeviceIdentity } from "../security/device-identity.js";
import type { DeviceTrustCredentialStore } from "../security/device-trust-credential-store.js";

export const DEVICE_CREDENTIAL_UNPROVISIONED = "DEVICE_CREDENTIAL_UNPROVISIONED";

export class CentralCredentialUnavailableError extends Error {
  readonly code = DEVICE_CREDENTIAL_UNPROVISIONED;
  constructor(message: string) {
    super(message);
    this.name = "CentralCredentialUnavailableError";
  }
}

export interface DeviceRequestSigningContext {
  readonly method: "POST";
  readonly path: string;
  readonly requestId: string;
  readonly correlationId: string;
  readonly body: string;
}

export interface DeviceCredentialProvider {
  /** Optional synchronous preflight avoids claiming an outbox batch without a provisioned credential. */
  isProvisioned?(): boolean;
  /** Generates a one-request proof bound to method, route, IDs and exact serialized body. */
  authorization(context?: DeviceRequestSigningContext): Promise<string>;
}

/** Fail-closed until a centrally issued credential and encrypted device identity exist. */
export class UnprovisionedDeviceCredentialProvider implements DeviceCredentialProvider {
  isProvisioned(): boolean { return false; }
  authorization(): Promise<string> {
    return Promise.reject(new CentralCredentialUnavailableError(
      "device credential is not provisioned; central sync requires an enrolled Ed25519 device",
    ));
  }
}

/** Reads the signed credential from the encrypted store and signs each request with the device key. */
export class EnrolledDeviceCredentialProvider implements DeviceCredentialProvider {
  constructor(
    private readonly identity: DeviceIdentity,
    private readonly credentials: DeviceTrustCredentialStore,
  ) {}

  isProvisioned(): boolean {
    return this.credentials.has();
  }

  async authorization(context?: DeviceRequestSigningContext): Promise<string> {
    if (!context) throw new CentralCredentialUnavailableError("request context is required for device proof");
    if (!this.credentials.has()) throw new CentralCredentialUnavailableError("device trust credential is not provisioned");
    const credential = this.credentials.load();
    return this.identity.signRequestAuthorization({
      method: context.method,
      path: context.path,
      requestId: context.requestId,
      correlationId: context.correlationId,
      body: context.body,
      credentialId: credential.claims.credential_id,
    });
  }
}
