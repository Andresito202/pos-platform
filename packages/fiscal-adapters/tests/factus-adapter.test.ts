import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
  FACTUS_ADAPTER_DECLARATION,
  FactusAdapter,
  describeShape,
  HttpTransportError,
  authorizesIssuance,
  authorizesReissue,
  commerciallyClaimableDocumentTypes,
  isStorableAsEvidence,
  isVerificationSupportedBySource,
  mayAllocateLocally,
  normalizedResultOf,
  overallVerification,
  requiresReconciliationBeforeRetry,
  selectRangesForDocumentType,
  validateAdapterDeclaration,
  type DocumentIssuanceRequest,
  type FrozenDocumentPayload,
} from "../src/index.js";
import {
  FAKE_REFERENCE,
  FakeCredentialResolver,
  FakeTransport,
  json,
  withAuth,
  type Responder,
} from "./factus-fake.js";

const signal = new AbortController().signal;
const clock = { now: () => 1_000_000 };

const PAYLOAD = { numbering_range_id: 8, reference_code: "POS-1", items: [] };
const CHECKSUM = createHash("sha256").update(JSON.stringify(PAYLOAD)).digest("hex");

const DOCUMENT: FrozenDocumentPayload = {
  documentType: "SALES_INVOICE",
  payload: PAYLOAD,
  checksumSha256: CHECKSUM,
};

const ISSUE: DocumentIssuanceRequest = {
  electronicDocumentId: "doc-1",
  idempotencyKey: "POS-1",
  attemptNumber: 1,
  environment: "SANDBOX",
  credential: FAKE_REFERENCE,
  document: DOCUMENT,
};

function adapter(...responders: readonly Responder[]) {
  const transport = new FakeTransport(responders.map((responder) => withAuth(responder)));
  return {
    transport,
    adapter: new FactusAdapter(transport, new FakeCredentialResolver(), "SANDBOX", clock),
  };
}

describe("declaración del adapter", () => {
  it("no se contradice a sí misma", () => {
    expect(validateAdapterDeclaration(FACTUS_ADAPTER_DECLARATION)).toEqual([]);
  });

  it("declara SANDBOX_VERIFIED sólo en los dos puertos ejecutados contra el proveedor", () => {
    // Evidencia del 2026-09-06: la suite de sandbox pasó 103/103 contra
    // `api-sandbox.factus.com.co`, pero sólo ejercitó configuración y rangos.
    expect(FACTUS_ADAPTER_DECLARATION.verification.FISCAL_CONFIGURATION_VALIDATION)
      .toBe("SANDBOX_VERIFIED");
    expect(FACTUS_ADAPTER_DECLARATION.verification.NUMBERING_RANGE).toBe("SANDBOX_VERIFIED");

    // Emisión, consulta y artefactos no se han ejecutado ni una vez: emitir
    // exige `Customer`, códigos DIAN, `Catalog` y `Tax` (`D-9`).
    expect(FACTUS_ADAPTER_DECLARATION.verification.DOCUMENT_ISSUANCE).toBe("MOCK_TESTED");
    expect(FACTUS_ADAPTER_DECLARATION.verification.DOCUMENT_STATUS_QUERY).toBe("MOCK_TESTED");
    expect(FACTUS_ADAPTER_DECLARATION.verification.DOCUMENT_ARTIFACT).toBe("MOCK_TESTED");
  });

  it("como conjunto vale lo que su puerto peor verificado", () => {
    expect(overallVerification(FACTUS_ADAPTER_DECLARATION)).toBe("MOCK_TESTED");
    expect(isVerificationSupportedBySource("MOCK_TESTED", "DETERMINISTIC_FAKE")).toBe(true);
    expect(isVerificationSupportedBySource("SANDBOX_VERIFIED", "DETERMINISTIC_FAKE")).toBe(false);
  });

  it("por tanto no habilita reclamar compatibilidad de ningún tipo documental", () => {
    expect(commerciallyClaimableDocumentTypes(FACTUS_ADAPTER_DECLARATION)).toEqual([]);
  });
});

describe("validación del payload congelado, antes de transmitir", () => {
  it("acepta un payload cuyo checksum coincide", async () => {
    const { adapter: subject } = adapter(() => json(200, {}));
    expect(await subject.validatePayload(DOCUMENT)).toEqual({ kind: "VALID" });
  });

  it("rechaza el payload cuyo checksum no coincide, sin consumir un intento", async () => {
    const { adapter: subject, transport } = adapter(() => json(200, {}));
    const result = await subject.validatePayload({ ...DOCUMENT, payload: { tampered: true } });
    expect(result.kind).toBe("INVALID");
    if (result.kind !== "INVALID") throw new Error("rama imposible");
    expect(result.findings.map((finding) => finding.code)).toContain("CHECKSUM_MISMATCH");
    expect(transport.requests).toHaveLength(0);
  });

  it("rechaza un checksum que no es SHA-256 hexadecimal", async () => {
    const { adapter: subject } = adapter(() => json(200, {}));
    const result = await subject.validatePayload({ ...DOCUMENT, checksumSha256: "corto" });
    expect(result.kind).toBe("INVALID");
  });
});

