import { describe, expect, it } from "vitest";
import {
  authorizesReissue,
  isStorableAsEvidence,
  normalizedResultOf,
  requiresReconciliationBeforeRetry,
  type DocumentArtifactOutcome,
  type DocumentIssuanceOutcome,
  type DocumentStatusQueryOutcome,
} from "../src/index.js";

/**
 * La regla que estas pruebas fijan no es de estilo: es la que impide que un
 * timeout se convierta en una factura duplicada con otro consecutivo DIAN.
 */

const PROVIDER_STATUS = {
  providerCode: "FACTUS",
  providerStatus: "Factura validada",
  httpStatus: 201,
} as const;

const EVIDENCED: DocumentIssuanceOutcome = {
  kind: "EVIDENCED",
  transportStatus: "COMPLETED",
  normalizedResult: "ACCEPTED",
  externalIdentity: {
    providerOperationId: "op-1",
    providerDocumentId: "doc-1",
    prefix: "SETP",
    number: "990000001",
    cufe: "abc",
  },
  providerStatus: PROVIDER_STATUS,
};

const TECHNICAL_FAILURE: DocumentIssuanceOutcome = {
  kind: "TECHNICAL_FAILURE",
  transportStatus: "FAILED",
  providerStatus: null,
  diagnostic: { code: "CONNECT_TIMEOUT", diagnosticReference: "diag-1", retryAfterSeconds: null },
};

const UNCERTAIN: DocumentIssuanceOutcome = {
  kind: "UNCERTAIN",
  transportStatus: "UNKNOWN_OUTCOME",
  providerStatus: null,
  diagnostic: { code: "READ_TIMEOUT_AFTER_SEND", diagnosticReference: "diag-2", retryAfterSeconds: null },
};

describe("resultado fiscal y estado técnico permanecen separados", () => {
  it("sólo el desenlace con evidencia expone resultado normalizado", () => {
    expect(normalizedResultOf(EVIDENCED)).toBe("ACCEPTED");
    expect(normalizedResultOf(TECHNICAL_FAILURE)).toBeNull();
    expect(normalizedResultOf(UNCERTAIN)).toBeNull();
  });

  it("un fallo técnico no puede llevar resultado normalizado ni siquiera adjuntándolo", () => {
    // El objeto lleva la propiedad, pero el tipo de la rama no la declara, así
    // que `normalizedResultOf` no puede leerla: la garantía es estructural.
    const contaminated = {
      ...TECHNICAL_FAILURE,
      normalizedResult: "ACCEPTED",
    } as unknown as DocumentIssuanceOutcome;
    expect(normalizedResultOf(contaminated)).toBeNull();
  });

  it("los tres estados técnicos son los de FiscalSubmissionAttempt", () => {
    expect(EVIDENCED.transportStatus).toBe("COMPLETED");
    expect(TECHNICAL_FAILURE.transportStatus).toBe("FAILED");
    expect(UNCERTAIN.transportStatus).toBe("UNKNOWN_OUTCOME");
  });

  it("sólo la incertidumbre exige conciliación antes de reintentar", () => {
    expect(requiresReconciliationBeforeRetry(UNCERTAIN)).toBe(true);
    expect(requiresReconciliationBeforeRetry(TECHNICAL_FAILURE)).toBe(false);
    expect(requiresReconciliationBeforeRetry(EVIDENCED)).toBe(false);
  });
});

describe("no encontrado e incierto no son lo mismo", () => {
  const notFound: DocumentStatusQueryOutcome = { kind: "NOT_FOUND", providerStatus: null };
  const indeterminate: DocumentStatusQueryOutcome = {
    kind: "INDETERMINATE",
    reasonCode: "PROVIDER_HAS_NO_UNAMBIGUOUS_LOOKUP",
    providerStatus: null,
  };
  const found: DocumentStatusQueryOutcome = {
    kind: "FOUND",
    normalizedResult: "REJECTED",
    externalIdentity: {
      providerOperationId: "op-2",
      providerDocumentId: null,
      prefix: null,
      number: null,
      cufe: null,
    },
    providerStatus: PROVIDER_STATUS,
  };

  it("sólo un NOT_FOUND autoriza reemitir", () => {
    expect(authorizesReissue(notFound)).toBe(true);
    expect(authorizesReissue(indeterminate)).toBe(false);
    expect(authorizesReissue(found)).toBe(false);
  });
});

describe("un artefacto sin integridad no es evidencia", () => {
  const mismatch: DocumentArtifactOutcome = {
    kind: "INTEGRITY_MISMATCH",
    expectedChecksumSha256: "a".repeat(64),
    actualChecksumSha256: "b".repeat(64),
  };
  const unavailable: DocumentArtifactOutcome = { kind: "UNAVAILABLE", reasonCode: "PDF_NOT_PRODUCED" };
  const retrieved: DocumentArtifactOutcome = {
    kind: "RETRIEVED",
    artifact: {
      artifactType: "XML",
      mediaType: "application/xml",
      bytes: new Uint8Array([60, 63, 120]),
      checksumSha256: "c".repeat(64),
      byteLength: 3,
    },
  };

  it("sólo lo recuperado e íntegro se archiva", () => {
    expect(isStorableAsEvidence(retrieved)).toBe(true);
    expect(isStorableAsEvidence(mismatch)).toBe(false);
    expect(isStorableAsEvidence(unavailable)).toBe(false);
  });

  it("que un proveedor no produzca un formato no es un error del sistema", () => {
    expect(unavailable.kind).toBe("UNAVAILABLE");
  });
});
