import { DeviceTrustVerifier, type DeviceTrustBinding } from "@pos-platform/device-trust";
import type { DeviceTrustChallenge } from "@pos-platform/contracts";
import type { DeviceChallengeStore } from "./device-challenge-store.js";
import type { DeviceRegistryReader } from "./device-registry-reader.js";

export interface DeviceChallengeRequest {
  readonly deviceId: string;
}

export type DeviceChallengeOutcome =
  /**
   * El desafío se devuelve **completo**, `tenant_id`/`installation_id`
   * incluidos: el equipo tiene que firmar exactamente los mismos bytes
   * canónicos que el servidor verificará luego, y ninguno de esos campos es
   * secreto — son lo que el registro ya sabe de este `device_id`.
   */
  | { readonly kind: "ISSUED"; readonly challenge: DeviceTrustChallenge }
  | { readonly kind: "UNKNOWN_DEVICE" };

export interface DeviceLoginProofRequest {
  readonly deviceCredential: unknown;
  readonly challengeId: string;
  readonly proof: unknown;
}

export type DeviceLoginProofOutcome =
  | { readonly kind: "VERIFIED"; readonly binding: DeviceTrustBinding }
  | { readonly kind: "UNKNOWN_DEVICE" }
  | { readonly kind: "CHALLENGE_NOT_FOUND_OR_EXPIRED" }
  | { readonly kind: "REJECTED"; readonly decision: string };

/**
 * Orquesta la prueba de equipo para el login: el `tenant_id` de la sesión
 * sale de aquí, no de lo que declare el cliente (`CLAUDE.md`, principios no
 * negociables). El binding con el que se verifica la prueba **siempre** sale
 * del registro central (`identity.device_registry`), nunca de los claims
 * crudos del sobre que envía el cliente — así, un sobre fabricado con un
 * `tenant_id` ajeno no encuentra ninguna clave que lo firme para ESE
 * binding, y uno reciclado de otro equipo falla por
 * `CREDENTIAL_BINDING_MISMATCH`.
 */
export class DeviceLoginVerification {
  constructor(
    private readonly registry: DeviceRegistryReader,
    private readonly challenges: DeviceChallengeStore,
    private readonly verifier: DeviceTrustVerifier,
  ) {}

  async issueChallenge(request: DeviceChallengeRequest): Promise<DeviceChallengeOutcome> {
    const device = await this.registry.findActiveDevice(request.deviceId);
    if (device === null) return { kind: "UNKNOWN_DEVICE" };
    const challenge = this.challenges.issue({
      tenantId: device.tenant_id,
      installationId: device.installation_id,
      deviceId: device.device_id,
    });
    return { kind: "ISSUED", challenge };
  }

  async verifyProof(request: DeviceLoginProofRequest): Promise<DeviceLoginProofOutcome> {
    const challenge = this.challenges.consume(request.challengeId);
    if (challenge === null) return { kind: "CHALLENGE_NOT_FOUND_OR_EXPIRED" };

    const device = await this.registry.findActiveDevice(challenge.device_id);
    if (device === null) return { kind: "UNKNOWN_DEVICE" };

    const binding: DeviceTrustBinding = {
      tenantId: device.tenant_id,
      companyId: device.company_id,
      installationId: device.installation_id,
      deviceId: device.device_id,
    };
    try {
      const result = this.verifier.verifyProof(request.deviceCredential, challenge, request.proof, binding);
      return result.decision === "VALID" ? { kind: "VERIFIED", binding } : { kind: "REJECTED", decision: result.decision };
    } catch {
      // `InMemoryClockGuard.accept` lanza ante un retroceso real de reloj:
      // es un rechazo de seguridad legítimo, no un error de transporte, y no
      // debe subir como 500.
      return { kind: "REJECTED", decision: "CLOCK_ROLLBACK_REJECTED" };
    }
  }
}
