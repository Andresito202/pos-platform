import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  FACTUS_ADAPTER_DECLARATION,
  FactusAdapter,
  HttpTransportError,
  authorizesIssuance,
  authorizesReissue,
  commerciallyClaimableDocumentTypes,
  isStorableAsEvidence,
  isVerificationSupportedBySource,
  mayAllocateLocally,
  normalizedResultOf,
  requiresReconciliationBeforeRetry,
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

  it("se queda en MOCK_TESTED, que es el techo del fake determinista", () => {
    expect(FACTUS_ADAPTER_DECLARATION.verification).toBe("MOCK_TESTED");
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
  it("un estado validado del proveedor produce evidencia ACCEPTED con identidad externa", async () => {
    const { adapter: subject } = adapter(() =>
      json(201, { data: { bill: { number: "SETP990000001", reference_code: "POS-1", cufe: "abc", status: "1" } } }));

    const outcome = await subject.issue(ISSUE, signal);
    expect(outcome.kind).toBe("EVIDENCED");
    expect(normalizedResultOf(outcome)).toBe("ACCEPTED");
    if (outcome.kind !== "EVIDENCED") throw new Error("rama imposible");
    expect(outcome.externalIdentity.number).toBe("SETP990000001");
    expect(outcome.externalIdentity.cufe).toBe("abc");
  });

  it("un estado rechazado produce evidencia REJECTED, no un fallo técnico", async () => {
    const { adapter: subject } = adapter(() =>
      json(201, { data: { bill: { reference_code: "POS-1", status: "RECHAZADO" } } }));
    expect(normalizedResultOf(await subject.issue(ISSUE, signal))).toBe("REJECTED");
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

  it("un estado del proveedor que no reconocemos NO se mapea a un resultado inventado", async () => {
    const { adapter: subject } = adapter(() =>
      json(201, { data: { bill: { reference_code: "POS-1", status: "ESTADO_NUEVO_2027" } } }));
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

  it("envía el reference_code como mecanismo de idempotencia del proveedor", async () => {
    const { adapter: subject, transport } = adapter(() =>
      json(201, { data: { bill: { reference_code: "POS-1", status: "1" } } }));
    await subject.issue(ISSUE, signal);
    expect(transport.requests[1]?.headers["x-reference-code"]).toBe("POS-1");
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

  it("un 404 por referencia externa sí autoriza reemitir", async () => {
    const { adapter: subject } = adapter(() => json(404, {}));
    const outcome = await subject.queryStatus(
      { reference: { by: "EXTERNAL", providerOperationId: "POS-1" }, environment: "SANDBOX", credential: FAKE_REFERENCE },
      signal,
    );
    expect(outcome.kind).toBe("NOT_FOUND");
    expect(authorizesReissue(outcome)).toBe(true);
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

describe("artefactos", () => {
  it("recupera XML y calcula su checksum", async () => {
    const { adapter: subject } = adapter(() => ({
      status: 200,
      headers: { "content-type": "application/xml" },
      body: "<Invoice/>",
    }));
    const outcome = await subject.fetchArtifact(
      { electronicDocumentId: "doc-1", providerOperationId: "POS-1", artifactType: "XML", environment: "SANDBOX", credential: FAKE_REFERENCE },
      signal,
    );
    expect(isStorableAsEvidence(outcome)).toBe(true);
    if (outcome.kind !== "RETRIEVED") throw new Error("rama imposible");
    expect(outcome.artifact.checksumSha256).toHaveLength(64);
    expect(outcome.artifact.byteLength).toBe(10);
  });

  it("un tipo de medio distinto del esperado no se archiva como evidencia", async () => {
    const { adapter: subject } = adapter(() => ({
      status: 200,
      headers: { "content-type": "text/html" },
      body: "<html>error</html>",
    }));
    const outcome = await subject.fetchArtifact(
      { electronicDocumentId: "doc-1", providerOperationId: "POS-1", artifactType: "PDF", environment: "SANDBOX", credential: FAKE_REFERENCE },
      signal,
    );
    expect(outcome.kind).toBe("MEDIA_TYPE_MISMATCH");
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
      json(200, { data: [{ id: 8, prefix: "SETP", resolution_number: "18760000001", from: 990000000, to: 995000000, start_date: "2026-01-01T00:00:00Z", end_date: "2026-12-31T23:59:59Z" }] }));

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
