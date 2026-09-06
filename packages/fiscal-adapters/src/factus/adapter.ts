import { createHash } from "node:crypto";
import * as z from "zod";
import type { CredentialReference } from "../credential.js";
import type { FiscalEnvironment } from "../provider.js";
import type {
  DocumentArtifactOutcome,
  DocumentArtifactPort,
  DocumentArtifactRequest,
  DocumentIssuancePort,
  DocumentIssuanceRequest,
  DocumentStatusQuery,
  DocumentStatusQueryOutcome,
  DocumentStatusQueryPort,
  FiscalConfigurationValidationOutcome,
  FiscalConfigurationValidationPort,
  FiscalConfigurationValidationRequest,
  FrozenDocumentPayload,
  NumberingRangeOutcome,
  NumberingRangePort,
  NumberingRangeQuery,
  PayloadValidationResult,
} from "../ports/index.js";
import type { DocumentIssuanceOutcome, ProviderStatusEcho } from "../outcome.js";
import { FactusAuthError, FactusAuthenticator } from "./auth.js";
import { FACTUS_ADAPTER_DECLARATION } from "./declaration.js";
import { FACTUS_PATH, factusBaseUrl } from "./environment.js";
import { HttpTransportError, type HttpResponse, type HttpTransport } from "./http.js";
import type { FactusCredentialResolver } from "./credential.js";

/**
 * Adapter FACTUS sobre los cinco puertos de capacidad.
 *
 * ## Qué está verificado y qué no
 *
 * Verificado contra documentación oficial (`provider-integration-matrix.md`,
 * 2026-08-17): el modelo de autenticación, los cuatro valores de credencial,
 * las bases de sandbox y producción, las rutas `/oauth/token`,
 * `/v2/bills/validate` y `/v2/numbering-ranges/dian`, el límite de 80
 * peticiones por minuto con `429`, `X-RateLimit-*` y `Retry-After`, y que un
 * `reference_code` repetido devuelve la factura ya procesada.
 *
 * ## Ejecución real contra el sandbox — 2026-09-06
 *
 * Verificado ejecutando la suite de sandbox contra `api-sandbox.factus.com.co`
 * con credenciales V2 reales:
 *
 * - **`POST /oauth/token` con `grant_type=password` funciona.** Los cuatro
 *   valores del cliente son los correctos y la base de sandbox es la correcta.
 * - **La forma de la respuesta de token queda verificada**: `access_token`,
 *   `token_type`, `expires_in` y `refresh_token` parsearon contra
 *   `FactusTokenResponseSchema` sin relajarlo.
 * - `validateConfiguration` devolvió `VALID` contra el proveedor real.
 *
 * **Sigue `UNVERIFIED`:**
 *
 * - La forma del cuerpo de emisión (`/v2/bills/validate`). No se ha emitido un
 *   solo documento.
 * - **La forma del cuerpo de `/v2/numbering-ranges/dian`**, observada
 *   directamente: `{ data: [...], message, status }` con elementos de claves
 *   `end_date`, `from`, `prefix`, `resolution_number`, `start_date`,
 *   `technical_key`, `to` — **sin `id`**.
 *
 * ## Corrección de un diagnóstico propio
 *
 * De ese `UNPARSEABLE_RESPONSE` concluí primero que «el esquema exigía un `id`
 * que FACTUS no devuelve». Era el síntoma, no la causa. La documentación
 * oficial de emisión lo aclara: **`/v2/numbering-ranges` y
 * `/v2/numbering-ranges/dian` son recursos distintos.** El primero devuelve los
 * rangos de FACTUS con su `id` —el `numbering_range_id` que exige emitir—; el
 * segundo, las resoluciones DIAN en crudo. Yo apuntaba al segundo pidiendo la
 * forma del primero.
 *
 * Corregido: se consulta `/v2/numbering-ranges`, el esquema tolera ambas formas
 * y la identidad usa el `id` real cuando existe.
 *
 * La forma del cuerpo de emisión también estaba mal: esperaba `data.bill.*` con
 * una cadena de estado. La documentada pone los campos bajo `data` y la
 * evidencia fiscal es el booleano **`is_validated`**. Además `data.errors`
 * trae notificaciones DIAN que **no implican rechazo**.
 *
 * Por eso el parseo es defensivo —lee lo que necesita, conserva el estado
 * original del proveedor sin convertirlo en enum, y ante cualquier forma
 * inesperada devuelve `UNCERTAIN` en vez de inventar un resultado fiscal— y por
 * eso la declaración **sigue en `MOCK_TESTED`**: la autenticación está
 * verificada, el adapter completo no.
 */

