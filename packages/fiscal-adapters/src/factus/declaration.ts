import type { FiscalAdapterDeclaration } from "../adapter-declaration.js";

/**
 * Declaración del adapter FACTUS.
 *
 * Transcribe `provider-integration-matrix.md` (verificada contra documentación
 * oficial el 2026-08-17; la fila de credenciales quedó confirmada además contra
 * credenciales de sandbox reales el 2026-09-06).
 *
 * ## Verificación por puerto — evidencia del 2026-09-06
 *
 * La suite de sandbox se ejecutó contra `api-sandbox.factus.com.co` con
 * credenciales V2 reales y pasó: **103 de 103**.
 *
 * | Puerto | Nivel | Por qué |
 * |---|---|---|
 * | `FISCAL_CONFIGURATION_VALIDATION` | `SANDBOX_VERIFIED` | OAuth2 password grant contra el proveedor real y `validateConfiguration` devolviendo `VALID` |
 * | `NUMBERING_RANGE` | `SANDBOX_VERIFIED` | rangos reales sincronizados, con `id` de FACTUS, autoridad `PROVIDER` y vigencia declarada |
 * | `DOCUMENT_ISSUANCE` | `MOCK_TESTED` | **no se ha emitido ni un documento** |
 * | `DOCUMENT_STATUS_QUERY` | `MOCK_TESTED` | sin documento que consultar |
 * | `DOCUMENT_ARTIFACT` | `MOCK_TESTED` | sin documento del que bajar XML o PDF |
 *
 * Los tres `MOCK_TESTED` no lo están por falta de ganas: emitir exige
 * `Customer`, las tablas de códigos DIAN, `Catalog` y `Tax`, y **ninguna de las
 * cuatro existe** (`D-9`). El bloqueo es nuestro, no del proveedor.
 *
 * Por eso `overallVerification` de este adapter es `MOCK_TESTED`: un adapter no
 * está más verificado que su puerto peor verificado.
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
  verification: {
    FISCAL_CONFIGURATION_VALIDATION: "SANDBOX_VERIFIED",
    NUMBERING_RANGE: "SANDBOX_VERIFIED",
    DOCUMENT_ISSUANCE: "MOCK_TESTED",
    DOCUMENT_STATUS_QUERY: "MOCK_TESTED",
    DOCUMENT_ARTIFACT: "MOCK_TESTED",
  },
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
