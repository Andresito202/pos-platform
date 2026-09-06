import { describe, expect, it } from "vitest";
import {
  FiscalAdapterDeclarationSchema,
  commerciallyClaimableDocumentTypes,
  platformSuppliedFieldNames,
  secretFieldNames,
  overallVerification,
  validateAdapterDeclaration,
  type FiscalAdapterDeclaration,
} from "../src/index.js";

/**
 * `D-2` ratificada exige validar la forma de los puertos y la declaración
 * **contra los tres contratos**, no sólo contra FACTUS. Si la forma sólo
 * encajara con uno, el primer adapter definiría el modelo interno por
 * accidente y el segundo se acomodaría al primero.
 *
 * Las tres declaraciones de abajo transcriben `provider-integration-matrix.md`,
 * verificada contra documentación oficial el 2026-08-17. **Sólo nombres de
 * campo, que son públicos.** Ningún valor de credencial aparece aquí ni puede
 * aparecer: `CredentialFieldSchema` es estricto y no admite una clave de valor.
 */

const SIIGO: FiscalAdapterDeclaration = {
  provider: "SIIGO",
  adapterVersion: "0.0.0-unimplemented",
  environments: ["PRODUCTION"],
  credential: {
    transport: "BEARER_TOKEN",
    tokenLifecycle: "SHORT_LIVED_REAUTHENTICATE",
    fields: [
      { name: "username", source: "CUSTOMER", secret: false },
      { name: "access_key", source: "CUSTOMER", secret: true },
      { name: "partner_id", source: "PLATFORM", secret: false },
    ],
    neverAccountPassword: true,
  },
  capabilities: {
    invoiceIssuance: "SUPPORTED",
    creditNote: "SUPPORTED",
    debitNote: "UNVERIFIED",
    supportDocument: "SUPPORTED",
    statusQuery: "UNVERIFIED",
    xmlDownload: "UNVERIFIED",
    pdfDownload: "UNVERIFIED",
    externalIdempotency: "UNKNOWN",
    webhook: "UNVERIFIED",
    contingency: "UNVERIFIED",
  },
  supportedPorts: ["DOCUMENT_ISSUANCE", "FISCAL_CONFIGURATION_VALIDATION"],
  supportedDocumentTypes: [],
  verification: {
    DOCUMENT_ISSUANCE: "NOT_EVALUATED",
    FISCAL_CONFIGURATION_VALIDATION: "NOT_EVALUATED",
  },
  rateLimit: { kind: "UNVERIFIED", policy: "HEADER_DRIVEN_UNTIL_VERIFIED" },
  quota: { kind: "NOT_EVALUATED", reason: "sin endpoint de saldo verificado" },
};

const FACTUS: FiscalAdapterDeclaration = {
  provider: "FACTUS",
  adapterVersion: "0.0.0-unimplemented",
  environments: ["SANDBOX", "PRODUCTION"],
  credential: {
    transport: "OAUTH2_PASSWORD_GRANT",
    tokenLifecycle: "ACCESS_AND_REFRESH_TOKEN",
    fields: [
      { name: "client_id", source: "CUSTOMER", secret: false },
      { name: "client_secret", source: "CUSTOMER", secret: true },
      { name: "username", source: "CUSTOMER", secret: false },
      { name: "password", source: "CUSTOMER", secret: true },
    ],
    neverAccountPassword: false,
  },
  capabilities: {
    invoiceIssuance: "SUPPORTED",
    creditNote: "SUPPORTED",
    debitNote: "SUPPORTED",
    supportDocument: "SUPPORTED",
    statusQuery: "SUPPORTED",
    xmlDownload: "SUPPORTED",
    pdfDownload: "SUPPORTED",
    externalIdempotency: "SUPPORTED",
    webhook: "UNVERIFIED",
    contingency: "UNVERIFIED",
  },
  supportedPorts: [
    "DOCUMENT_ISSUANCE",
    "DOCUMENT_STATUS_QUERY",
    "DOCUMENT_ARTIFACT",
    "NUMBERING_RANGE",
    "FISCAL_CONFIGURATION_VALIDATION",
  ],
  supportedDocumentTypes: [
    "SALES_INVOICE",
    "CREDIT_NOTE",
    "DEBIT_NOTE",
    "SUPPORT_DOCUMENT",
    "SUPPORT_DOCUMENT_ADJUSTMENT_NOTE",
  ],
  verification: {
    DOCUMENT_ISSUANCE: "NOT_EVALUATED",
    DOCUMENT_STATUS_QUERY: "NOT_EVALUATED",
    DOCUMENT_ARTIFACT: "NOT_EVALUATED",
    NUMBERING_RANGE: "NOT_EVALUATED",
    FISCAL_CONFIGURATION_VALIDATION: "NOT_EVALUATED",
  },
  rateLimit: {
    kind: "DECLARED",
    requestsPerMinute: 80,
    scope: "USER",
    honoursRetryAfter: true,
  },
  quota: { kind: "NOT_EVALUATED", reason: "bolsa anual sin endpoint de saldo verificado" },
};