describe("emisión: evidencia, fallo técnico e incertidumbre", () => {
  it("`is_validated: true` produce evidencia ACCEPTED con identidad externa", async () => {
    // Forma documentada oficialmente para `POST /v2/bills/validate`: los campos
    // van directamente bajo `data`, y la evidencia es el booleano
    // `is_validated`. No hay cadena de estado.
    const { adapter: subject } = adapter(() =>
      json(201, {
        status: "Created",
        message: "Documento registrado y validado con éxito",
        data: {
          reference_code: "POS-1",
          number: "SETP990002443",
          cufe: "a821f2e05cb1b82e0f74",
          is_validated: true,
          validated_at: "13-05-2026 08:21:49 AM",
          errors: {},
          links: { qr: "https://catalogo-vpfe-hab.dian.gov.co/document/searchqr?documentkey=x" },
          totals: { total: "83300.00" },
        },
      }));

    const outcome = await subject.issue(ISSUE, signal);
    expect(outcome.kind).toBe("EVIDENCED");
    expect(normalizedResultOf(outcome)).toBe("ACCEPTED");
    if (outcome.kind !== "EVIDENCED") throw new Error("rama imposible");
    expect(outcome.externalIdentity.number).toBe("SETP990002443");
    expect(outcome.externalIdentity.cufe).toBe("a821f2e05cb1b82e0f74");
    expect(outcome.providerStatus.providerStatus).toBe("Created");
  });

  it("is_validated false es pendiente; exige conciliación y no autoriza reemisión", async () => {
    const { adapter: subject } = adapter(() =>
      json(201, { status: "Created", data: { reference_code: "POS-1", is_validated: false } }));
    const outcome = await subject.issue(ISSUE, signal);
    expect(outcome.kind).toBe("UNCERTAIN");
    expect(normalizedResultOf(outcome)).toBeNull();
    expect(requiresReconciliationBeforeRetry(outcome)).toBe(true);
  });

  it("`errors` de la DIAN con `is_validated: true` sigue siendo ACCEPTED", async () => {
    // La documentación es explícita: `errors` trae notificaciones DIAN —FAJ44b,
    // RUT01— que **no implican rechazo**. Tratarlas como rechazo inventaría
    // evidencia fiscal negativa sobre una factura válida.
    const { adapter: subject } = adapter(() =>
      json(201, {
        status: "Created",
        data: {
          reference_code: "POS-1",
          number: "SETP990002444",
          is_validated: true,
          errors: { FAJ44b: ["advertencia"], RUT01: ["otra"] },
        },
      }));
    expect(normalizedResultOf(await subject.issue(ISSUE, signal))).toBe("ACCEPTED");
  });

  it("un timeout DESPUÉS de transmitir es incierto, nunca un resultado inferido", async () => {
    const { adapter: subject } = adapter(() => {
      throw new HttpTransportError("read timeout", "READ_TIMEOUT", true);
    });

    const outcome = await subject.issue(ISSUE, signal);
    expect(outcome.kind).toBe("UNCERTAIN");
    expect(normalizedResultOf(outcome)).toBeNull();
    expect(requiresReconciliationBeforeRetry(outcome)).toBe(true);
  });

  it("un fallo ANTES de transmitir es técnico, y sí permite reintentar", async () => {
    const { adapter: subject } = adapter(() => {
      throw new HttpTransportError("dns", "DNS_FAILURE", false);
    });

    const outcome = await subject.issue(ISSUE, signal);
    expect(outcome.kind).toBe("TECHNICAL_FAILURE");
    expect(requiresReconciliationBeforeRetry(outcome)).toBe(false);
  });

  it("un 5xx del proveedor es incierto: el documento pudo procesarse", async () => {
    const { adapter: subject } = adapter(() => json(503, { message: "unavailable" }));
    const outcome = await subject.issue(ISSUE, signal);
    expect(outcome.kind).toBe("UNCERTAIN");
  });

  it("sin `is_validated` no se infiere resultado: va a revisión", async () => {
    const { adapter: subject } = adapter(() =>
      json(201, { status: "Created", data: { reference_code: "POS-1", number: "SETP1" } }));
    const outcome = await subject.issue(ISSUE, signal);
    expect(outcome.kind).toBe("UNCERTAIN");
    expect(normalizedResultOf(outcome)).toBeNull();
  });

  it("un 429 conserva Retry-After y no es incierto: no se llegó a procesar", async () => {
    const { adapter: subject } = adapter(() => json(429, { message: "slow down" }, { "retry-after": "42" }));
    const outcome = await subject.issue(ISSUE, signal);
    expect(outcome.kind).toBe("TECHNICAL_FAILURE");
    if (outcome.kind !== "TECHNICAL_FAILURE") throw new Error("rama imposible");
    expect(outcome.diagnostic.code).toBe("RATE_LIMITED");
    expect(outcome.diagnostic.retryAfterSeconds).toBe(42);
  });

  it("un rechazo de validación del proveedor no es un rechazo fiscal", async () => {
    const { adapter: subject } = adapter(() => json(422, { message: "invalid item" }));
    const outcome = await subject.issue(ISSUE, signal);
    expect(outcome.kind).toBe("TECHNICAL_FAILURE");
    // La DIAN no vio nada: afirmar REJECTED sería inventar evidencia fiscal.
    expect(normalizedResultOf(outcome)).toBeNull();
  });

  it("el `reference_code` viaja en el CUERPO, que es donde FACTUS lo espera", async () => {
    const { adapter: subject, transport } = adapter(() =>
      json(201, { status: "Created", data: { reference_code: "POS-1", is_validated: true } }));
    await subject.issue(ISSUE, signal);
    const body = JSON.parse(transport.requests[1]?.body ?? "{}") as { reference_code?: string };
    expect(body.reference_code).toBe("POS-1");
    // Y no como cabecera inventada: la documentación no la contempla.
    expect(transport.requests[1]?.headers["x-reference-code"]).toBeUndefined();
  });

  it("corta antes de salir si el `reference_code` del cuerpo no es la clave de idempotencia", async () => {
    const { adapter: subject, transport } = adapter(() => json(201, {}));
    const divergent = { ...PAYLOAD, reference_code: "OTRO" };
    const outcome = await subject.issue({
      ...ISSUE,
      document: {
        documentType: "SALES_INVOICE",
        payload: divergent,
        checksumSha256: createHash("sha256").update(JSON.stringify(divergent)).digest("hex"),
      },
    }, signal);

    expect(outcome.kind).toBe("TECHNICAL_FAILURE");
    if (outcome.kind !== "TECHNICAL_FAILURE") throw new Error("rama imposible");
    expect(outcome.diagnostic.code).toBe("REFERENCE_CODE_DOES_NOT_MATCH_IDEMPOTENCY_KEY");
    // Sólo el token; la factura no se transmitió.
    expect(transport.requests).toHaveLength(1);
  });

  it("rechaza en validación un cuerpo sin `reference_code`", async () => {
    const { adapter: subject } = adapter(() => json(200, {}));
    const withoutReference = { items: [] };
    const result = await subject.validatePayload({
      documentType: "SALES_INVOICE",
      payload: withoutReference,
      checksumSha256: createHash("sha256").update(JSON.stringify(withoutReference)).digest("hex"),
    });
    expect(result.kind).toBe("INVALID");
    if (result.kind !== "INVALID") throw new Error("rama imposible");
    expect(result.findings.map((finding) => finding.code)).toContain("REFERENCE_CODE_MISSING");
  });
});

