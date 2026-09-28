import type { SessionAssertionClaims, SessionLoginOutcome } from "@pos-platform/contracts";
import { CentralTransportError } from "../sync/central-transport.js";
import {
  CentralLoginUnavailableError,
  type CentralLoginClient,
  type CentralLoginDevice,
  type CentralLoginRequest,
} from "./central-login-client.js";
import type { OperatorSessionActivation } from "./operator-session-artifact.js";
import type { OperatorSessionProvisioningArtifact } from "@pos-platform/contracts";

/**
 * Login del operador desde la ventana (`DEC-026` §13.11): obtiene de la
 * autoridad la SSA y el SAS (`CentralLoginClient`) y los activa por la ruta
 * canónica (`activateOperatorSessionArtifact`). Aquí sólo se traducen los
 * desenlaces: ninguna decisión de confianza se toma en este fichero.
 */
export type OperatorLoginResult =
  | { readonly kind: "AUTHENTICATED"; readonly claims: SessionAssertionClaims }
  | {
    readonly kind: "FAILED";
    readonly outcome: Exclude<SessionLoginOutcome, "AUTHENTICATED">;
    readonly decision: string | null;
    readonly retryAt: string | null;
  };

export interface OperatorLoginDependencies {
  readonly client: CentralLoginClient;
  /** `null` si el equipo no tiene credencial de dispositivo: no está enrolado. */
  readonly device: () => CentralLoginDevice | null;
  readonly activate: (artifact: OperatorSessionProvisioningArtifact) => Promise<OperatorSessionActivation>;
}

export class OperatorLoginService {
  constructor(private readonly dependencies: OperatorLoginDependencies) {}

  async login(request: CentralLoginRequest, signal: AbortSignal): Promise<OperatorLoginResult> {
    const device = this.dependencies.device();
    if (device === null) return failed("DEVICE_NOT_ENROLLED");

    let central;
    try {
      central = await this.dependencies.client.login(device, request, signal);
    } catch (error) {
      if (error instanceof CentralTransportError || error instanceof CentralLoginUnavailableError) {
        return failed("CENTRAL_UNREACHABLE", error instanceof CentralTransportError ? error.code : "CENTRAL_RESPONSE_UNUSABLE");
      }
      // Una respuesta que no cumple el contrato no se activa ni se interpreta:
      // es un sobre que el POS no puede verificar.
      return failed("SESSION_REJECTED", "CENTRAL_RESPONSE_INVALID");
    }

    if (central.kind === "NOT_ISSUED") return failed("SESSION_NOT_ISSUED");
    if (central.kind === "REFUSED") return failed(central.outcome, central.decision, central.retryAt);

    const activation = await this.dependencies.activate(central.artifact);
    if (activation.decision !== "PROVISIONED") return failed("SESSION_REJECTED", activation.detail);
    return { kind: "AUTHENTICATED", claims: central.artifact.session_assertion.claims };
  }
}

function failed(
  outcome: Exclude<SessionLoginOutcome, "AUTHENTICATED">,
  decision: string | null = null,
  retryAt: string | null = null,
): OperatorLoginResult {
  return { kind: "FAILED", outcome, decision: decision !== null && /^[A-Z][A-Z0-9_]{0,63}$/.test(decision) ? decision : null, retryAt };
}
