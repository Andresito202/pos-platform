import { describe, expect, it } from "vitest";
import {
  authorizesIssuance,
  evaluateRangeValidity,
  mayAllocateLocally,
  type CredentialReference,
  type DocumentArtifactPort,
  type DocumentIssuancePort,
  type DocumentStatusQueryPort,
  type FiscalConfigurationValidationPort,
  type NumberingRangePort,
  type NumberingRangeSnapshot,
} from "../src/index.js";

/**
 * Nivel 1 de evidencia de `D-4`: fake determinista, sin red y sin credenciales,
 * que corre en CI. Prueba que **las cinco formas son implementables** — no que
 * ningún proveedor funcione. Su techo es `MOCK_TESTED` y ahí se queda.
 */

const CREDENTIAL: CredentialReference = {
  secretRef: "sec004:fiscal:fake:sandbox",
  version: "1",
};

/** Un único objeto satisface los cinco puertos, como haría un adapter real. */
class DeterministicFiscalFake
implements
    DocumentIssuancePort,
    DocumentStatusQueryPort,
    DocumentArtifactPort,
    NumberingRangePort,
    FiscalConfigurationValidationPort {
  async validatePayload(): ReturnType<DocumentIssuancePort["validatePayload"]> {
    return { kind: "VALID" };
  }

  async issue(): ReturnType<DocumentIssuancePort["issue"]> {
    return {
      kind: "UNCERTAIN",
      transportStatus: "UNKNOWN_OUTCOME",
      providerStatus: null,
      diagnostic: {
        code: "FAKE_NEVER_CONFIRMS",
        diagnosticReference: "fake-1",
        retryAfterSeconds: null,
      },
    };
  }

  async queryStatus(): ReturnType<DocumentStatusQueryPort["queryStatus"]> {
    return { kind: "NOT_FOUND", providerStatus: null };
  }

  async fetchArtifact(): ReturnType<DocumentArtifactPort["fetchArtifact"]> {
    return { kind: "UNAVAILABLE", reasonCode: "FAKE_PRODUCES_NO_ARTIFACTS" };
  }

  async synchronizeRanges(): ReturnType<NumberingRangePort["synchronizeRanges"]> {
    return { kind: "SYNCHRONIZED", ranges: [PROVIDER_RANGE] };
  }

  async validateConfiguration(): ReturnType<
    FiscalConfigurationValidationPort["validateConfiguration"]
  > {
    return {
      kind: "INCOMPLETE",
      findings: [
        {
          code: "CERTIFICATE_REFERENCE_MISSING",
          fieldName: "certificate_reference",
          diagnosticReference: "fake-2",
        },
      ],
    };
  }
}

const PROVIDER_RANGE: NumberingRangeSnapshot = {
  rangeId: "range-1",
  documentType: "SALES_INVOICE",
  prefix: "SETP",
  authority: "PROVIDER",
  resolutionNumber: "18760000001",
  rangeFrom: 990_000_000,
  rangeTo: 995_000_000,
  validFrom: "2026-01-01T00:00:00Z",
  validUntil: "2026-12-31T23:59:59Z",
};

const fake = new DeterministicFiscalFake();
const signal = new AbortController().signal;

describe("las cinco formas son implementables por un solo adapter", () => {
  it("valida payload y emite devolviendo un desenlace de los tres modelados", async () => {
    expect(await fake.validatePayload()).toEqual({ kind: "VALID" });
    const outcome = await fake.issue();
    expect(outcome.kind).toBe("UNCERTAIN");
  });

  it("consulta estado, artefacto, rangos y configuración", async () => {
    expect((await fake.queryStatus()).kind).toBe("NOT_FOUND");
    expect((await fake.fetchArtifact()).kind).toBe("UNAVAILABLE");
    expect((await fake.synchronizeRanges()).kind).toBe("SYNCHRONIZED");
    expect((await fake.validateConfiguration()).kind).toBe("INCOMPLETE");
    expect(signal.aborted).toBe(false);
  });
});

describe("el puerto de numeración no ofrece forma de fabricar un consecutivo", () => {
  it("no expone ninguna operación de asignación", () => {
    const surface = Object.getOwnPropertyNames(DeterministicFiscalFake.prototype);
    expect(surface).toContain("synchronizeRanges");
    expect(surface.some((name) => /allocate|assign|reserve|next/i.test(name))).toBe(false);
  });

  it("con autoridad del proveedor no se asigna localmente", () => {
    expect(mayAllocateLocally(PROVIDER_RANGE)).toBe(false);
  });

  it("no saber quién manda tampoco es permiso para mandar", () => {
    expect(mayAllocateLocally({ ...PROVIDER_RANGE, authority: "UNKNOWN" })).toBe(false);
    expect(mayAllocateLocally({ ...PROVIDER_RANGE, authority: "LOCAL" })).toBe(true);
  });

  it("evalúa vigencia sin inventar la que no está declarada", () => {
    expect(evaluateRangeValidity(PROVIDER_RANGE, "2026-06-01T00:00:00Z")).toBe("VALID");
    expect(evaluateRangeValidity(PROVIDER_RANGE, "2025-06-01T00:00:00Z")).toBe("NOT_YET_VALID");
    expect(evaluateRangeValidity(PROVIDER_RANGE, "2027-06-01T00:00:00Z")).toBe("EXPIRED");
    expect(
      evaluateRangeValidity(
        { ...PROVIDER_RANGE, validFrom: null, validUntil: null },
        "2026-06-01T00:00:00Z",
      ),
    ).toBe("UNKNOWN");
  });
});

describe("la validación de configuración no expone secretos", () => {
  it("un hallazgo nombra el campo, nunca su valor", async () => {
    const outcome = await fake.validateConfiguration();
    expect(outcome.kind).toBe("INCOMPLETE");
    if (outcome.kind !== "INCOMPLETE") throw new Error("rama imposible");
    const [finding] = outcome.findings;
    expect(finding?.fieldName).toBe("certificate_reference");
    expect(JSON.stringify(outcome)).not.toContain(CREDENTIAL.secretRef);
    expect(Object.keys(finding ?? {})).toEqual(["code", "fieldName", "diagnosticReference"]);
  });

  it("sólo una configuración válida habilita emitir", async () => {
    expect(authorizesIssuance(await fake.validateConfiguration())).toBe(false);
    expect(
      authorizesIssuance({
        kind: "UNDETERMINED",
        reasonCode: "PROVIDER_UNREACHABLE",
        diagnosticReference: "fake-3",
      }),
    ).toBe(false);
  });
});
