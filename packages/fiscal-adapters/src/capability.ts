import * as z from "zod";

/**
 * Matriz de capacidades del proveedor (`electronic-invoicing.md` §Matriz).
 *
 * Los dominios de estado **no son uniformes** y no se uniformizan aquí: la
 * idempotencia externa admite `UNKNOWN` en lugar de `UNVERIFIED`, y la
 * contingencia admite `REQUIRES_MANUAL_PROCESS`. Colapsarlos en una sola enum
 * borraría justo la información que distingue «no lo soporta» de «no lo hemos
 * comprobado» y de «existe, pero es manual».
 */

const GENERAL_STATES = ["SUPPORTED", "UNSUPPORTED", "UNVERIFIED"] as const;
const IDEMPOTENCY_STATES = ["SUPPORTED", "UNSUPPORTED", "UNKNOWN"] as const;
const CONTINGENCY_STATES = [
  "SUPPORTED",
  "UNSUPPORTED",
  "REQUIRES_MANUAL_PROCESS",
  "UNVERIFIED",
] as const;

export type GeneralCapabilityState = (typeof GENERAL_STATES)[number];
export type IdempotencyCapabilityState = (typeof IDEMPOTENCY_STATES)[number];
export type ContingencyCapabilityState = (typeof CONTINGENCY_STATES)[number];

export const GeneralCapabilityStateSchema = z.enum(GENERAL_STATES);
export const IdempotencyCapabilityStateSchema = z.enum(IDEMPOTENCY_STATES);
export const ContingencyCapabilityStateSchema = z.enum(CONTINGENCY_STATES);

export const FiscalCapabilityMatrixSchema = z.strictObject({
  invoiceIssuance: GeneralCapabilityStateSchema,
  creditNote: GeneralCapabilityStateSchema,
  debitNote: GeneralCapabilityStateSchema,
  supportDocument: GeneralCapabilityStateSchema,
  statusQuery: GeneralCapabilityStateSchema,
  xmlDownload: GeneralCapabilityStateSchema,
  pdfDownload: GeneralCapabilityStateSchema,
  externalIdempotency: IdempotencyCapabilityStateSchema,
  webhook: GeneralCapabilityStateSchema,
  contingency: ContingencyCapabilityStateSchema,
});

export type FiscalCapabilityMatrix = z.infer<typeof FiscalCapabilityMatrixSchema>;

/**
 * Códigos físicos iniciales de capability (`electronic-invoicing.md` §Matriz).
 *
 * Nota débito exige `DEBIT_NOTES` y **no hereda** soporte de facturación
 * genérica.
 */
export const FISCAL_CAPABILITY_CODES = [
  "ELECTRONIC_INVOICING",
  "CREDIT_NOTES",
  "DEBIT_NOTES",
  "SUPPORT_DOCUMENTS",
] as const;

export type FiscalCapabilityCode = (typeof FISCAL_CAPABILITY_CODES)[number];

export const FiscalCapabilityCodeSchema = z.enum(FISCAL_CAPABILITY_CODES);

/**
 * Tipos documentales canónicos (`electronic-invoicing.md` §Tipos canónicos).
 */
export const FISCAL_DOCUMENT_TYPES = [
  "SALES_INVOICE",
  "CREDIT_NOTE",
  "DEBIT_NOTE",
  "SUPPORT_DOCUMENT",
  "SUPPORT_DOCUMENT_ADJUSTMENT_NOTE",
] as const;

export type FiscalDocumentType = (typeof FISCAL_DOCUMENT_TYPES)[number];

export const FiscalDocumentTypeSchema = z.enum(FISCAL_DOCUMENT_TYPES);

const CAPABILITY_CODE_FOR_DOCUMENT_TYPE: Readonly<
  Record<FiscalDocumentType, FiscalCapabilityCode>
> = {
  SALES_INVOICE: "ELECTRONIC_INVOICING",
  CREDIT_NOTE: "CREDIT_NOTES",
  DEBIT_NOTE: "DEBIT_NOTES",
  SUPPORT_DOCUMENT: "SUPPORT_DOCUMENTS",
  SUPPORT_DOCUMENT_ADJUSTMENT_NOTE: "SUPPORT_DOCUMENTS",
};

export function capabilityCodeForDocumentType(
  documentType: FiscalDocumentType,
): FiscalCapabilityCode {
  return CAPABILITY_CODE_FOR_DOCUMENT_TYPE[documentType];
}

/**
 * Las cuatro filas de la matriz que corresponden a un tipo documental. Se
 * nombran aparte para que el acceso indexado conserve
 * `GeneralCapabilityState` y no se ensanche con los dominios de idempotencia y
 * contingencia, que no aplican a un tipo documental.
 */
type DocumentCapabilityKey =
  | "invoiceIssuance"
  | "creditNote"
  | "debitNote"
  | "supportDocument";

const MATRIX_KEY_FOR_CAPABILITY_CODE: Readonly<
  Record<FiscalCapabilityCode, DocumentCapabilityKey>
> = {
  ELECTRONIC_INVOICING: "invoiceIssuance",
  CREDIT_NOTES: "creditNote",
  DEBIT_NOTES: "debitNote",
  SUPPORT_DOCUMENTS: "supportDocument",
};

export function matrixStateForDocumentType(
  matrix: FiscalCapabilityMatrix,
  documentType: FiscalDocumentType,
): GeneralCapabilityState {
  const code = capabilityCodeForDocumentType(documentType);
  return matrix[MATRIX_KEY_FOR_CAPABILITY_CODE[code]];
}

/**
 * `UNVERIFIED` nunca se presenta comercialmente como soporte
 * (`electronic-invoicing.md` §Matriz).
 *
 * Sólo `SUPPORTED` es reclamable, y sólo cuando existe evidencia ejecutada
 * contra el proveedor: un fake determinista sostiene `MOCK_TESTED`, y
 * `MOCK_TESTED` no es compatibilidad con el proveedor (`D-4` ratificada).
 */
export function isCommerciallyClaimable(
  state: GeneralCapabilityState | IdempotencyCapabilityState | ContingencyCapabilityState,
): boolean {
  return state === "SUPPORTED";
}
