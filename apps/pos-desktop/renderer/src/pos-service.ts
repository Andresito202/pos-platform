import { RENDERER_API_METHODS, type RendererApiMethod } from "../../src/preload-api.js";

export type PosServiceStatus = "idle" | "loading" | "success" | "error";

/**
 * Superficie que `preload.ts` expone: **exactamente** los métodos de
 * `RENDERER_API_METHODS`, ni uno más. Derivarla del mismo origen impide que el
 * renderer declare un método que el puente no enruta —el hueco que dejó la
 * superficie comercial inalcanzable durante tres bloques—.
 */
export type PosService = Readonly<Record<RendererApiMethod, (payload: unknown) => Promise<unknown>>>;

declare global {
  interface Window {
    posService: PosService;
  }
}

export function getPosService(): PosService {
  if (!("posService" in window)) {
    throw new Error("posService no disponible — el renderer debe ejecutarse dentro de Electron");
  }
  return window.posService;
}

export { RENDERER_API_METHODS };

/**
 * El sobre de petición, construido aquí porque **nadie más lo construye**:
 * `ChannelBridge.handleInvoke` entrega al canal lo que reciba, sin envolverlo
 * (`channel-bridge.ts`). El servidor valida el sobre completo, así que un
 * payload desnudo se rechaza antes de llegar al handler.
 *
 * **No lleva identidad.** `tenant_id`, `company_id`, `branch_id`, `device_id` y
 * `actor_id` son opcionales en el sobre y las operaciones comerciales los
 * **rechazan** (`forbidCallerAssertedIdentity`): los deriva la capa confiable
 * del contexto verificado. Nombrar una caja no es aportar ámbito.
 */
export interface CommercialEnvelope {
  readonly protocol_version: string;
  readonly message_type: string;
  readonly request_id: string;
  readonly correlation_id: string;
  readonly payload_schema_version: string;
  readonly operation_id?: string;
  readonly idempotency_key?: string;
  readonly payload: unknown;
}

const PROTOCOL_VERSION = "1.0.0";
const PAYLOAD_SCHEMA_VERSION = "1.0.0";

function newUuid(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * `operation_id` acompaña siempre a `idempotency_key`: el sobre lo exige
 * (`envelope.ts`), y las operaciones que mutan exigen ambos
 * (`requireIdempotentOperation`). Una lectura no lleva ninguno de los dos.
 */
export function buildEnvelope(
  messageType: RendererApiMethod,
  payload: unknown,
  idempotencyKey?: string,
): CommercialEnvelope {
  const base = {
    protocol_version: PROTOCOL_VERSION,
    message_type: messageType,
    request_id: newUuid(),
    correlation_id: newUuid(),
    payload_schema_version: PAYLOAD_SCHEMA_VERSION,
    payload,
  } as const;
  return idempotencyKey === undefined
    ? base
    : { ...base, operation_id: newUuid(), idempotency_key: idempotencyKey };
}

/** Sobre de respuesta, en la forma mínima que el renderer necesita leer. */
export interface CommercialResponse<T> {
  readonly status: "SUCCEEDED" | "REJECTED" | "PENDING" | "UNKNOWN";
  readonly result_code: string;
  readonly result: T | null;
}

export type AccessInvalidation = "SESSION_NOT_BOUND" | "AUTHORIZATION_SNAPSHOT_UNAVAILABLE" | "LOCAL_SERVICE_UNAVAILABLE";
const accessObservers = new Set<(reason: AccessInvalidation) => void>();
/** Advisory removal only. This surface cannot grant identity or permissions. */
export function observeAccessInvalidation(observer: (reason: AccessInvalidation) => void): () => void {
  accessObservers.add(observer);
  return () => { accessObservers.delete(observer); };
}
function invalidateAccess(reason: AccessInvalidation): void {
  for (const observer of accessObservers) observer(reason);
}

export async function callCommercial<T>(
  messageType: RendererApiMethod,
  payload: unknown,
  idempotencyKey?: string,
): Promise<CommercialResponse<T>> {
  try {
    const response = await getPosService()[messageType](
      buildEnvelope(messageType, payload, idempotencyKey),
    ) as CommercialResponse<T>;
    // Recovery/capabilities coordinate their own strictly validated state.
    // Other backend denials must invalidate capabilities already shown by React.
    if (messageType !== "authorization.capabilities.get" && messageType !== "session.recover" &&
        response.status === "REJECTED" &&
        (response.result_code === "SESSION_NOT_BOUND" || response.result_code === "AUTHORIZATION_SNAPSHOT_UNAVAILABLE")) {
      invalidateAccess(response.result_code);
    }
    return response;
  } catch (error) {
    invalidateAccess("LOCAL_SERVICE_UNAVAILABLE");
    throw error;
  }
}

export function newIdempotencyKey(): string {
  return newUuid();
}
