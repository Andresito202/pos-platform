import { randomUUID } from "node:crypto";
import {
  SyncBatchRequestSchema,
  SyncBatchResponseSchema,
  createCentralDeviceHttpRequestSchema,
  createCentralHttpResponseSchema,
  type SyncBatchRequest,
} from "@pos-platform/contracts";
import {
  CentralTransportError,
  type CentralHttpResponse,
  type CentralTransport,
} from "./central-transport.js";
import {
  CentralCredentialUnavailableError,
  DEVICE_CREDENTIAL_UNPROVISIONED,
  type DeviceCredentialProvider,
} from "./device-credential.js";
import type { DurableSyncStore, SyncScope } from "./durable-sync-store.js";

/**
 * `D-2` — despacho saliente del outbox hacia la API central.
 *
 * Cierra el único hueco del ciclo durable: `DurableSyncStore` ya sabía reclamar
 * un lote (`claimBatch`), asentar una respuesta (`recordResponse`) y penalizar
 * un fallo (`recordTransportFailure`). Entre lo primero y lo segundo no había
 * nada. Esta clase es ese «nada», y no hace más que eso: **no decide política de
 * reintento** —la fija `RetryPolicy` dentro del store— ni **escribe en SQLite**
 * por su cuenta.
 *
 * ## Invariante que gobierna el diseño
 *
 * Un lote reclamado queda `IN_FLIGHT`. A partir de ahí, **toda** salida de este
 * método debe terminar en `recordResponse` o en `recordTransportFailure`: dejar
 * filas `IN_FLIGHT` sin desenlace las inmoviliza hasta el siguiente arranque,
 * porque sólo `recoverInterruptedDispatches()` las rescata. Por eso cada rama de
 * error llama a `recordTransportFailure` antes de devolver, y por eso el cuerpo
 * entero va dentro de un `try` cuyo `catch` hace lo mismo ante lo imprevisto.
 *
 * ## Por qué no hay caso «desenlace incierto» propio
 *
 * Porque el outbox ya lo tolera por construcción: cada operación lleva su
 * `idempotency_key` y el inbox inserta con `INSERT OR IGNORE`, de modo que
 * reenviar un lote que la autoridad ya aplicó no duplica nada. `sent` no cambia
 * la decisión, sólo el código de error que queda registrado para diagnóstico.
 */

export const SYNC_BATCH_MESSAGE_TYPE = "sync.batch.push";
export const SYNC_BATCH_PATH = "/v1/sync/batches";

/**
 * Versión del esquema del payload de lote. No existe registro central de
 * versiones de payload; se declara aquí porque el envelope la exige y porque el
 * servidor necesita poder rechazar una forma que no entienda
 * (`integration-contracts.md` §Versionado, regla 4).
 */
export const SYNC_BATCH_PAYLOAD_SCHEMA_VERSION = "1.0.0";

const DEFAULT_MAX_OPERATIONS = 100;
const DEFAULT_MAX_BODY_BYTES = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

export interface SyncDispatcherOptions {
  readonly maxOperations?: number;
  readonly maxRequestBytes?: number;
  readonly maxResponseBytes?: number;
  readonly timeoutMs?: number;
}

export type DispatchOutcome =
  /** No había nada elegible que enviar. */
  | { readonly kind: "IDLE" }
  /** La autoridad respondió y el store asentó el resultado. */
  | {
    readonly kind: "DELIVERED";
    readonly batchId: string;
    readonly operations: number;
    readonly acknowledgedThrough: number | null;
  }
  /** Respuesta válida y negativa: el lote no se aplicó. */
  | { readonly kind: "REJECTED"; readonly batchId: string; readonly code: string }
  /** No hubo respuesta utilizable. `sent` distingue «no salió» de «no sé». */
  | {
    readonly kind: "TRANSPORT_FAILED";
    readonly batchId: string;
    readonly code: string;
    readonly sent: boolean;
  }
  /** No hay credencial de dispositivo: `DEC-008` sin materializar. */
  | { readonly kind: "NOT_AUTHENTICATED"; readonly code: string };

function positiveInteger(value: number, label: string, max: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new RangeError(`${label} must be an integer between 1 and ${max}`);
  }
  return value;
}

/** Búsqueda insensible a mayúsculas: HTTP no garantiza la caja de las cabeceras. */
function header(headers: Readonly<Record<string, string>>, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return value;
  }
  return undefined;
}

/**
 * HTTP Content-Type may include a charset parameter. The wire contract uses
 * the normalized media type, while the response body is decoded as UTF-8.
 * Reject unsupported charsets and unexpected parameters fail-closed.
 */
function normalizedJsonContentType(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const parts = raw.split(";").map((part) => part.trim());
  if (parts[0]?.toLowerCase() !== "application/json") return raw;
  if (parts.length === 1) return "application/json";
  if (parts.length === 2 && /^charset=(?:"utf-8"|utf-8)$/i.test(parts[1] ?? "")) {
    return "application/json";
  }
  return raw;
}