/**
 * Cuerpo de emisión, con la forma **documentada oficialmente** por Factus para
 * `POST /v2/bills/validate` (`facturas-crear-y-validar`).
 *
 * La primera versión de este adapter anidaba mal —esperaba `data.bill.*`— y
 * usaba una cadena de estado que no existe. La respuesta real pone los campos
 * directamente bajo `data`, y **la señal de aceptación es el booleano
 * `is_validated`**, no un código de estado.
 *
 * El parseo sigue siendo laxo: cada campo es opcional para que una respuesta
 * inesperada degrade el desenlace a `UNCERTAIN` en vez de romper.
 */
const FactusBillResponseSchema = z.object({
  status: z.string().optional(),
  message: z.string().optional(),
  data: z.object({
    reference_code: z.string().optional(),
    number: z.string().optional(),
    cufe: z.string().optional(),
    /** `true` si la DIAN validó el documento. Es la evidencia fiscal. */
    is_validated: z.boolean().optional(),
    validated_at: z.string().optional(),
    /**
     * Notificaciones de la DIAN (FAJ44b, RUT01…). **No implican rechazo**: la
     * documentación es explícita en que hay que mirar `is_validated`. Tratarlas
     * como rechazo sería inventar evidencia fiscal negativa.
     */
    errors: z.unknown().optional(),
    document_type: z.object({ code: z.string().optional(), name: z.string().optional() }).loose().optional(),
    links: z.object({ qr: z.string().optional(), public_url: z.string().optional() }).loose().optional(),
    totals: z.object({
      gross_amount: z.string().optional(),
      taxable_amount: z.string().optional(),
      tax_amount: z.string().optional(),
      total: z.string().optional(),
    }).loose().optional(),
  }).loose().optional(),
}).loose();

export interface FactusAdapterOptions {
  readonly now: () => number;
}

