import { createPublicKey } from "node:crypto";
import { join } from "node:path";
import { UuidSchema } from "@pos-platform/contracts";
import { DeviceTrustVerifier } from "@pos-platform/device-trust";
import { ServiceLifecycle } from "../lifecycle.js";
import { LocalDatabaseComponent } from "../local-database-component.js";
import { AndroidKeystoreKeyProvider } from "../security/android-keystore-key-provider.js";
import { DeviceEnrollmentService, type DeviceEnrollmentBinding } from "../security/device-enrollment-service.js";
import { DeviceTrustCredentialStore } from "../security/device-trust-credential-store.js";
import { EncryptedFileSecretStore } from "../security/encrypted-secret-store.js";
import { LocalSecurityComponent } from "../security/local-security-component.js";
import { LicenseCapacityGate, type OperationalLicenseInformation } from "../security/license-capacity-gate.js";

export interface AndroidLicenseObservation {
  readonly branchId: string;
  readonly load: ConstructorParameters<typeof LicenseCapacityGate>[1];
}

/** Internal composition for the privileged Android host, NOT a wire contract.
 * Binding comes from trusted installation provisioning; it grants no authority.
 * The host must supply an actual native-parent key provider and centrally trusted
 * verifier. Neither IDs, a React object nor OS_BOUND authenticate a device/person.
 * No productive caller is enabled by constructing this foundation.
 */
export class AndroidSecurityFoundation {
  private readonly database: LocalDatabaseComponent;
  private readonly security: LocalSecurityComponent;
  private readonly lifecycle: ServiceLifecycle;
  private readonly binding: DeviceEnrollmentBinding;
  private credentialSecrets: EncryptedFileSecretStore | undefined;
  private credentials: DeviceTrustCredentialStore | undefined;
  private enrollment: DeviceEnrollmentService | undefined;

  constructor(
    directory: string,
    binding: DeviceEnrollmentBinding,
    private readonly provider: AndroidKeystoreKeyProvider,
    private readonly verifier: DeviceTrustVerifier,
    private readonly now: () => Date,
    private readonly licenseObservation?: AndroidLicenseObservation,
  ) {
    if (!(provider instanceof AndroidKeystoreKeyProvider) || !(verifier instanceof DeviceTrustVerifier) || typeof now !== "function") {
      throw new Error("ANDROID_TRUSTED_SECURITY_DEPENDENCIES_REQUIRED");
    }
    this.binding = Object.freeze({
      tenantId: UuidSchema.parse(binding.tenantId), companyId: UuidSchema.parse(binding.companyId),
      installationId: UuidSchema.parse(binding.installationId), deviceId: UuidSchema.parse(binding.deviceId),
    });
    if(licenseObservation) {
      UuidSchema.parse(licenseObservation.branchId);
      if(typeof licenseObservation.load!=="function")throw Error("ANDROID_TRUSTED_LICENSE_LOADER_REQUIRED");
      this.licenseObservation=Object.freeze({...licenseObservation});
    }
    this.database = new LocalDatabaseComponent(directory);
    this.security = new LocalSecurityComponent(this.database, this.binding, provider, join(directory, "security"), now);
    this.lifecycle = new ServiceLifecycle([
      this.database,
      {
        name: this.security.name,
        start: async () => {
          // ServiceLifecycle rolls back only completed components. Clean partial
          // secret-store initialization as well when local-security.start fails.
          try { await this.security.start(); } catch (error) { await this.security.stop(); throw error; }
        },
        stop: () => this.security.stop(),
      },
      {
        name: "device-enrollment",
        start: async () => {
          try {
            this.credentialSecrets = new EncryptedFileSecretStore(join(directory, "security"), provider,
              `device-trust:${this.binding.installationId}:${this.binding.deviceId}`);
            this.credentials = new DeviceTrustCredentialStore(this.credentialSecrets);
            this.enrollment = new DeviceEnrollmentService(this.database.database, this.security.identity, this.binding, now, this.credentials);
            // Persisted material is reverified at every boot, never trusted by presence.
            if (this.credentials.has()) this.verifyStoredCredential();
          } catch (error) { this.clearEnrollment(); throw error; }
        },
        stop: async () => { this.clearEnrollment(); },
      },
    ]);
  }

  async start(): Promise<void> {
    try { await this.lifecycle.start(); } finally { this.provider.destroy(); }
  }
  async stop(): Promise<void> { try { await this.lifecycle.stop(); } finally { this.provider.destroy(); } }

  prepareEnrollment(activation: unknown) {
    this.requireReady();
    return this.enrollment!.prepare(activation);
  }
  completeEnrollment(result: unknown) {
    this.requireReady();
    return this.enrollment!.complete(result, this.verifier);
  }
  /** Reverify on each use, including current central-key revocation and time.
   * The returned public credential is NOT a BUSINESS session or permission.
   */
  requireVerifiedDevice() {
    this.requireReady();
    return this.verifyStoredCredential();
  }
  /** Internal read only; scope is installer-owned, never supplied over Binder.
   * Enrollment, root revocation and signed-capacity acceptance are rechecked. */
  licenseInformation(): OperationalLicenseInformation {
    const unknown:OperationalLicenseInformation={status:"UNVERIFIED",signedValidUntil:null,lastAcceptedLocalCheck:null,evaluatedAt:null};
    try {
      this.requireVerifiedDevice();
      if(!this.licenseObservation)return unknown;
      return new LicenseCapacityGate(this.database.database,this.licenseObservation.load,this.now)
        .information({...this.binding,branchId:this.licenseObservation.branchId});
    } catch {return unknown;}
  }
  status() {
    return {
      state: this.lifecycle.state,
      components: ["local-database", "local-security", "device-enrollment"] as const,
      commercial_access: "BLOCKED_PENDING_BUSINESS_AUTHORITY" as const,
      external_channel: "CLOSED" as const,
    };
  }
  private requireReady(): void {
    if (this.lifecycle.state !== "READY" || !this.enrollment) throw new Error("ANDROID_SECURITY_NOT_READY");
  }
  private verifyStoredCredential() {
    if (!this.credentials?.has()) throw new Error("DEVICE_TRUST_NOT_PROVISIONED");
    const credential = this.credentials.load();
    const result = this.verifier.verifyCredential(credential, this.binding);
    if (result.decision !== "VALID") throw new Error(`DEVICE_TRUST_REJECTED:${result.decision}`);
    const actual = createPublicKey(credential.claims.device_public_key_pem).export({ type: "spki", format: "der" });
    const expected = createPublicKey(this.security.identity.publicKeyPem()).export({ type: "spki", format: "der" });
    if (!actual.equals(expected)) throw new Error("DEVICE_ENROLLMENT_LOCAL_KEY_MISMATCH");
    // The filesystem and SQLite cannot commit atomically. A credential left by
    // an interrupted/failed audit is never sufficient: require the canonical
    // completion record as well. Recovery stays an explicit enrollment action.
    const completion = this.database.database.native.prepare(
      "SELECT 1 FROM local_security_audit WHERE event_type='DEVICE_ENROLLMENT_COMPLETED' AND json_extract(details_json,'$.credential_id')=? LIMIT 1",
    ).get(credential.claims.credential_id);
    if (!completion) throw new Error("DEVICE_ENROLLMENT_COMPLETION_NOT_RECORDED");
    return credential;
  }
  private clearEnrollment(): void {
    this.credentialSecrets?.destroy();
    this.credentialSecrets = undefined; this.credentials = undefined; this.enrollment = undefined;
  }
}