describe("consulta de estado", () => {
  it("por identidad interna es INDETERMINATE: FACTUS no ofrece esa búsqueda", async () => {
    const { adapter: subject, transport } = adapter(() => json(200, {}));
    const outcome = await subject.queryStatus(
      { reference: { by: "INTERNAL", electronicDocumentId: "doc-1" }, environment: "SANDBOX", credential: FAKE_REFERENCE },
      signal,
    );
    expect(outcome.kind).toBe("INDETERMINATE");
    // Y no autoriza reemitir, que es lo que haría un NOT_FOUND falso.
    expect(authorizesReissue(outcome)).toBe(false);
    expect(transport.requests).toHaveLength(0);
  });

  it("un 404 del listado por referencia externa no autoriza reemitir", async () => {
    const { adapter: subject } = adapter(() => json(404, {}));
    const outcome = await subject.queryStatus(
      { reference: { by: "EXTERNAL", providerOperationId: "POS-1" }, environment: "SANDBOX", credential: FAKE_REFERENCE },
      signal,
    );
    expect(outcome.kind).toBe("INDETERMINATE");
    expect(authorizesReissue(outcome)).toBe(false);
  });

  it("un fallo de transporte es INDETERMINATE, jamás NOT_FOUND", async () => {
    const { adapter: subject } = adapter(() => { throw new HttpTransportError("x", "TIMEOUT", true); });
    const outcome = await subject.queryStatus(
      { reference: { by: "EXTERNAL", providerOperationId: "POS-1" }, environment: "SANDBOX", credential: FAKE_REFERENCE },
      signal,
    );
    expect(outcome.kind).toBe("INDETERMINATE");
    expect(authorizesReissue(outcome)).toBe(false);
  });
});