export class FactusAdapter
implements
    DocumentIssuancePort,
    DocumentStatusQueryPort,
    DocumentArtifactPort,
    NumberingRangePort,
    FiscalConfigurationValidationPort {
  private readonly authenticator: FactusAuthenticator;

  constructor(
    private readonly transport: HttpTransport,
    resolver: FactusCredentialResolver,
    private readonly environment: FiscalEnvironment,
    options: FactusAdapterOptions,
  ) {
    this.authenticator = new FactusAuthenticator(transport, resolver, environment, options);
  }

  /** Olvida el token en memoria. */
  close(): void {
    this.authenticator.forget();
  }

  // ---- DocumentIssuancePort ------------------------------------------------

  async validatePayload(document: FrozenDocumentPayload): Promise<PayloadValidationResult> {
    const findings: { code: string; path: string }[] = [];

    if (!/^[a-f0-9]{64}$/.test(document.checksumSha256)) {
      findings.push({ code: "CHECKSUM_NOT_SHA256_HEX", path: "checksumSha256" });
    } else {
      // Regla 2 y 8 de §Idempotencia: el payload congelado tiene checksum, y la
      // misma identidad con payload diferente se rechaza. Recalcularlo aquí es
      // lo que convierte esa regla en algo comprobable antes de transmitir.
      const actual = createHash("sha256")
        .update(JSON.stringify(document.payload))
        .digest("hex");
      if (actual !== document.checksumSha256) {
        findings.push({ code: "CHECKSUM_MISMATCH", path: "payload" });
      }
    }

    if (document.payload === null || typeof document.payload !== "object") {
      findings.push({ code: "PAYLOAD_NOT_AN_OBJECT", path: "payload" });
    } else if (typeof referenceCodeOf(document.payload) !== "string") {
      // `reference_code` es el mecanismo de deduplicación de FACTUS: si se
      // repite, el API rechaza para evitar duplicados. Sin él, un reintento
      // tras un desenlace incierto emitiría una segunda factura con otro
      // consecutivo DIAN. Va en el cuerpo, no en una cabecera.
      findings.push({ code: "REFERENCE_CODE_MISSING", path: "reference_code" });
    }

    return findings.length === 0 ? { kind: "VALID" } : { kind: "INVALID", findings };
  }

  async issue(
    request: DocumentIssuanceRequest,
    signal: AbortSignal,
  ): Promise<DocumentIssuanceOutcome> {
    let token: string;
    try {
      token = await this.authenticator.accessToken(request.credential, signal);
    } catch (error) {
      // Un fallo de autenticación ocurre **antes** de transmitir el documento.
      // No hay incertidumbre fiscal: no salió nada.
      return technicalFailure(
        error instanceof FactusAuthError ? error.code : "AUTHENTICATION_FAILURE",
        request.electronicDocumentId,
        null,
      );
    }

    // La identidad que FACTUS usa para deduplicar debe ser la misma que la
    // nuestra. Si divergen, un reintento no sería idempotente para el
    // proveedor y podría emitir una segunda factura. Se corta antes de salir.
    const referenceCode = referenceCodeOf(request.document.payload);
    if (referenceCode !== request.idempotencyKey) {
      return technicalFailure(
        "REFERENCE_CODE_DOES_NOT_MATCH_IDEMPOTENCY_KEY",
        request.electronicDocumentId,
        null,
      );
    }

    let response: HttpResponse;
    try {
      response = await this.transport.send({
        method: "POST",
        url: `${factusBaseUrl(this.environment)}${FACTUS_PATH.validateBill}`,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(request.document.payload),
        signal,
      });
    } catch (error) {
      const transport = error instanceof HttpTransportError ? error : undefined;
      // La distinción que lo decide todo: si la petición salió y no sabemos qué
      // pasó, reintentar puede duplicar un documento fiscal.
      return transport?.sentToProvider === true
        ? uncertain(transport.code, request.electronicDocumentId)
        : technicalFailure(transport?.code ?? "TRANSPORT_FAILURE", request.electronicDocumentId, null);
    }

    return this.interpretIssuance(response, request);
  }

  private interpretIssuance(
    response: HttpResponse,
    request: DocumentIssuanceRequest,
  ): DocumentIssuanceOutcome {
    const retryAfter = parseRetryAfter(response.headers);

    if (response.status === 429) {
      return technicalFailure("RATE_LIMITED", request.electronicDocumentId, retryAfter);
    }
    if (response.status === 401 || response.status === 403) {
      return technicalFailure("NOT_AUTHORIZED", request.electronicDocumentId, null);
    }
    if (response.status >= 500) {
      // El documento pudo llegar a procesarse en el proveedor. No se afirma
      // nada: incierto, y se resuelve por consulta o conciliación.
      return uncertain("PROVIDER_SERVER_ERROR", request.electronicDocumentId);
    }

    const parsed = FactusBillResponseSchema.safeParse(safeJson(response.body));
    if (!parsed.success) {
      return uncertain(unparseableReason(response.body), request.electronicDocumentId);
    }

    const bill = parsed.data.data;
    const providerStatus: ProviderStatusEcho = {
      providerCode: "FACTUS",
      // Se conserva el estado original sin convertirlo en enum global.
      providerStatus: parsed.data.status ?? "",
      httpStatus: response.status,
    };

    if (response.status >= 400) {
      // Rechazo de validación del proveedor antes de transmitir a la DIAN. No
      // es un rechazo fiscal: no hay evidencia de que la DIAN viera nada.
      return {
        kind: "TECHNICAL_FAILURE",
        transportStatus: "FAILED",
        providerStatus,
        diagnostic: {
          code: "PROVIDER_VALIDATION_REJECTED",
          diagnosticReference: request.electronicDocumentId,
          retryAfterSeconds: retryAfter,
        },
      };
    }

    // La evidencia fiscal es el booleano `is_validated`, no una cadena de
    // estado. Ausente significa que no sabemos, no que fuera rechazada:
    // `electronic-invoicing.md` §Modelo canónico manda a revisión segura.
    if (bill?.is_validated === undefined) {
      return uncertain("VALIDATION_FLAG_ABSENT", request.electronicDocumentId);
    }

    return {
      kind: "EVIDENCED",
      transportStatus: "COMPLETED",
      normalizedResult: bill.is_validated ? "ACCEPTED" : "REJECTED",
      externalIdentity: {
        providerOperationId: bill.reference_code ?? request.idempotencyKey,
        providerDocumentId: bill.number ?? null,
        prefix: null,
        number: bill.number ?? null,
        cufe: bill.cufe ?? null,
      },
      providerStatus,
    };
  }

  // ---- DocumentStatusQueryPort --------------------------------------------

  async queryStatus(
    query: DocumentStatusQuery,
    signal: AbortSignal,
  ): Promise<DocumentStatusQueryOutcome> {
    if (query.reference.by === "INTERNAL") {
      // FACTUS no expone consulta por identidad interna nuestra. Decirlo es
      // obligatorio: un `NOT_FOUND` aquí autorizaría reemitir, y sería falso.
      return {
        kind: "INDETERMINATE",
        reasonCode: "PROVIDER_HAS_NO_INTERNAL_REFERENCE_LOOKUP",
        providerStatus: null,
      };
    }

    let token: string;
    try {
      token = await this.authenticator.accessToken(query.credential, signal);
    } catch {
      return { kind: "INDETERMINATE", reasonCode: "AUTHENTICATION_FAILURE", providerStatus: null };
    }

    const reference = query.reference.by === "EXTERNAL"
      ? query.reference.providerOperationId
      : `${query.reference.prefix}${query.reference.number}`;

    let response: HttpResponse;
    try {
      response = await this.transport.send({
        method: "GET",
        url: `${factusBaseUrl(this.environment)}${FACTUS_PATH.validateBill}/${encodeURIComponent(reference)}`,
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
        body: undefined,
        signal,
      });
    } catch {
      return { kind: "INDETERMINATE", reasonCode: "TRANSPORT_FAILURE", providerStatus: null };
    }

    if (response.status === 404) return { kind: "NOT_FOUND", providerStatus: null };
    if (response.status !== 200) {
      return { kind: "INDETERMINATE", reasonCode: `HTTP_${response.status}`, providerStatus: null };
    }

    const parsed = FactusBillResponseSchema.safeParse(safeJson(response.body));
    if (!parsed.success) {
      return { kind: "INDETERMINATE", reasonCode: unparseableReason(response.body), providerStatus: null };
    }

    const bill = parsed.data.data;
    const providerStatus: ProviderStatusEcho = {
      providerCode: "FACTUS",
      providerStatus: parsed.data.status ?? "",
      httpStatus: 200,
    };
    if (bill?.is_validated === undefined) {
      return { kind: "INDETERMINATE", reasonCode: "VALIDATION_FLAG_ABSENT", providerStatus };
    }

    return {
      kind: "FOUND",
      normalizedResult: bill.is_validated ? "ACCEPTED" : "REJECTED",
      externalIdentity: {
        providerOperationId: bill.reference_code ?? reference,
        providerDocumentId: bill.number ?? null,
        prefix: null,
        number: bill.number ?? null,
        cufe: bill.cufe ?? null,
      },
      providerStatus,
    };
  }

  // ---- DocumentArtifactPort ------------------------------------------------

  async fetchArtifact(
    request: DocumentArtifactRequest,
    signal: AbortSignal,
  ): Promise<DocumentArtifactOutcome> {
    if (request.artifactType !== "XML" && request.artifactType !== "PDF") {
      return { kind: "UNAVAILABLE", reasonCode: "ARTIFACT_TYPE_NOT_OFFERED_BY_PROVIDER" };
    }

    let token: string;
    try {
      token = await this.authenticator.accessToken(request.credential, signal);
    } catch {
      return { kind: "UNAVAILABLE", reasonCode: "AUTHENTICATION_FAILURE" };
    }

    const suffix = request.artifactType === "XML" ? "xml" : "pdf";
    let response: HttpResponse;
    try {
      response = await this.transport.send({
        method: "GET",
        url: `${factusBaseUrl(this.environment)}/v2/bills/download-${suffix}/${encodeURIComponent(request.providerOperationId)}`,
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
        body: undefined,
        signal,
      });
    } catch {
      return { kind: "UNAVAILABLE", reasonCode: "TRANSPORT_FAILURE" };
    }

    if (response.status !== 200) {
      return { kind: "UNAVAILABLE", reasonCode: `HTTP_${response.status}` };
    }

    const expectedMediaType = request.artifactType === "XML" ? "application/xml" : "application/pdf";
    const actualMediaType = (response.headers["content-type"] ?? "").split(";")[0]?.trim() ?? "";
    if (actualMediaType !== "" && actualMediaType !== expectedMediaType) {
      return { kind: "MEDIA_TYPE_MISMATCH", expectedMediaType, actualMediaType };
    }

    const bytes = new TextEncoder().encode(response.body);
    return {
      kind: "RETRIEVED",
      artifact: {
        artifactType: request.artifactType,
        mediaType: expectedMediaType,
        bytes,
        checksumSha256: createHash("sha256").update(bytes).digest("hex"),
        byteLength: bytes.byteLength,
      },
    };
  }

  // ---- NumberingRangePort --------------------------------------------------

  async synchronizeRanges(
    query: NumberingRangeQuery,
    signal: AbortSignal,
  ): Promise<NumberingRangeOutcome> {
    let token: string;
    try {
      token = await this.authenticator.accessToken(query.credential, signal);
    } catch {
      return { kind: "UNAVAILABLE", reasonCode: "AUTHENTICATION_FAILURE" };
    }

    let response: HttpResponse;
    try {
      response = await this.transport.send({
        method: "GET",
        url: `${factusBaseUrl(this.environment)}${FACTUS_PATH.numberingRanges}`,
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
        body: undefined,
        signal,
      });
    } catch {
      return { kind: "UNAVAILABLE", reasonCode: "TRANSPORT_FAILURE" };
    }

    if (response.status !== 200) return { kind: "UNAVAILABLE", reasonCode: `HTTP_${response.status}` };

    const parsed = FactusRangesResponseSchema.safeParse(safeJson(response.body));
    if (!parsed.success) return { kind: "UNAVAILABLE", reasonCode: unparseableReason(response.body) };

    return {
      kind: "SYNCHRONIZED",
      ranges: parsed.data.data.map((range) => ({
        // Se prefiere el `id` de FACTUS cuando existe: es el
        // `numbering_range_id` que exige la emisión. El recurso DIAN no lo
        // trae, y ahí la identidad se **deriva** de resolución y prefijo,
        // marcada con prefijo `derived:` para que nadie la envíe como
        // `numbering_range_id` creyendo que es del proveedor.
        rangeId: range.id === undefined
          ? `derived:${String(range.resolution_number ?? "sin-resolucion")}:${range.prefix ?? ""}`
          : String(range.id),
        documentType: query.documentType,
        prefix: range.prefix ?? "",
        // La autoridad es siempre del proveedor: los rangos los asocia FACTUS
        // al software ante la DIAN. Nunca `LOCAL`.
        authority: "PROVIDER" as const,
        resolutionNumber: range.resolution_number === undefined
          ? null
          : String(range.resolution_number),
        rangeFrom: toInteger(range.from),
        rangeTo: toInteger(range.to),
        validFrom: range.start_date ?? null,
        validUntil: range.end_date ?? null,
      })),
    };
  }

  // ---- FiscalConfigurationValidationPort -----------------------------------

  async validateConfiguration(
    request: FiscalConfigurationValidationRequest,
    signal: AbortSignal,
  ): Promise<FiscalConfigurationValidationOutcome> {
    if (request.environment !== this.environment) {
      return {
        kind: "INCOMPLETE",
        findings: [{
          code: "ENVIRONMENT_MISMATCH",
          fieldName: null,
          diagnosticReference: `${this.environment}!=${request.environment}`,
        }],
      };
    }

    const expected = request.expectedCredentialShape.fields.map((field) => field.name).sort();
    const declared = FACTUS_REQUIRED_FIELDS.slice().sort();
    if (expected.join(",") !== declared.join(",")) {
      return {
        kind: "INCOMPLETE",
        findings: declared
          .filter((name) => !expected.includes(name))
          .map((name) => ({
            code: "CREDENTIAL_FIELD_MISSING" as const,
            fieldName: name,
            diagnosticReference: "expectedCredentialShape",
          })),
      };
    }

    try {
      await this.authenticator.accessToken(request.credential, signal);
    } catch (error) {
      if (error instanceof FactusAuthError && error.retryableByReauthentication) {
        return {
          kind: "INCOMPLETE",
          findings: [{
            code: "CREDENTIAL_REJECTED_BY_PROVIDER",
            fieldName: null,
            diagnosticReference: error.code,
          }],
        };
      }
      return {
        kind: "UNDETERMINED",
        reasonCode: error instanceof FactusAuthError ? error.code : "AUTHENTICATION_FAILURE",
        diagnosticReference: "validateConfiguration",
      };
    }

    return {
      kind: "VALID",
      environment: this.environment,
      observedCapabilities: FACTUS_ADAPTER_CAPABILITIES,
    };
  }
}