export class SyncDispatcher {
  private readonly baseUrl: string;
  private readonly maxOperations: number;
  private readonly maxRequestBytes: number;
  private readonly maxResponseBytes: number;
  private readonly timeoutMs: number;

  constructor(
    private readonly store: DurableSyncStore,
    private readonly transport: CentralTransport,
    private readonly credentials: DeviceCredentialProvider,
    baseUrl: string,
    private readonly protocolVersion: string,
    options: SyncDispatcherOptions = {},
  ) {
    this.maxOperations = positiveInteger(options.maxOperations ?? DEFAULT_MAX_OPERATIONS, "maxOperations", 1_000);
    this.maxRequestBytes = positiveInteger(options.maxRequestBytes ?? DEFAULT_MAX_BODY_BYTES, "maxRequestBytes", 64 * 1024 * 1024);
    this.maxResponseBytes = positiveInteger(options.maxResponseBytes ?? DEFAULT_MAX_BODY_BYTES, "maxResponseBytes", 64 * 1024 * 1024);
    this.timeoutMs = positiveInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, "timeoutMs", 600_000);
    // Sin barra final: concatenar `https://host/` con `/v1/...` produciria una
    // ruta con doble barra que un servidor estricto rechaza con 404.
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    if (!baseUrl.startsWith("https://")) {
      // `DEC-007:1563` («HTTPS obligatorio») e `integration-contracts.md:372`
      // («TLS se verifica; no se deshabilita validación de certificados»). No
      // se admite una excepción para pruebas: las pruebas inyectan un doble de
      // transporte y nunca abren un socket.
      throw new Error("central base url must use https");
    }
  }

  /**
   * Reclama un lote y lo entrega. Devuelve el desenlace sin lanzar: un fallo de
   * red no es una excepción del runtime, es un estado del outbox.
   */
  async dispatchOnce(scope: SyncScope): Promise<DispatchOutcome> {
    // Preflight local: never claim work while the device is known to be unenrolled.
    if (this.credentials.isProvisioned !== undefined && !this.credentials.isProvisioned()) {
      return { kind: "NOT_AUTHENTICATED", code: DEVICE_CREDENTIAL_UNPROVISIONED };
    }

    const batch = this.store.claimBatch(scope, this.maxOperations);
    if (batch === null) return { kind: "IDLE" };

    try {
      return await this.deliver(batch);
    } catch (error) {
      // Red de seguridad del invariante: ninguna excepción imprevista puede
      // dejar el lote inmovilizado en `IN_FLIGHT`.
      const code = (error instanceof Error ? `UNEXPECTED:${error.name}` : "UNEXPECTED").slice(0, 128);
      this.store.recordTransportFailure(batch, code);
      return { kind: "TRANSPORT_FAILED", batchId: batch.batch_id, code, sent: false };
    }
  }

  private async deliver(batch: SyncBatchRequest): Promise<DispatchOutcome> {
    const requestId = randomUUID();
    const correlationId = randomUUID();

    const body = {
      protocol_version: this.protocolVersion,
      message_type: SYNC_BATCH_MESSAGE_TYPE,
      request_id: requestId,
      correlation_id: correlationId,
      payload_schema_version: SYNC_BATCH_PAYLOAD_SCHEMA_VERSION,
      tenant_id: batch.tenant_id,
      company_id: batch.company_id,
      branch_id: batch.branch_id,
      device_id: batch.device_id,
      payload: batch,
    };
    // Sin `operation_id` ni `idempotency_key` de envelope a propósito: el
    // `batch_id` es nuevo en cada reclamación, así que una idempotencia de lote
    // sería falsa. La real es por operación (`SyncOperation.idempotency_key`) y
    // ya viaja dentro del payload.
    const serialized = JSON.stringify(body);
    const requestBytes = Buffer.byteLength(serialized, "utf8");

    let authorization: string;
    try {
      authorization = await this.credentials.authorization({
        method: "POST",
        path: SYNC_BATCH_PATH,
        requestId,
        correlationId,
        body: serialized,
      });
    } catch (error) {
      const code = error instanceof CentralCredentialUnavailableError
        ? error.code
        : DEVICE_CREDENTIAL_UNPROVISIONED;
      this.store.recordTransportFailure(batch, code);
      return { kind: "NOT_AUTHENTICATED", code };
    }

    const contractHeaders = {
      authorization,
      "content-type": "application/json",
      accept: "application/json",
      "x-pos-api-version": this.protocolVersion,
      "x-request-id": requestId,
      "x-correlation-id": correlationId,
      "x-pos-device-id": batch.device_id,
      "x-pos-installation-id": batch.installation_id,
    } as const;

    // Se valida contra el mismo esquema con que la autoridad validará. Enviar
    // algo que el servidor va a rechazar por forma gasta un intento y ensucia el
    // diagnóstico; es más barato descubrirlo aquí.
    const requestSchema = createCentralDeviceHttpRequestSchema(SyncBatchRequestSchema, {
      maxBodyBytes: this.maxRequestBytes,
      requireIdempotency: false,
    });
    const validation = requestSchema.safeParse({
      contract_headers: contractHeaders,
      received_body_bytes: requestBytes,
      body,
    });
    if (!validation.success) {
      this.store.recordTransportFailure(batch, "REQUEST_CONTRACT_VIOLATION");
      return { kind: "TRANSPORT_FAILED", batchId: batch.batch_id, code: "REQUEST_CONTRACT_VIOLATION", sent: false };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    timer.unref?.();
    let response: CentralHttpResponse;
    try {
      response = await this.transport.send({
        method: "POST",
        url: `${this.baseUrl}${SYNC_BATCH_PATH}`,
        headers: contractHeaders,
        body: serialized,
        signal: controller.signal,
      });
    } catch (error) {
      const failure = error instanceof CentralTransportError
        ? { code: error.code, sent: error.sent }
        : { code: "TRANSPORT_FAILURE", sent: true };
      this.store.recordTransportFailure(batch, failure.code);
      return { kind: "TRANSPORT_FAILED", batchId: batch.batch_id, ...failure };
    } finally {
      clearTimeout(timer);
    }

    return this.settle(batch, response, requestId);
  }

  private settle(
    batch: SyncBatchRequest,
    response: CentralHttpResponse,
    requestId: string,
  ): DispatchOutcome {
    const fail = (code: string): DispatchOutcome => {
      this.store.recordTransportFailure(batch, code);
      return { kind: "TRANSPORT_FAILED", batchId: batch.batch_id, code, sent: true };
    };

    const responseBytes = Buffer.byteLength(response.body, "utf8");
    if (responseBytes > this.maxResponseBytes) return fail("RESPONSE_TOO_LARGE");

    let parsed: unknown;
    try {
      parsed = JSON.parse(response.body);
    } catch {
      return fail("RESPONSE_NOT_JSON");
    }

    const retryAfter = header(response.headers, "retry-after");
    const responseSchema = createCentralHttpResponseSchema(SyncBatchResponseSchema, {
      maxBodyBytes: this.maxResponseBytes,
    });
    const validation = responseSchema.safeParse({
      status_code: response.status,
      contract_headers: {
        "content-type": normalizedJsonContentType(header(response.headers, "content-type")),
        "x-pos-api-version": header(response.headers, "x-pos-api-version"),
        "x-request-id": header(response.headers, "x-request-id"),
        "x-correlation-id": header(response.headers, "x-correlation-id"),
        ...(retryAfter === undefined ? {} : { "retry-after": retryAfter }),
      },
      serialized_body_bytes: responseBytes,
      // El contrato modela `rate_limit` como estado observado por el servidor;
      // el cliente no lo recibe por cabecera en esta versión y no lo inventa.
      rate_limit: null,
      body: parsed,
    });
    if (!validation.success) return fail("RESPONSE_CONTRACT_VIOLATION");

    const envelope = validation.data;
    // El esquema comprueba que la respuesta sea coherente consigo misma; no que
    // sea *esta* respuesta. Sin esto, una respuesta de otra petición en vuelo
    // podría asentarse sobre este lote.
    if (envelope.body.request_id !== requestId) return fail("RESPONSE_REQUEST_ID_MISMATCH");

    if (envelope.body.status !== "SUCCEEDED" || envelope.body.result === null) {
      // `REJECTED`, `PENDING` y `UNKNOWN` comparten tratamiento: el lote no
      // consta aplicado, así que vuelve a la cola con su código. La política de
      // cuántas veces y con qué espera es del store, no de aquí.
      const code = envelope.body.error?.code ?? envelope.body.result_code;
      if (envelope.body.status === "REJECTED") {
        this.store.recordTransportFailure(batch, code);
        return { kind: "REJECTED", batchId: batch.batch_id, code };
      }
      return fail(code);
    }

    try {
      const recorded = this.store.recordResponse(batch, envelope.body.result);
      return {
        kind: "DELIVERED",
        batchId: batch.batch_id,
        operations: recorded.results.length,
        acknowledgedThrough: recorded.acknowledged_through_local_sequence,
      };
    } catch {
      // `recordResponse` rechaza una respuesta que no corresponde al lote
      // (`validateSyncBatchCorrespondence`). Es un fallo de la autoridad o una
      // confusión de respuestas: no se asienta nada y el lote vuelve a la cola.
      return fail("RESPONSE_CORRESPONDENCE_VIOLATION");
    }
  }
}
