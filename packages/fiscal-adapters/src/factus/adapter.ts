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
 * **`UNVERIFIED`: la forma exacta del cuerpo de respuesta de emisión.** No se
 * ha ejecutado una sola petición real. Por eso el parseo es defensivo —lee lo
 * que necesita, conserva el estado original del proveedor sin convertirlo en
 * enum, y ante cualquier forma inesperada devuelve `UNCERTAIN` en vez de
 * inventar un resultado fiscal—. El fake determinista de las pruebas codifica
 * **nuestra expectativa**, no comportamiento observado del proveedor: por eso
 * la declaración se queda en `MOCK_TESTED`.
 */

/**
 * Parseo deliberadamente laxo del cuerpo de emisión.
 *
 * Cada campo es opcional porque ninguno está verificado. Un campo ausente
 * degrada el desenlace; nunca lo inventa.
 */
const FactusBillResponseSchema = z.object({
  data: z.object({
    bill: z.object({
      number: z.string().optional(),
      reference_code: z.string().optional(),
      cufe: z.string().optional(),
      status: z.union([z.string(), z.number()]).optional(),
      public_url: z.string().optional(),
    }).optional(),
  }).optional(),
  status: z.string().optional(),
  message: z.string().optional(),
}).loose();

/** Estados del proveedor que constituyen evidencia fiscal. */
const ACCEPTED_PROVIDER_STATUSES = new Set(["1", "VALIDADO", "VALIDATED", "ACCEPTED"]);
const REJECTED_PROVIDER_STATUSES = new Set(["2", "RECHAZADO", "REJECTED"]);

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

    let response: HttpResponse;
    try {
      response = await this.transport.send({
        method: "POST",
        url: `${factusBaseUrl(this.environment)}${FACTUS_PATH.validateBill}`,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json",
          // `reference_code` es el mecanismo de idempotencia del proveedor y no
          // sustituye la deduplicación interna: se combina con ella.
          "x-reference-code": request.idempotencyKey,
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
      return uncertain("UNPARSEABLE_RESPONSE", request.electronicDocumentId);
    }

    const bill = parsed.data.data?.bill;
    const providerStatus: ProviderStatusEcho = {
      providerCode: "FACTUS",
      providerStatus: String(bill?.status ?? parsed.data.status ?? ""),
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

    const normalized = normalizedFromProviderStatus(providerStatus.providerStatus);
    if (normalized === null) {
      // Estado desconocido del proveedor. `electronic-invoicing.md` §Modelo
      // canónico: se mapea a revisión segura, nunca a un estado inventado.
      return uncertain("UNRECOGNISED_PROVIDER_STATUS", request.electronicDocumentId);
    }

    return {
      kind: "EVIDENCED",
      transportStatus: "COMPLETED",
      normalizedResult: normalized,
      externalIdentity: {
        providerOperationId: bill?.reference_code ?? request.idempotencyKey,
        providerDocumentId: bill?.number ?? null,
        prefix: null,
        number: bill?.number ?? null,
        cufe: bill?.cufe ?? null,
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
      return { kind: "INDETERMINATE", reasonCode: "UNPARSEABLE_RESPONSE", providerStatus: null };
    }

    const bill = parsed.data.data?.bill;
    const providerStatus: ProviderStatusEcho = {
      providerCode: "FACTUS",
      providerStatus: String(bill?.status ?? parsed.data.status ?? ""),
      httpStatus: 200,
    };
    const normalized = normalizedFromProviderStatus(providerStatus.providerStatus);
    if (normalized === null) {
      return { kind: "INDETERMINATE", reasonCode: "UNRECOGNISED_PROVIDER_STATUS", providerStatus };
    }

    return {
      kind: "FOUND",
      normalizedResult: normalized,
      externalIdentity: {
        providerOperationId: bill?.reference_code ?? reference,
        providerDocumentId: bill?.number ?? null,
        prefix: null,
        number: bill?.number ?? null,
        cufe: bill?.cufe ?? null,
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
    if (!parsed.success) return { kind: "UNAVAILABLE", reasonCode: "UNPARSEABLE_RESPONSE" };

    return {
      kind: "SYNCHRONIZED",
      ranges: parsed.data.data.map((range) => ({
        rangeId: String(range.id),
        documentType: query.documentType,
        prefix: range.prefix ?? "",
        // La autoridad es siempre del proveedor: los rangos los asocia FACTUS
        // al software ante la DIAN. Nunca `LOCAL`.
        authority: "PROVIDER" as const,
        resolutionNumber: range.resolution_number ?? null,
        rangeFrom: range.from ?? 0,
        rangeTo: range.to ?? 0,
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

const FactusRangesResponseSchema = z.object({
  data: z.array(z.object({
    id: z.union([z.string(), z.number()]),
    prefix: z.string().optional(),
    resolution_number: z.string().optional(),
    from: z.number().int().optional(),
    to: z.number().int().optional(),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
  }).loose()),
}).loose();

function normalizedFromProviderStatus(status: string): "ACCEPTED" | "REJECTED" | null {
  const upper = status.toUpperCase();
  if (ACCEPTED_PROVIDER_STATUSES.has(upper)) return "ACCEPTED";
  if (REJECTED_PROVIDER_STATUSES.has(upper)) return "REJECTED";
  return null;
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