const ALEGRA: FiscalAdapterDeclaration = {
  provider: "ALEGRA",
  adapterVersion: "0.0.0-unimplemented",
  environments: ["PRODUCTION"],
  credential: {
    transport: "HTTP_BASIC",
    tokenLifecycle: "LONG_LIVED_UNTIL_ROTATION",
    fields: [
      { name: "api_email", source: "CUSTOMER", secret: false },
      { name: "api_token", source: "CUSTOMER", secret: true },
    ],
    neverAccountPassword: true,
  },
  capabilities: {
    invoiceIssuance: "SUPPORTED",
    creditNote: "SUPPORTED",
    debitNote: "UNVERIFIED",
    supportDocument: "UNVERIFIED",
    statusQuery: "SUPPORTED",
    xmlDownload: "SUPPORTED",
    pdfDownload: "SUPPORTED",
    externalIdempotency: "UNKNOWN",
    webhook: "SUPPORTED",
    contingency: "UNVERIFIED",
  },
  supportedPorts: [
    "DOCUMENT_ISSUANCE",
    "DOCUMENT_STATUS_QUERY",
    "DOCUMENT_ARTIFACT",
    "FISCAL_CONFIGURATION_VALIDATION",
  ],
  supportedDocumentTypes: ["SALES_INVOICE", "CREDIT_NOTE"],
  verification: {
    DOCUMENT_ISSUANCE: "NOT_EVALUATED",
    DOCUMENT_STATUS_QUERY: "NOT_EVALUATED",
    DOCUMENT_ARTIFACT: "NOT_EVALUATED",
    FISCAL_CONFIGURATION_VALIDATION: "NOT_EVALUATED",
  },
  rateLimit: {
    kind: "DECLARED",
    requestsPerMinute: 150,
    scope: "USER",
    honoursRetryAfter: false,
  },
  quota: { kind: "NOT_EVALUATED", reason: "modelo de bolsa no aplica al contrato revisado" },
};

const ALL = [SIIGO, FACTUS, ALEGRA] as const;

describe("la forma admite los tres contratos de proveedor", () => {
  it("las tres declaraciones parsean sin relajar el esquema", () => {
    for (const declaration of ALL) {
      expect(() => FiscalAdapterDeclarationSchema.parse(declaration)).not.toThrow();
    }
  });

  it("ninguna de las tres se contradice a sí misma", () => {
    for (const declaration of ALL) {
      expect(validateAdapterDeclaration(declaration)).toEqual([]);
    }
  });
});

describe("el hallazgo de §2 queda expresado, no aplanado", () => {
  it("el número de valores del cliente difiere: 2, 4 y 2", () => {
    const customerFields = (declaration: FiscalAdapterDeclaration): number =>
      declaration.credential.fields.filter((field) => field.source === "CUSTOMER").length;
    expect(customerFields(SIIGO)).toBe(2);
    expect(customerFields(FACTUS)).toBe(4);
    expect(customerFields(ALEGRA)).toBe(2);
  });

  it("sólo SIIGO exige un campo que aporta la plataforma", () => {
    expect(platformSuppliedFieldNames(SIIGO.credential)).toEqual(["partner_id"]);
    expect(platformSuppliedFieldNames(FACTUS.credential)).toEqual([]);
    expect(platformSuppliedFieldNames(ALEGRA.credential)).toEqual([]);
  });

  it("los tres transportes de autenticación son distintos", () => {
    expect(SIIGO.credential.transport).toBe("BEARER_TOKEN");
    expect(FACTUS.credential.transport).toBe("OAUTH2_PASSWORD_GRANT");
    expect(ALEGRA.credential.transport).toBe("HTTP_BASIC");
  });

  it("los tres ciclos de token son distintos, y sólo FACTUS tiene refresh", () => {
    expect(SIIGO.credential.tokenLifecycle).toBe("SHORT_LIVED_REAUTHENTICATE");
    expect(FACTUS.credential.tokenLifecycle).toBe("ACCESS_AND_REFRESH_TOKEN");
    expect(ALEGRA.credential.tokenLifecycle).toBe("LONG_LIVED_UNTIL_ROTATION");
  });

  it("SIIGO y ALEGRA documentan que la credencial nunca es la contraseña de la cuenta", () => {
    expect(SIIGO.credential.neverAccountPassword).toBe(true);
    expect(ALEGRA.credential.neverAccountPassword).toBe(true);
  });

  it("cada proveedor declara qué campos son secretos, y no coinciden", () => {
    expect(secretFieldNames(SIIGO.credential)).toEqual(["access_key"]);
    expect(secretFieldNames(FACTUS.credential)).toEqual(["client_secret", "password"]);
    expect(secretFieldNames(ALEGRA.credential)).toEqual(["api_token"]);
  });

  it("el límite de peticiones admite el desconocimiento de SIIGO sin inventar un número", () => {
    expect(SIIGO.rateLimit.kind).toBe("UNVERIFIED");
    expect(FACTUS.rateLimit).toMatchObject({ kind: "DECLARED", requestsPerMinute: 80 });
    expect(ALEGRA.rateLimit).toMatchObject({ kind: "DECLARED", requestsPerMinute: 150 });
  });
});