// Fixture sintético basado en la forma V2 documentada y observada el 2026-11-18.
const observedBill = { reference_code: "POS-1", number: "SETP123", cufe: "a".repeat(96), is_validated: true };
function billResponder(next: Responder): Responder {
  return (request) => {
    if (request.url.includes("/v2/bills?filter%5Breference_code%5D=")) {
      return json(200, { data: { data: [observedBill], pagination: { last_page: 1 } } });
    }
    if (request.url.endsWith("/v2/bills/SETP123")) return json(200, { data: observedBill });
    return next(request);
  };
}

describe("consulta V2 por referencia", () => {
  it("resuelve referencia exacta y consulta detalle por número", async () => {
    const { adapter: subject, transport } = adapter(billResponder(() => json(500, {})));
    const result = await subject.queryStatus({ reference: { by: "EXTERNAL", providerOperationId: "POS-1" }, environment: "SANDBOX", credential: FAKE_REFERENCE }, signal);
    expect(result.kind).toBe("FOUND");
    if (result.kind !== "FOUND") throw new Error("rama imposible");
    expect(result.externalIdentity.number).toBe("SETP123");
    expect(result.externalIdentity.cufe).toBe(observedBill.cufe);
    expect(transport.requests[1]?.url).toContain("/v2/bills?filter%5Breference_code%5D=POS-1");
    expect(transport.requests[2]?.url).toContain("/v2/bills/SETP123");
  });
  it("una coincidencia parcial o lista vacía no autoriza reemisión", async () => {
    const { adapter: subject } = adapter(() => json(200, { data: { data: [{ ...observedBill, reference_code: "POS-10" }] } }));
    const result = await subject.queryStatus({ reference: { by: "EXTERNAL", providerOperationId: "POS-1" }, environment: "SANDBOX", credential: FAKE_REFERENCE }, signal);
    expect(result.kind).toBe("INDETERMINATE");
    expect(authorizesReissue(result)).toBe(false);
  });
  it("un detalle pendiente no es rechazo ni autoriza reemisión", async () => {
    const { adapter: subject } = adapter(() => json(200, { data: { ...observedBill, is_validated: false, validated_at: null } }));
    const result = await subject.queryStatus({ reference: { by: "NUMBER", prefix: "SETP", number: "123" }, environment: "SANDBOX", credential: FAKE_REFERENCE }, signal);
    expect(result.kind).toBe("INDETERMINATE");
    expect(authorizesReissue(result)).toBe(false);
  });
});