const FACTUS_REQUIRED_FIELDS = ["client_id", "client_secret", "username", "password"];

/**
 * Forma **verificada** contra el sandbox real el 2026-09-06.
 *
 * Observada: `{ data: [...], message, status }`, con elementos de claves
 * `end_date`, `from`, `prefix`, `resolution_number`, `start_date`,
 * `technical_key`, `to`.
 *
 * La versión anterior exigía un `id` que **FACTUS no devuelve**, y ese era el
 * único motivo del `UNPARSEABLE_RESPONSE`.
 *
 * Los numéricos aceptan `string | number` porque el tipo JSON de `from`, `to` y
 * `resolution_number` no se observó, sólo su presencia. Aceptar ambos es lo
 * honesto: asumir uno volvería a fallar por la misma clase de error.
 */
const FactusRangesResponseSchema = z.object({
  data: z.array(z.object({
    /**
     * Presente en `/v2/numbering-ranges` y **ausente** en
     * `/v2/numbering-ranges/dian`. Es el `numbering_range_id` que exige el
     * cuerpo de emisión, así que sin él no se puede facturar con más de un
     * rango activo.
     */
    id: z.union([z.string(), z.number()]).optional(),
    prefix: z.string().optional(),
    resolution_number: z.union([z.string(), z.number()]).optional(),
    // `technical_key` es la llave técnica DIAN. Se reconoce para no romper el
    // parseo, pero **no se propaga** a `NumberingRangeSnapshot`: interviene en
    // el cálculo del CUFE y llevarla al núcleo es una decisión de seguridad
    // propia, no un efecto colateral de sincronizar rangos.
    technical_key: z.string().optional(),
    from: z.union([z.string(), z.number()]).optional(),
    to: z.union([z.string(), z.number()]).optional(),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
  }).loose()),
}).loose();

