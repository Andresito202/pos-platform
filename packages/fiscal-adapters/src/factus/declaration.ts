import type { FiscalAdapterDeclaration } from "../adapter-declaration.js";

/**
 * Declaración del adapter FACTUS.
 *
 * Transcribe `provider-integration-matrix.md` (verificada contra documentación
 * oficial el 2026-08-17; la fila de credenciales quedó confirmada además contra
 * credenciales de sandbox reales el 2026-09-06).
 *
 * **`verification` es `MOCK_TESTED` y no puede ser otra cosa hoy.** Los
 * contract tests corren contra un fake determinista, y `D-4` ratificada fija el
 * techo de esa fuente de evidencia. `SANDBOX_VERIFIED` exige ejecutar la suite
 * de sandbox con credenciales reales, cosa que CI no hace y que este entorno no
 * puede hacer: `api-sandbox.factus.com.co` responde 403 al túnel de salida.
 */
export const FACTUS_ADAPTER_DECLARATION: FiscalAdapterDeclaration = {
  provider: "FACTUS",
  adapterVersion: "0.1.0",
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
    // El índice oficial menciona «suscripciones», lo que no demuestra por sí
    // solo recepción webhook compatible con este contrato.
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
  verification: "MOCK_TESTED",
  rateLimit: {
    kind: "DECLARED",
    requestsPerMinute: 80,
    scope: "USER",
    honoursRetryAfter: true,
  },
  quota: {
    kind: "NOT_EVALUATED",
    reason: "bolsa anual divisible entre NITs, sin endpoint de saldo verificado",
  },
};
