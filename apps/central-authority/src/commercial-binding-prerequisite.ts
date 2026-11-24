/**
 * Internal prerequisite for future centrally issued, device-bound credentials.
 * There is deliberately no token encoder, production policy, HTTP handler,
 * serialized session reference or fallback to unverified identity.
 */
export interface TrustedCommercialIdentity {
  readonly sessionId: string;
  readonly userId: string;
  readonly tenantId: string;
  readonly tenantMembershipId: string;
}
export interface TrustedCommercialDevice {
  readonly deviceId: string;
  readonly installationId: string;
  readonly tenantId: string;
  readonly companyId: string;
  readonly credentialId: string;
}
export interface ValidatedCommercialBinding {
  readonly identity: TrustedCommercialIdentity;
  readonly device: TrustedCommercialDevice;
}

/** The implementation must fetch and validate the current session from its canonical owner. */
export interface TrustedSessionInspector {
  readonly authorityReference: string;
  inspect(sessionReference: unknown): Promise<TrustedCommercialIdentity | null>;
}
/** Cryptographic device verification and single-use replay protection are required. */
export interface TrustedDeviceInspector<Proof> {
  readonly authorityReference: string;
  inspect(proof: Proof, identity: TrustedCommercialIdentity): Promise<TrustedCommercialDevice | null>;
}
/** Committed security audit, not a best-effort logging callback. */
export interface TrustedCommercialAudit {
  readonly authorityReference: string;
  record(binding: ValidatedCommercialBinding): Promise<void>;
}

export class CommercialBindingPrerequisite<Proof> {
  constructor(
    private readonly sessions: TrustedSessionInspector,
    private readonly devices: TrustedDeviceInspector<Proof>,
    private readonly audit: TrustedCommercialAudit,
  ) {
    for (const owner of [sessions, devices, audit]) {
      if (!owner?.authorityReference?.trim())
        throw new Error("COMMERCIAL_TRUSTED_AUTHORITY_REQUIRED");
    }
  }

  async establish(sessionReference: unknown, deviceProof: Proof): Promise<ValidatedCommercialBinding | null> {
    // Never accept IDs or an MFA boolean as an alternative to inspecting a
    // protected reference held by the trusted central runtime.
    if (sessionReference === null || typeof sessionReference !== "object") return null;
    const identity = await this.sessions.inspect(sessionReference);
    if (!identity) return null;
    const device = await this.devices.inspect(deviceProof, identity);
    if (!device || identity.tenantId !== device.tenantId) return null;
    const refreshed = await this.sessions.inspect(sessionReference);
    if (!refreshed || refreshed.sessionId !== identity.sessionId ||
      refreshed.userId !== identity.userId || refreshed.tenantId !== identity.tenantId ||
      refreshed.tenantMembershipId !== identity.tenantMembershipId) return null;
    if (![identity.sessionId, identity.userId, identity.tenantId, identity.tenantMembershipId,
      device.deviceId, device.installationId, device.tenantId, device.companyId,
      device.credentialId].every(value => typeof value === "string" && value.length > 0)) return null;
    const binding = Object.freeze({
      identity: Object.freeze({...identity}),
      device: Object.freeze({...device}),
    });
    // Audit failures propagate and MUST stop the downstream issuance process.
    await this.audit.record(binding);
    // This is a prerequisite only; callers still need fresh authorization and
    // their approved cryptographic access protocol before granting access.
    return binding;
  }
}
