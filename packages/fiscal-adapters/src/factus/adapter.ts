import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import * as z from "zod";
import { FiscalDocumentTypeSchema, type FiscalDocumentType } from "../capability.js";
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
import { fiscalDocumentTypeForCode } from "../dian/codes.js";
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

const requiredText = z.string().trim().min(1);
const supportProvider = z.object({
  identification_document_code: requiredText,
  identification: requiredText,
  legal_organization_code: requiredText,
  names: requiredText,
  address: requiredText,
  country_code: requiredText,
}).loose();
const documentItems = z.array(z.object({}).loose()).min(1);
const invoiceBody = z.object({ reference_code: requiredText }).loose();
const issuanceProfiles = {
  SALES_INVOICE: { path: FACTUS_PATH.validateBill, body: invoiceBody, productionEligible: true },
  CREDIT_NOTE: { path: FACTUS_PATH.validateCreditNote, body: invoiceBody, productionEligible: true },
  DEBIT_NOTE: {
    path: FACTUS_PATH.validateDebitNote,
    body: invoiceBody.extend({
      bill_number: requiredText.optional(),
      customization_id: requiredText.optional(),
      correction_concept_code: requiredText,
      items: documentItems,
    }).refine((note) => note.customization_id === "32" || note.bill_number !== undefined, { path: ["bill_number"] }),
    productionEligible: false,
  },
  SUPPORT_DOCUMENT: {
    path: FACTUS_PATH.validateSupportDocument,
    body: invoiceBody.extend({ provider: supportProvider, items: documentItems }),
    productionEligible: false,
  },
  SUPPORT_DOCUMENT_ADJUSTMENT_NOTE: {
    path: FACTUS_PATH.validateSupportAdjustment,
    body: invoiceBody.extend({
      support_document_number: requiredText,
      correction_concept_code: requiredText,
      provider: supportProvider,
      items: documentItems,
    }),
    productionEligible: false,
  },
} satisfies Record<FiscalDocumentType, { path: string; body: z.ZodType; productionEligible: boolean }>;

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
    cufe: z.string().nullish(),
    /** `true` si la DIAN validó el documento. `false` indica pendiente. */
    is_validated: z.boolean().optional(),
    validated_at: z.string().nullish(),
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

const FactusBillListResponseSchema = z.object({
  data: z.object({
    data: z.array(z.object({
      reference_code: z.string().nullish(),
      number: z.string().nullish(),
    }).loose()),
    pagination: z.object({ last_page: z.number().int().positive().optional() }).loose().optional(),
  }).loose(),
}).loose();