/** Entero tolerante al tipo JSON, sin `NaN` silencioso. */
function toInteger(value: string | number | undefined): number {
  if (typeof value === "number") return Number.isInteger(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/**
 * Describe la **forma** de un cuerpo: sólo nombres de campo y marcas de
 * array/objeto. **Ningún valor.**
 *
 * Existe porque un `UNPARSEABLE_RESPONSE` a secas obliga a una ronda extra
 * contra el proveedor para averiguar qué llegó, y el sandbox sólo es
 * alcanzable desde la máquina del responsable: cada ronda perdida cuesta un
 * día. Con la forma en el propio motivo, el diagnóstico se cierra en la misma
 * ejecución.
 *
 * Misma regla que `ConfigurationFinding`: se nombra el campo, jamás su
 * contenido. Un `string`, un número o una fecha se resumen como cadena vacía,
 * así que un token o un NIT no pueden salir por aquí.
 */
export function describeShape(value: unknown, depth = 0): string {
  if (Array.isArray(value)) {
    if (depth >= MAX_SHAPE_DEPTH) return "[…]";
    return value.length === 0 ? "[]" : `[${describeShape(value[0], depth + 1)}]`;
  }
  if (value !== null && typeof value === "object") {
    if (depth >= MAX_SHAPE_DEPTH) return "{…}";
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    const shown = keys.slice(0, MAX_SHAPE_KEYS);
    const body = shown.map((key) => `${key}${describeShape(record[key], depth + 1)}`).join(",");
    return `{${body}${keys.length > shown.length ? ",…" : ""}}`;
  }
  return "";
}

// Cuatro niveles porque una lista paginada anida `raíz → data → data → ítem`, y
// las claves del ítem son justo lo que hace falta para corregir el esquema. Con
// tres, el ítem salía como `{…}` y el diagnóstico quedaba a medias.
const MAX_SHAPE_DEPTH = 4;
const MAX_SHAPE_KEYS = 12;
const MAX_SHAPE_LENGTH = 240;

/** Motivo de parseo fallido que **lleva la forma observada**. */
function unparseableReason(body: string): string {
  const shape = describeShape(safeJson(body));
  if (shape === "") return "UNPARSEABLE_RESPONSE(not-json)";
  const trimmed = shape.length > MAX_SHAPE_LENGTH
    ? `${shape.slice(0, MAX_SHAPE_LENGTH)}…`
    : shape;
  return `UNPARSEABLE_RESPONSE(shape=${trimmed})`;
}

/** Lee `reference_code` del cuerpo congelado sin asumir su forma. */
function referenceCodeOf(payload: unknown): string | undefined {
  if (payload === null || typeof payload !== "object") return undefined;
  const value = (payload as { reference_code?: unknown }).reference_code;
  return typeof value === "string" ? value : undefined;
}

function technicalFailure(
  code: string,
  diagnosticReference: string,
  retryAfterSeconds: number | null,
): DocumentIssuanceOutcome {
  return {
    kind: "TECHNICAL_FAILURE",
    transportStatus: "FAILED",
    providerStatus: null,
    diagnostic: { code, diagnosticReference, retryAfterSeconds },
  };
}

function uncertain(code: string, diagnosticReference: string): DocumentIssuanceOutcome {
  return {
    kind: "UNCERTAIN",
    transportStatus: "UNKNOWN_OUTCOME",
    providerStatus: null,
    diagnostic: { code, diagnosticReference, retryAfterSeconds: null },
  };
}

function parseRetryAfter(headers: Readonly<Record<string, string>>): number | null {
  const raw = headers["retry-after"];
  if (raw === undefined) return null;
  const seconds = Number.parseInt(raw, 10);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

function safeJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

const FACTUS_ADAPTER_CAPABILITIES = FACTUS_ADAPTER_DECLARATION.capabilities;
