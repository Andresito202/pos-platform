import * as z from "zod";
import {
  DeviceTrustChallengeSchema,
  OperatorSessionProvisioningArtifactSchema,
  type OperatorSessionProvisioningArtifact,
  type SessionLoginOutcome,
  type SignedDeviceTrustCredential,
} from "@pos-platform/contracts";
import { unsignedDeviceTrustChallengeBytes } from "@pos-platform/device-trust";
import type { CentralTransport } from "../sync/central-transport.js";

/**
 * Cliente del login central (`DEC-026` §13.8 y §13.10) desde el POS.
 *
 * Lo que hace, y en este orden: (1) pide un desafío dando **sólo** su
 * `device_id`; (2) comprueba que el desafío es para este equipo —un desafío de
 * otra instalación no se firma—; (3) lo firma con la clave privada del equipo,
 * que nunca sale de `DeviceIdentity`; (4) envía credencial de equipo, prueba,
 * usuario y contraseña; (5) valida la respuesta contra el contrato. La
 * activación de lo que devuelve **no** ocurre aquí: es de
 * `activateOperatorSessionArtifact`, la misma ruta que el artefacto de
 * `DEC-025`.
 *
 * No registra nada: ni la contraseña, ni el cuerpo, ni el artefacto.
 */

export interface CentralLoginDevice {
  readonly installationId: string;
  readonly deviceId: string;
  readonly credential: SignedDeviceTrustCredential;
  signChallenge(challenge: Buffer): Buffer;
}

export interface CentralLoginRequest {
  readonly loginName: string;
  readonly password: string;
  readonly totpCode: string | null;
}

export type CentralLoginResult =
  | { readonly kind: "AUTHENTICATED"; readonly artifact: OperatorSessionProvisioningArtifact }
  | { readonly kind: "NOT_ISSUED" }
  | { readonly kind: "REFUSED"; readonly outcome: Exclude<SessionLoginOutcome, "AUTHENTICATED" | "SESSION_NOT_ISSUED" | "SESSION_REJECTED" | "DEVICE_NOT_ENROLLED">; readonly decision: string | null; readonly retryAt: string | null };

/** Desenlaces que la autoridad devuelve tal cual (`TenantLoginOutcome`). */
const PASSTHROUGH = new Set<SessionLoginOutcome>([
  "REJECTED", "THROTTLED", "PASSWORD_CHANGE_REQUIRED", "MFA_REQUIRED", "MFA_INVALID",
  "MFA_NOT_ENROLLED", "ROLE_UNDECIDED", "NO_ACTIVE_ROLE",
]);

const EnvelopeSchema = z.object({ result_code: z.string().min(1).max(128), result: z.unknown() });

const LoginResultSchema = z.object({
  session_id: z.string(),
  operator_session: z.unknown(),
}).loose();

export class CentralLoginClient {
  constructor(
    private readonly baseUrl: string,
    private readonly transport: CentralTransport,
  ) {
    const url = new URL(baseUrl);
    // Aquí viaja una contraseña: sólo por TLS. `config.ts` ya lo exige; se
    // repite porque este cliente puede construirse fuera de ese camino.
    if (url.protocol !== "https:") throw new Error("central login requires an https base URL");
  }

  async login(device: CentralLoginDevice, request: CentralLoginRequest, signal: AbortSignal): Promise<CentralLoginResult> {
    const challengeEnvelope = await this.post("/v1/auth/device/challenge", { device_id: device.deviceId }, signal);
    if (challengeEnvelope.result_code !== "ISSUED") {
      return { kind: "REFUSED", outcome: "DEVICE_REJECTED", decision: stable(challengeEnvelope.result_code), retryAt: null };
    }
    const challenge = DeviceTrustChallengeSchema.parse(challengeEnvelope.result);
    // El desafío dice para qué equipo es; firmar uno de otro sería prestarle la
    // clave de este.
    if (challenge.device_id !== device.deviceId || challenge.installation_id !== device.installationId) {
      return { kind: "REFUSED", outcome: "DEVICE_REJECTED", decision: "CHALLENGE_BINDING_MISMATCH", retryAt: null };
    }

    const proof = {
      credential_id: device.credential.claims.credential_id,
      key_id: device.credential.claims.key_id,
      challenge_id: challenge.challenge_id,
      signature: device.signChallenge(unsignedDeviceTrustChallengeBytes(challenge)).toString("base64url"),
    };

    const envelope = await this.post("/v1/auth/login", {
      device_credential: device.credential,
      challenge_id: challenge.challenge_id,
      proof,
      login_name: request.loginName,
      password: request.password,
      totp_code: request.totpCode,
    }, signal);

    if (envelope.result_code === "AUTHENTICATED") {
      const result = LoginResultSchema.parse(envelope.result);
      if (result.operator_session === null || result.operator_session === undefined) return { kind: "NOT_ISSUED" };
      return { kind: "AUTHENTICATED", artifact: OperatorSessionProvisioningArtifactSchema.parse(result.operator_session) };
    }
    if (envelope.result_code.startsWith("DEVICE_")) {
      return { kind: "REFUSED", outcome: "DEVICE_REJECTED", decision: stable(envelope.result_code), retryAt: null };
    }
    const outcome = envelope.result_code as SessionLoginOutcome;
    if (PASSTHROUGH.has(outcome)) {
      const retryAt = outcome === "THROTTLED" ? retryAtOf(envelope.result) : null;
      return { kind: "REFUSED", outcome: outcome as Exclude<SessionLoginOutcome, "AUTHENTICATED" | "SESSION_NOT_ISSUED" | "SESSION_REJECTED" | "DEVICE_NOT_ENROLLED">, decision: null, retryAt };
    }
    // Un código que el POS no conoce no se convierte en éxito ni se inventa
    // una causa: se rechaza nombrándolo.
    return { kind: "REFUSED", outcome: "REJECTED", decision: stable(envelope.result_code), retryAt: null };
  }

  private async post(path: string, body: unknown, signal: AbortSignal): Promise<z.infer<typeof EnvelopeSchema>> {
    const response = await this.transport.send({
      method: "POST",
      url: new URL(path, this.baseUrl).toString(),
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (response.status === 400) return { result_code: "MALFORMED_REQUEST", result: null };
    if (response.status < 200 || response.status >= 300) {
      throw new CentralLoginUnavailableError(`central login answered HTTP ${String(response.status)}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(response.body);
    } catch {
      throw new CentralLoginUnavailableError("central login answered a non-JSON body");
    }
    return EnvelopeSchema.parse(parsed);
  }
}

/** La autoridad no respondió algo utilizable: se trata como sin conexión. */
export class CentralLoginUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CentralLoginUnavailableError";
  }
}

/** Sólo códigos estables: un texto libre de la red no entra en la respuesta del POS. */
function stable(code: string): string | null {
  return /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : null;
}

function retryAtOf(result: unknown): string | null {
  if (typeof result !== "object" || result === null) return null;
  const value = (result as Record<string, unknown>)["retry_at"];
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;
}