describe("artefactos", () => {
  it("decodifica XML Base64 por CUFE y calcula checksum de los bytes, no del JSON", async () => {
    const bytes = Buffer.from("<Invoice></Invoice>");
    const { adapter: subject, transport } = adapter(billResponder(() => json(200, { data: { xml_base_64_encoded: bytes.toString("base64") } })));
    const outcome = await subject.fetchArtifact(
      { electronicDocumentId: "doc-1", providerOperationId: "POS-1", artifactType: "XML", environment: "SANDBOX", credential: FAKE_REFERENCE },
      signal,
    );
    expect(isStorableAsEvidence(outcome)).toBe(true);
    if (outcome.kind !== "RETRIEVED") throw new Error("rama imposible");
    expect(outcome.artifact.checksumSha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(Buffer.from(outcome.artifact.bytes)).toEqual(bytes);
    expect(transport.requests.at(-1)?.url).toContain(`/v2/documents/${observedBill.cufe}/download-xml`);
  });

  it("decodifica PDF V2 por número de factura", async () => {
    const bytes = Buffer.from("%PDF-1.7\nfixture");
    const { adapter: subject, transport } = adapter(billResponder(() => json(200, { data: { pdf_base_64_encoded: bytes.toString("base64") } })));
    const outcome = await subject.fetchArtifact(
      { electronicDocumentId: "doc-1", providerOperationId: "POS-1", artifactType: "PDF", environment: "SANDBOX", credential: FAKE_REFERENCE },
      signal,
    );
    expect(outcome.kind).toBe("RETRIEVED");
    if (outcome.kind !== "RETRIEVED") throw new Error("rama imposible");
    expect(Buffer.from(outcome.artifact.bytes)).toEqual(bytes);
    expect(transport.requests.at(-1)?.url).toContain("/v2/bills/SETP123/download-pdf");
  });

  it("un tipo de medio distinto del esperado no se archiva como evidencia", async () => {
    const { adapter: subject } = adapter(billResponder(() => ({
      status: 200, headers: { "content-type": "text/html" }, body: "<html>error</html>",
    })));
    const outcome = await subject.fetchArtifact(
      { electronicDocumentId: "doc-1", providerOperationId: "POS-1", artifactType: "PDF", environment: "SANDBOX", credential: FAKE_REFERENCE },
      signal,
    );
    expect(outcome.kind).toBe("MEDIA_TYPE_MISMATCH");
    expect(isStorableAsEvidence(outcome)).toBe(false);
  });

  it.each(["!!!!", Buffer.from("not a pdf").toString("base64")])("no admite artefacto inválido (%s)", async (encoded) => {
    const { adapter: subject } = adapter(billResponder(() => json(200, { data: { pdf_base_64_encoded: encoded } })));
    const outcome = await subject.fetchArtifact(
      { electronicDocumentId: "doc-1", providerOperationId: "POS-1", artifactType: "PDF", environment: "SANDBOX", credential: FAKE_REFERENCE }, signal,
    );
    expect(outcome.kind).toBe("UNAVAILABLE");
    expect(isStorableAsEvidence(outcome)).toBe(false);
  });

  it("un formato que el proveedor no produce es UNAVAILABLE, no un error", async () => {
    const { adapter: subject, transport } = adapter(() => json(200, {}));
    const outcome = await subject.fetchArtifact(
      { electronicDocumentId: "doc-1", providerOperationId: "POS-1", artifactType: "QR_DATA", environment: "SANDBOX", credential: FAKE_REFERENCE },
      signal,
    );
    expect(outcome.kind).toBe("UNAVAILABLE");
    expect(transport.requests).toHaveLength(0);
  });
});

describe("rangos de numeración", () => {
  it("la autoridad es siempre del proveedor, nunca local", async () => {
    const { adapter: subject } = adapter(() =>
      json(200, { data: [{ id: 8, document: "Factura de Venta", prefix: "SETP", resolution_number: "18760000001", from: 990000000, to: 995000000, start_date: "2026-01-01T00:00:00Z", end_date: "2026-12-31T23:59:59Z" }] }));

    const outcome = await subject.synchronizeRanges(
      { documentType: "SALES_INVOICE", environment: "SANDBOX", credential: FAKE_REFERENCE },
      signal,
    );
    expect(outcome.kind).toBe("SYNCHRONIZED");
    if (outcome.kind !== "SYNCHRONIZED") throw new Error("rama imposible");
    const range = outcome.ranges[0];
    expect(range?.authority).toBe("PROVIDER");
    expect(range && mayAllocateLocally(range)).toBe(false);
  });

  it("no confunde notas débito, ajustes ni documentos soporte con factura o nota crédito", async () => {
    const records = [
      { id: 391, document: "Nota Débito", prefix: "ND" },
      { id: 392, document: "Nota de Ajuste Documento Soporte", prefix: "NA" },
      { id: 2058, document: "Documento Soporte", prefix: "SEDS" },
      { id: 1776, document: "Nota Crédito", prefix: "CRTE" },
      { id: 390, document: "Nota Crédito", prefix: "NC" },
      { id: 389, document: "Factura de Venta", prefix: "SETP" },
      { id: 999, document: "Tipo no reconocido", prefix: "X" },
    ].map((record) => ({ ...record, is_active: true, is_expired: false }));
    const { adapter: subject } = adapter(() => json(200, { data: { data: records } }));
    const outcome = await subject.synchronizeRanges({ documentType: "SALES_INVOICE", environment: "SANDBOX", credential: FAKE_REFERENCE }, signal);
    if (outcome.kind !== "SYNCHRONIZED") throw new Error("rama imposible");
    expect(outcome.ranges.find((range) => range.prefix === "ND")?.documentType).toBe("DEBIT_NOTE");
    expect(selectRangesForDocumentType(outcome.ranges, "SALES_INVOICE").matching.map((range) => range.rangeId)).toEqual(["389"]);
    expect(selectRangesForDocumentType(outcome.ranges, "CREDIT_NOTE").matching.map((range) => range.rangeId)).toEqual(["1776", "390"]);
    expect(outcome.ranges.find((range) => range.rangeId === "999")?.authority).toBe("UNKNOWN");
    expect(selectRangesForDocumentType(outcome.ranges, "SALES_INVOICE").unclassified.map((range) => range.rangeId)).toEqual(["999"]);
  });

  it("acepta la forma REAL observada contra el sandbox, que no trae `id`", async () => {
    // Forma verificada el 2026-09-06 contra `api-sandbox.factus.com.co`:
    // `{ data: [...], message, status }`, elementos con claves `end_date`,
    // `from`, `prefix`, `resolution_number`, `start_date`, `technical_key`,
    // `to`. Ningún valor real aparece aquí, sólo la forma.
    const { adapter: subject } = adapter(() =>
      json(200, {
        status: "OK",
        message: "ok",
        data: [{
          prefix: "SETP",
          resolution_number: "18760000001",
          technical_key: "clave-tecnica-de-prueba",
          from: 990000000,
          to: 995000000,
          start_date: "2026-01-01",
          end_date: "2026-12-31",
        }],
      }));

    const outcome = await subject.synchronizeRanges(
      { documentType: "SALES_INVOICE", environment: "SANDBOX", credential: FAKE_REFERENCE },
      signal,
    );
    expect(outcome.kind).toBe("SYNCHRONIZED");
    if (outcome.kind !== "SYNCHRONIZED") throw new Error("rama imposible");
    const range = outcome.ranges[0];
    expect(range?.prefix).toBe("SETP");
    expect(range?.resolutionNumber).toBe("18760000001");
    expect(range?.rangeFrom).toBe(990000000);
    expect(range?.validUntil).toBe("2026-12-31");
  });

  it("la llave técnica DIAN NO se propaga al snapshot", async () => {
    const { adapter: subject } = adapter(() =>
      json(200, { data: [{ prefix: "SETP", resolution_number: "1", technical_key: "no-debe-salir" }] }));

    const outcome = await subject.synchronizeRanges(
      { documentType: "SALES_INVOICE", environment: "SANDBOX", credential: FAKE_REFERENCE },
      signal,
    );
    // Interviene en el cálculo del CUFE. Llevarla al núcleo es una decisión de
    // seguridad propia, no un efecto colateral de sincronizar rangos.
    expect(JSON.stringify(outcome)).not.toContain("no-debe-salir");
  });

  it("tolera que los numéricos vengan como cadena, que es tipo no observado", async () => {
    const { adapter: subject } = adapter(() =>
      json(200, { data: [{ prefix: "SETP", resolution_number: 18760000001, from: "990000000", to: "995000000" }] }));

    const outcome = await subject.synchronizeRanges(
      { documentType: "SALES_INVOICE", environment: "SANDBOX", credential: FAKE_REFERENCE },
      signal,
    );
    expect(outcome.kind).toBe("SYNCHRONIZED");
    if (outcome.kind !== "SYNCHRONIZED") throw new Error("rama imposible");
    expect(outcome.ranges[0]?.rangeFrom).toBe(990000000);
    expect(outcome.ranges[0]?.resolutionNumber).toBe("18760000001");
  });

  it("usa el `id` de FACTUS cuando existe: es el `numbering_range_id` de emisión", async () => {
    const { adapter: subject } = adapter(() =>
      json(200, { data: [{ id: 389, prefix: "SETP", resolution_number: "18760000001" }] }));

    const outcome = await subject.synchronizeRanges(
      { documentType: "SALES_INVOICE", environment: "SANDBOX", credential: FAKE_REFERENCE },
      signal,
    );
    if (outcome.kind !== "SYNCHRONIZED") throw new Error("rama imposible");
    expect(outcome.ranges[0]?.rangeId).toBe("389");
  });

  it("marca la identidad como derivada cuando el recurso DIAN no trae `id`", async () => {
    const { adapter: subject } = adapter(() =>
      json(200, { data: [{ prefix: "SETP", resolution_number: "18760000001" }] }));

    const outcome = await subject.synchronizeRanges(
      { documentType: "SALES_INVOICE", environment: "SANDBOX", credential: FAKE_REFERENCE },
      signal,
    );
    if (outcome.kind !== "SYNCHRONIZED") throw new Error("rama imposible");
    // El prefijo `derived:` impide que alguien lo envíe como
    // `numbering_range_id` creyendo que es un identificador del proveedor.
    expect(outcome.ranges[0]?.rangeId).toBe("derived:18760000001:SETP");
  });

  it("acepta la forma PAGINADA de /v2/numbering-ranges, verificada contra el sandbox", async () => {
    // Forma observada el 2026-09-06 contra `api-sandbox.factus.com.co`:
    // `{status, message, data:{data:[…], pagination:{…}}}`.
    const { adapter: subject } = adapter(() =>
      json(200, {
        status: "OK",
        message: "consulta exitosa",
        data: {
          data: [{
            id: 389,
            document: "01",
            prefix: "SETP",
            from: 990000000,
            to: 995000000,
            current: 990000123,
            resolution_number: "18760000001",
            start_date: "2026-01-01",
            end_date: "2026-12-31",
            technical_key: "clave-tecnica",
            is_expired: false,
            is_active: true,
          }],
          pagination: { total: 1, per_page: 10, current_page: 1, last_page: 1 },
        },
      }));

    const outcome = await subject.synchronizeRanges(
      { documentType: "SALES_INVOICE", environment: "SANDBOX", credential: FAKE_REFERENCE },
      signal,
    );
    expect(outcome.kind).toBe("SYNCHRONIZED");
    if (outcome.kind !== "SYNCHRONIZED") throw new Error("rama imposible");
    const range = outcome.ranges[0];
    // El `id` real, que es el `numbering_range_id` de emisión.
    expect(range?.rangeId).toBe("389");
    expect(range?.currentNumber).toBe(990000123);
    expect(range?.providerActive).toBe(true);
    expect(range?.providerExpired).toBe(false);
    expect(range?.providerDocumentCode).toBe("01");
  });

  it("sigue aceptando la forma PLANA de /v2/numbering-ranges/dian", async () => {
    const { adapter: subject } = adapter(() =>
      json(200, { status: "OK", data: [{ prefix: "SETP", resolution_number: "18760000001" }] }));

    const outcome = await subject.synchronizeRanges(
      { documentType: "SALES_INVOICE", environment: "SANDBOX", credential: FAKE_REFERENCE },
      signal,
    );
    expect(outcome.kind).toBe("SYNCHRONIZED");
    if (outcome.kind !== "SYNCHRONIZED") throw new Error("rama imposible");
    // Sin `id`, la identidad se marca derivada.
    expect(outcome.ranges[0]?.rangeId).toBe("derived:18760000001:SETP");
    expect(outcome.ranges[0]?.currentNumber).toBeNull();
  });

  it("una forma desconocida dice CUÁL es, sin filtrar un solo valor", async () => {
    const { adapter: subject } = adapter(() =>
      json(200, {
        status: "OK",
        message: "consulta exitosa",
        results: [{ identifier: 389, serie: "SETP", resolucion: "18760000001" }],
        next: "https://example/x?page=2",
      }));

    const outcome = await subject.synchronizeRanges(
      { documentType: "SALES_INVOICE", environment: "SANDBOX", credential: FAKE_REFERENCE },
      signal,
    );
    expect(outcome.kind).toBe("UNAVAILABLE");
    if (outcome.kind !== "UNAVAILABLE") throw new Error("rama imposible");

    // El motivo lleva la forma: se cierra el diagnóstico sin otra ronda.
    expect(outcome.reasonCode).toContain("UNPARSEABLE_RESPONSE(shape=");
    expect(outcome.reasonCode).toContain("results[{identifier,serie,resolucion}]");

    // Y ni un solo VALOR sale por ahí.
    expect(outcome.reasonCode).not.toContain("SETP");
    expect(outcome.reasonCode).not.toContain("18760000001");
    expect(outcome.reasonCode).not.toContain("389");
    expect(outcome.reasonCode).not.toContain("example");
  });

  it("acepta campos nulos, que es como un API JSON dice «vacío»", async () => {
    // `.optional()` acepta ausente pero **rechaza `null`**, y un API devuelve
    // `null` en una columna vacía en vez de omitir la clave. Ése fue el fallo
    // que costó una ronda entera contra el sandbox.
    const { adapter: subject } = adapter(() =>
      json(200, {
        status: "OK",
        data: {
          data: [{
            id: 389,
            document: null,
            prefix: "SETP",
            from: 990000000,
            to: null,
            current: null,
            resolution_number: "18760000001",
            start_date: "2026-01-01",
            end_date: null,
            technical_key: null,
            is_expired: null,
            is_active: null,
          }],
          pagination: { total: 1 },
        },
      }));

    const outcome = await subject.synchronizeRanges(
      { documentType: "SALES_INVOICE", environment: "SANDBOX", credential: FAKE_REFERENCE },
      signal,
    );
    expect(outcome.kind).toBe("SYNCHRONIZED");
    if (outcome.kind !== "SYNCHRONIZED") throw new Error("rama imposible");
    const range = outcome.ranges[0];
    expect(range?.rangeId).toBe("389");
    expect(range?.currentNumber).toBeNull();
    expect(range?.providerActive).toBeNull();
    expect(range?.providerDocumentCode).toBeNull();
    expect(range?.authority).toBe("UNKNOWN");
  });

  it("interpreta banderas de vigencia sin usar truthiness", async () => {
    // `Boolean("false")` es `true`, y eso invertiría la vigencia de un rango
    // fiscal. Las formas se reconocen explícitamente.
    const { adapter: subject } = adapter(() =>
      json(200, {
        data: [
          { prefix: "A", resolution_number: "1", is_active: 1, is_expired: "false" },
          { prefix: "B", resolution_number: "2", is_active: "true", is_expired: 0 },
          { prefix: "C", resolution_number: "3", is_active: "quizá", is_expired: "quizá" },
        ],
      }));

    const outcome = await subject.synchronizeRanges(
      { documentType: "SALES_INVOICE", environment: "SANDBOX", credential: FAKE_REFERENCE },
      signal,
    );
    if (outcome.kind !== "SYNCHRONIZED") throw new Error("rama imposible");
    expect(outcome.ranges[0]?.providerActive).toBe(true);
    expect(outcome.ranges[0]?.providerExpired).toBe(false);
    expect(outcome.ranges[1]?.providerActive).toBe(true);
    expect(outcome.ranges[1]?.providerExpired).toBe(false);
    // Lo no reconocido queda en `null` —«no lo sé»—, nunca en `false`.
    expect(outcome.ranges[2]?.providerActive).toBeNull();
    expect(outcome.ranges[2]?.providerExpired).toBeNull();
  });

  it("`describeShape` nombra campos y nunca contenido, y MARCA los nulos", () => {
    expect(describeShape({ token: "secreto", n: 42, ok: true })).toBe("{token,n,ok}");
    // Un nulo era invisible: se resumía igual que una cadena. Ahora se ve.
    expect(describeShape({ a: "x", b: null })).toBe("{a,b:null}");
    expect(describeShape(null)).toBe(":null");
    expect(describeShape([{ a: 1 }])).toBe("[{a}]");
    expect(describeShape([])).toBe("[]");
    expect(describeShape("cualquier-secreto")).toBe("");
    // Un cuerpo que no es JSON se distingue de uno que sí lo es con otra forma.
    expect(describeShape(undefined)).toBe("");
  });

  it("el adapter no expone ninguna operación de asignación de consecutivo", () => {
    const surface = Object.getOwnPropertyNames(FactusAdapter.prototype);
    expect(surface).toContain("synchronizeRanges");
    expect(surface.some((name) => /allocate|assign|reserve|nextNumber/i.test(name))).toBe(false);
  });
});

describe("validación de configuración", () => {
  it("con credencial aceptada y ambiente correcto habilita emitir", async () => {
    const { adapter: subject } = adapter(() => json(200, {}));
    const outcome = await subject.validateConfiguration(
      { environment: "SANDBOX", credential: FAKE_REFERENCE, expectedCredentialShape: FACTUS_ADAPTER_DECLARATION.credential },
      signal,
    );
    expect(authorizesIssuance(outcome)).toBe(true);
  });

  it("un ambiente distinto del configurado no habilita, y lo dice sin exponer nada", async () => {
    const { adapter: subject } = adapter(() => json(200, {}));
    const outcome = await subject.validateConfiguration(
      { environment: "PRODUCTION", credential: FAKE_REFERENCE, expectedCredentialShape: FACTUS_ADAPTER_DECLARATION.credential },
      signal,
    );
    expect(outcome.kind).toBe("INCOMPLETE");
    if (outcome.kind !== "INCOMPLETE") throw new Error("rama imposible");
    expect(outcome.findings[0]?.code).toBe("ENVIRONMENT_MISMATCH");
    expect(JSON.stringify(outcome)).not.toContain("fake-client-secret");
  });

  it("una forma de credencial incompleta nombra el campo que falta, no su valor", async () => {
    const { adapter: subject } = adapter(() => json(200, {}));
    const outcome = await subject.validateConfiguration(
      {
        environment: "SANDBOX",
        credential: FAKE_REFERENCE,
        expectedCredentialShape: {
          transport: "OAUTH2_PASSWORD_GRANT",
          tokenLifecycle: "ACCESS_AND_REFRESH_TOKEN",
          fields: [{ name: "client_id", source: "CUSTOMER", secret: false }],
          neverAccountPassword: false,
        },
      },
      signal,
    );
    expect(outcome.kind).toBe("INCOMPLETE");
    if (outcome.kind !== "INCOMPLETE") throw new Error("rama imposible");
    expect(outcome.findings.map((finding) => finding.fieldName).sort()).toEqual([
      "client_secret",
      "password",
      "username",
    ]);
  });

  it("una credencial rechazada por el proveedor es INCOMPLETE, no UNDETERMINED", async () => {
    const transport = new FakeTransport([() => json(401, { error: "invalid_client" })]);
    const subject = new FactusAdapter(transport, new FakeCredentialResolver(), "SANDBOX", clock);
    const outcome = await subject.validateConfiguration(
      { environment: "SANDBOX", credential: FAKE_REFERENCE, expectedCredentialShape: FACTUS_ADAPTER_DECLARATION.credential },
      signal,
    );
    expect(outcome.kind).toBe("INCOMPLETE");
    if (outcome.kind !== "INCOMPLETE") throw new Error("rama imposible");
    expect(outcome.findings[0]?.code).toBe("CREDENTIAL_REJECTED_BY_PROVIDER");
    expect(outcome.findings[0]?.diagnosticReference).toContain("http=401");
    expect(outcome.findings[0]?.diagnosticReference).toContain("oauth_error=invalid_client");
    expect(JSON.stringify(outcome)).not.toContain("fake-client-secret");
  });

  it("un fallo de transporte deja la configuración UNDETERMINED, ni válida ni inválida", async () => {
    const transport = new FakeTransport([
      () => { throw new HttpTransportError("dns", "DNS_FAILURE", false); },
    ]);
    const subject = new FactusAdapter(transport, new FakeCredentialResolver(), "SANDBOX", clock);
    const outcome = await subject.validateConfiguration(
      { environment: "SANDBOX", credential: FAKE_REFERENCE, expectedCredentialShape: FACTUS_ADAPTER_DECLARATION.credential },
      signal,
    );
    expect(outcome.kind).toBe("UNDETERMINED");
    expect(authorizesIssuance(outcome)).toBe(false);
  });
});