const FactusArtifactResponseSchema = z.object({
  data: z.object({
    pdf_base_64_encoded: z.string().optional(),
    xml_base_64_encoded: z.string().optional(),
  }).loose(),
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

    const documentType = FiscalDocumentTypeSchema.safeParse(document.documentType);
    if (!documentType.success) {
      findings.push({ code: "FACTUS_DOCUMENT_TYPE_UNSUPPORTED", path: "documentType" });
    } else {
      const payload = issuanceProfiles[documentType.data].body.safeParse(document.payload);
      if (!payload.success) {
        for (const issue of payload.error.issues) {
          findings.push({ code: "FACTUS_DOCUMENT_PAYLOAD_INVALID", path: issue.path.join(".") || "payload" });
        }
      }
    }

    return findings.length === 0 ? { kind: "VALID" } : { kind: "INVALID", findings };
  }

  async issue(
    request: DocumentIssuanceRequest,
    signal: AbortSignal,
  ): Promise<DocumentIssuanceOutcome> {
    const documentType = FiscalDocumentTypeSchema.safeParse(request.document.documentType);
    const reject = (code: string) => technicalFailure(code, request.electronicDocumentId, null);
    if (!documentType.success) return reject("FACTUS_DOCUMENT_TYPE_UNSUPPORTED");
    const profile = issuanceProfiles[documentType.data];
    if (request.environment !== this.environment) return reject("FACTUS_ENVIRONMENT_MISMATCH");
    if (this.environment === "PRODUCTION" && !profile.productionEligible) {
      return reject("FACTUS_DOCUMENT_TYPE_NOT_CERTIFIED_FOR_PRODUCTION");
    }
    // The frozen reference is the provider's idempotency key.
    if (referenceCodeOf(request.document.payload) !== request.idempotencyKey) {
      return reject("REFERENCE_CODE_DOES_NOT_MATCH_IDEMPOTENCY_KEY");
    }
    const validation = await this.validatePayload(request.document);
    if (validation.kind === "INVALID") return reject(validation.findings[0]?.code ?? "FACTUS_DOCUMENT_PAYLOAD_INVALID");

    let token: string;
    try {
      token = await this.authenticator.accessToken(request.credential, signal);
    } catch (error) {
      return reject(error instanceof FactusAuthError ? error.code : "AUTHENTICATION_FAILURE");
    }

    let response: HttpResponse;
    try {
      response = await this.transport.send({
        method: "POST",
        url: `${factusBaseUrl(this.environment)}${profile.path}`,
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

    return this.interpretIssuance(response, request, documentType.data);
  }

  private interpretIssuance(
    response: HttpResponse,
    request: DocumentIssuanceRequest,
    documentType: FiscalDocumentType,
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
    if (bill.reference_code !== undefined && bill.reference_code !== request.idempotencyKey) {
      return uncertain("REFERENCE_CODE_MISMATCH", request.electronicDocumentId);
    }
    if (documentType !== "SALES_INVOICE" && documentType !== "CREDIT_NOTE" &&
        (!bill.number || bill.reference_code !== request.idempotencyKey)) {
      return uncertain("DOCUMENT_IDENTITY_MISMATCH", request.electronicDocumentId);
    }
    // FACTUS V2 documenta false como pendiente, no como rechazo fiscal.
    if (!bill.is_validated) {
      return uncertain("PROVIDER_VALIDATION_PENDING", request.electronicDocumentId);
    }

    return {
      kind: "EVIDENCED",
      transportStatus: "COMPLETED",
      normalizedResult: "ACCEPTED",
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

    // El detalle V2 exige el número, no reference_code. Resolver por el
    // listado filtrado, comprobar igualdad exacta y después consultar detalle.
    const externalReference = query.reference.by === "EXTERNAL"
      ? query.reference.providerOperationId
      : null;
    let number: string;
    const headers = { authorization: `Bearer ${token}`, accept: "application/json" };
    if (query.reference.by === "EXTERNAL") {
      try {
        const listed = await this.transport.send({
          method: "GET",
          url: `${factusBaseUrl(this.environment)}/v2/bills?filter%5Breference_code%5D=${encodeURIComponent(query.reference.providerOperationId)}`,
          headers,
          body: undefined,
          signal,
        });
        if (listed.status !== 200) {
          return { kind: "INDETERMINATE", reasonCode: `REFERENCE_LOOKUP_HTTP_${listed.status}`, providerStatus: null };
        }
        const list = FactusBillListResponseSchema.safeParse(safeJson(listed.body));
        if (!list.success || (list.data.data.pagination?.last_page ?? 1) > 1) {
          return { kind: "INDETERMINATE", reasonCode: "REFERENCE_LOOKUP_UNRESOLVED", providerStatus: null };
        }
        const exact = list.data.data.data.filter((item) => item.reference_code === externalReference);
        const candidate = exact.length === 1 ? exact[0]?.number : null;
        // Una lista vacía o parcial no prueba que nunca se emitió el documento.
        if (!candidate) {
          return { kind: "INDETERMINATE", reasonCode: "REFERENCE_LOOKUP_UNRESOLVED", providerStatus: null };
        }
        number = candidate;
      } catch {
        return { kind: "INDETERMINATE", reasonCode: "TRANSPORT_FAILURE", providerStatus: null };
      }
    } else {
      number = `${query.reference.prefix}${query.reference.number}`;
    }

    let response: HttpResponse;
    try {
      response = await this.transport.send({
        method: "GET",
        url: `${factusBaseUrl(this.environment)}/v2/bills/${encodeURIComponent(number)}`,
        headers,
        body: undefined,
        signal,
      });
    } catch {
      return { kind: "INDETERMINATE", reasonCode: "TRANSPORT_FAILURE", providerStatus: null };
    }

    // Un 404 aislado no demuestra ausencia de emisión ni autoriza reintentar.
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
    if (bill?.number !== number || !bill.reference_code ||
        (externalReference !== null && bill.reference_code !== externalReference)) {
      return { kind: "INDETERMINATE", reasonCode: "DOCUMENT_IDENTITY_MISMATCH", providerStatus };
    }
    if (bill.is_validated !== true) {
      return { kind: "INDETERMINATE", reasonCode: bill.is_validated === false ? "PROVIDER_VALIDATION_PENDING" : "VALIDATION_FLAG_ABSENT", providerStatus };
    }

    return {
      kind: "FOUND",
      normalizedResult: "ACCEPTED",
      externalIdentity: {
        providerOperationId: bill.reference_code,
        providerDocumentId: bill.number,
        prefix: null,
        number: bill.number,
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

    // Resolver reference_code a las identidades reales de la factura:
    // PDF por número y XML por CUFE; ambos endpoints V2 devuelven JSON Base64.
    const identity = await this.queryStatus({
      environment: request.environment,
      credential: request.credential,
      reference: { by: "EXTERNAL", providerOperationId: request.providerOperationId },
    }, signal);
    if (identity.kind !== "FOUND" || identity.normalizedResult !== "ACCEPTED") {
      return { kind: "UNAVAILABLE", reasonCode: "ARTIFACT_DOCUMENT_UNRESOLVED" };
    }
    const isXml = request.artifactType === "XML";
    const key = isXml ? identity.externalIdentity.cufe : identity.externalIdentity.number;
    if (!key) return { kind: "UNAVAILABLE", reasonCode: "ARTIFACT_DOCUMENT_ID_MISSING" };
    const path = isXml
      ? `/v2/documents/${encodeURIComponent(key)}/download-xml`
      : `/v2/bills/${encodeURIComponent(key)}/download-pdf`;
    let response: HttpResponse;
    try {
      response = await this.transport.send({
        method: "GET",
        url: `${factusBaseUrl(this.environment)}${path}`,
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

    const expectedMediaType = isXml ? "application/xml" : "application/pdf";
    const actualMediaType = (response.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    if (actualMediaType !== "application/json") {
      return { kind: "MEDIA_TYPE_MISMATCH", expectedMediaType, actualMediaType };
    }
    const parsed = FactusArtifactResponseSchema.safeParse(safeJson(response.body));
    if (!parsed.success) return { kind: "UNAVAILABLE", reasonCode: "ARTIFACT_RESPONSE_INVALID" };
    const encoded = isXml ? parsed.data.data.xml_base_64_encoded : parsed.data.data.pdf_base_64_encoded;
    if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
      return { kind: "UNAVAILABLE", reasonCode: "ARTIFACT_BASE64_INVALID" };
    }
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.length === 0 || bytes.toString("base64") !== encoded) {
      return { kind: "UNAVAILABLE", reasonCode: "ARTIFACT_BASE64_INVALID" };
    }
    let validFormat = false;
    if (isXml) {
      try {
        const xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        validFormat = /^\s*(?:<\?xml[^?]*\?>\s*)?<(?:[\w.-]+:)?Invoice(?:\s|>)/u.test(xml);
      } catch {
        validFormat = false;
      }
    } else {
      validFormat = bytes.subarray(0, 5).toString("ascii") === "%PDF-";
    }
    if (!validFormat) return { kind: "UNAVAILABLE", reasonCode: "ARTIFACT_CONTENT_INVALID" };

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
      ranges: rangeItemsOf(parsed.data.data).map((range) => {
        // Se prefiere el `id` de FACTUS cuando existe: es el
        // `numbering_range_id` que exige la emisión. El recurso DIAN no lo
        // trae, y ahí la identidad se **deriva** de resolución y prefijo,
        // marcada con prefijo `derived:` para que nadie la envíe como
        // `numbering_range_id` creyendo que es del proveedor.
        const providerDocumentCode = toNullableString(range.document);
        // Conservar evidencia cruda no clasificada sin atribuirle autoridad
        // fiscal. documentType es obligatorio en el snapshot histórico; sólo
        // los tipos resueltos por el catálogo pueden ser candidatos de emisión.
        const resolvedDocumentType = fiscalDocumentTypeForCode(providerDocumentCode);
        return {
          rangeId: toNullableString(range.id)
            ?? `derived:${toNullableString(range.resolution_number) ?? "sin-resolucion"}:${range.prefix ?? ""}`,
          documentType: resolvedDocumentType ?? query.documentType,
          prefix: range.prefix ?? "",
          authority: resolvedDocumentType === null ? "UNKNOWN" as const : "PROVIDER" as const,
          resolutionNumber: toNullableString(range.resolution_number),
          rangeFrom: toInteger(range.from),
          rangeTo: toInteger(range.to),
          currentNumber: range.current === null || range.current === undefined
            ? null
            : toInteger(range.current),
          validFrom: range.start_date ?? null,
          validUntil: range.end_date ?? null,
          providerActive: toBoolean(range.is_active),
          providerExpired: toBoolean(range.is_expired),
          providerDocumentCode,
        };
      }),
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
        const parts = [error.code];
        if (error.httpStatus !== null) parts.push(`http=${error.httpStatus}`);
        if (error.oauthError !== null) parts.push(`oauth_error=${error.oauthError}`);
        return {
          kind: "INCOMPLETE",
          findings: [{
            code: "CREDENTIAL_REJECTED_BY_PROVIDER",
            fieldName: null,
            diagnosticReference: parts.join(";"),
          }],
        };
      }
      return {
        kind: "UNDETERMINED",
        reasonCode: error instanceof FactusAuthError ? error.code : "AUTHENTICATION_FAILURE",
        diagnosticReference: error instanceof FactusAuthError && error.httpStatus !== null
          ? `validateConfiguration;http=${error.httpStatus}`
          : "validateConfiguration",
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
 * Formas **verificadas contra el sandbox real** el 2026-09-06. Son **dos**, y
 * confundirlas costó tres rondas de diagnóstico.
 *
 * `/v2/numbering-ranges` — colección **paginada**:
 *
 * ```
 * {status, message, data: {data: [ítem…], pagination: {total, per_page, …}}}
 * ```
 *
 * `/v2/numbering-ranges/dian` — array **plano**:
 *
 * ```
 * {status, message, data: [ítem…]}
 * ```
 *
 * Claves del ítem observadas en el recurso paginado: `id`, `document`,
 * `prefix`, `from`, `to`, `current`, `resolution_number`, `start_date`,
 * `end_date`, `technical_key`, `is_expired`, `is_active`. El recurso DIAN no
 * trae `id`.
 *
 * Los numéricos aceptan `string | number` porque su tipo JSON no llegó a
 * observarse, sólo su presencia. Asumir uno repetiría la misma clase de error
 * que ya falló.
 */
const FactusRangeItemSchema = z.object({
  /**
   * Presente en `/v2/numbering-ranges` y **ausente** en
   * `/v2/numbering-ranges/dian`. Es el `numbering_range_id` que exige el
   * cuerpo de emisión, así que sin él no se puede facturar con más de un
   * rango activo.
   */
  id: z.union([z.string(), z.number()]).nullish(),
  prefix: z.string().nullish(),
  resolution_number: z.union([z.string(), z.number()]).nullish(),
  // `technical_key` es la llave técnica DIAN. Se reconoce para no romper el
  // parseo, pero **no se propaga** a `NumberingRangeSnapshot`: interviene en
  // el cálculo del CUFE y llevarla al núcleo es una decisión de seguridad
  // propia, no un efecto colateral de sincronizar rangos.
  technical_key: z.string().nullish(),
  from: z.union([z.string(), z.number()]).nullish(),
  to: z.union([z.string(), z.number()]).nullish(),
  /** Consecutivo alcanzado dentro del rango. */
  current: z.union([z.string(), z.number()]).nullish(),
  start_date: z.string().nullish(),
  end_date: z.string().nullish(),
  /**
   * Código o etiqueta documental del proveedor; se conserva en crudo y se
   * traduce sólo cuando existe una correspondencia verificada.
   */
  document: z.union([z.string(), z.number()]).nullish(),
  /**
   * Autoridad del proveedor sobre la vigencia. Manda sobre nuestra aritmética
   * de fechas.
   *
   * Se acepta `boolean`, número o cadena porque el tipo JSON **no llegó a
   * observarse**: `describeShape` resume todo primitivo igual. Un `1` o un
   * `"true"` se interpretan explícitamente en `toBoolean`; cualquier otra cosa
   * queda en `null`, que es «no lo sé», no «falso».
   */
  is_active: z.union([z.boolean(), z.number(), z.string()]).nullish(),
  is_expired: z.union([z.boolean(), z.number(), z.string()]).nullish(),
}).loose();

const FactusRangesResponseSchema = z.object({
  data: z.union([
    // `/v2/numbering-ranges` — colección paginada.
    z.object({ data: z.array(FactusRangeItemSchema) }).loose(),
    // `/v2/numbering-ranges/dian` — array plano.
    z.array(FactusRangeItemSchema),
  ]),
}).loose();

/** Extrae los ítems de cualquiera de las dos formas verificadas. */
function rangeItemsOf(
  data: z.infer<typeof FactusRangesResponseSchema>["data"],
): readonly z.infer<typeof FactusRangeItemSchema>[] {
  return Array.isArray(data) ? data : data.data;
}

/** Entero tolerante al tipo JSON y a `null`, sin `NaN` silencioso. */
function toInteger(value: string | number | null | undefined): number {
  if (typeof value === "number") return Number.isInteger(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/**
 * Booleano explícito, nunca por truthiness.
 *
 * `Boolean("false")` es `true`, y eso invertiría la vigencia de un rango
 * fiscal. Sólo se reconocen las formas listadas; el resto devuelve `null`, que
 * significa «no lo sé» y deja que mande la aritmética de fechas.
 */
function toBoolean(value: boolean | number | string | null | undefined): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1 ? true : value === 0 ? false : null;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
  }
  return null;
}

/** Cadena presente y no vacía, o `null`. `null` y `undefined` colapsan igual. */
function toNullableString(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text === "" ? null : text;
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
 *
 * **`null` sí se marca**, y no es un detalle cosmético: un campo nulo rompe un
 * `.optional()` —que acepta ausente pero no nulo— y ése fue exactamente el
 * fallo que costó una ronda entera. Resumido como cadena vacía junto al resto
 * de primitivos, era invisible en el diagnóstico. `null` no es un valor del
 * negocio, así que marcarlo no filtra nada.
 */
export function describeShape(value: unknown, depth = 0): string {
  if (value === null) return ":null";
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