describe("ninguno de los tres puede reclamarse comercialmente hoy", () => {
  it("con verificación NOT_EVALUATED no hay tipo documental reclamable", () => {
    for (const declaration of ALL) {
      expect(overallVerification(declaration)).toBe("NOT_EVALUATED");
      expect(commerciallyClaimableDocumentTypes(declaration)).toEqual([]);
    }
  });

  it("MOCK_TESTED tampoco habilita reclamar: un fake verde no es el proveedor", () => {
    expect(
      commerciallyClaimableDocumentTypes({
        ...FACTUS,
        verification: { ...FACTUS.verification, DOCUMENT_ISSUANCE: "MOCK_TESTED" },
      }),
    ).toEqual([]);
  });

  it("manda el puerto de EMISIÓN, no el resto: autenticarse no es facturar", () => {
    // El caso real de FACTUS el 2026-09-06: configuración y rangos verificados
    // contra el proveedor, emisión sin ejecutar. Tener el canal abierto no
    // habilita a prometer que se factura.
    const canalAbierto = {
      ...FACTUS,
      verification: {
        FISCAL_CONFIGURATION_VALIDATION: "SANDBOX_VERIFIED",
        NUMBERING_RANGE: "SANDBOX_VERIFIED",
        DOCUMENT_ISSUANCE: "MOCK_TESTED",
        DOCUMENT_STATUS_QUERY: "MOCK_TESTED",
        DOCUMENT_ARTIFACT: "MOCK_TESTED",
      },
    } satisfies FiscalAdapterDeclaration;

    expect(commerciallyClaimableDocumentTypes(canalAbierto)).toEqual([]);
    // Y el adapter como conjunto vale lo que su puerto peor verificado.
    expect(overallVerification(canalAbierto)).toBe("MOCK_TESTED");
  });

  it("SANDBOX_VERIFIED en emisión sí habilita, y sólo lo que la matriz declara SUPPORTED", () => {
    expect(
      commerciallyClaimableDocumentTypes({
        ...ALEGRA,
        verification: { ...ALEGRA.verification, DOCUMENT_ISSUANCE: "SANDBOX_VERIFIED" },
      }),
    ).toEqual(["SALES_INVOICE", "CREDIT_NOTE"]);
  });

  it("un puerto declarado sin nivel de verificación es una afirmación a medias", () => {
    const findings = validateAdapterDeclaration({
      ...ALEGRA,
      verification: { DOCUMENT_ISSUANCE: "NOT_EVALUATED" },
    });
    expect(findings.map((finding) => finding.detail).sort()).toEqual([
      "DOCUMENT_ARTIFACT",
      "DOCUMENT_STATUS_QUERY",
      "FISCAL_CONFIGURATION_VALIDATION",
    ]);
  });
});

describe("la verificación cruzada detecta contradicciones reales", () => {
  it("rechaza declarar nota débito heredándola de la facturación genérica", () => {
    const findings = validateAdapterDeclaration({
      ...ALEGRA,
      supportedDocumentTypes: ["SALES_INVOICE", "DEBIT_NOTE"],
    });
    expect(findings.map((finding) => finding.code)).toEqual([
      "DOCUMENT_TYPE_WITHOUT_CAPABILITY",
      "DEBIT_NOTE_REQUIRES_OWN_CAPABILITY",
    ]);
  });

  it("rechaza declarar descarga de XML sin el puerto que la entrega", () => {
    const findings = validateAdapterDeclaration({
      ...ALEGRA,
      supportedPorts: ["DOCUMENT_ISSUANCE", "DOCUMENT_STATUS_QUERY", "FISCAL_CONFIGURATION_VALIDATION"],
    });
    expect(findings.map((finding) => finding.code)).toEqual(["ARTIFACT_CAPABILITY_WITHOUT_PORT"]);
  });

  it("rechaza declarar consulta de estado sin el puerto que la consulta", () => {
    const findings = validateAdapterDeclaration({
      ...FACTUS,
      supportedPorts: [
        "DOCUMENT_ISSUANCE",
        "DOCUMENT_ARTIFACT",
        "NUMBERING_RANGE",
        "FISCAL_CONFIGURATION_VALIDATION",
      ],
    });
    expect(findings.map((finding) => finding.code)).toEqual([
      "STATUS_QUERY_CAPABILITY_WITHOUT_PORT",
    ]);
  });
});
