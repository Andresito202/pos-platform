import * as z from "zod";
import type { FiscalDocumentType } from "../capability.js";

/**
 * Tablas de códigos DIAN — el primer trozo de `D-9`.
 *
 * ## Por qué existe
 *
 * Ningún proveedor acepta una factura sin estos códigos: el cuerpo de emisión
 * exige `identification_document_code`, `municipality_code`,
 * `unit_measure_code`, `standard_code`, `tribute_code`, códigos de impuesto y
 * de forma y método de pago. El POS no los tenía, y por eso `D-9` bloquea la
 * emisión con independencia del proveedor.
 *
 * ## Regla de este archivo
 *
 * **Sólo entran códigos con fuente verificada.** Cada tabla declara de dónde
 * sale. Aquí no se completa un catálogo «porque debería ser así»: un código DIAN
 * equivocado produce una factura rechazada o, peor, aceptada con un dato falso.
 *
 * Fuente de todo lo que hay hoy: la documentación oficial de emisión de FACTUS
 * (`facturas-crear-y-validar`), aportada por el propietario el 2026-09-06.
 * Nivel `VERIFICADO_DOC`.
 *
 * **Estas tablas son PARCIALES y lo dicen.** Cubren lo que la documentación
 * ejemplifica, no el catálogo DIAN completo. Cada consulta devuelve `null` para
 * un código no listado, y `null` significa «no lo sé», nunca «no existe».
 */

/** Procedencia de un código. Sin esto, una tabla es una lista de suposiciones. */
export const CODE_SOURCES = ["FACTUS_OFFICIAL_DOC", "DIAN_OFFICIAL", "UNVERIFIED"] as const;

export type CodeSource = (typeof CODE_SOURCES)[number];

export interface DianCode {
  readonly code: string;
  readonly label: string;
  readonly source: CodeSource;
}

function table(entries: readonly DianCode[]): ReadonlyMap<string, DianCode> {
  return new Map(entries.map((entry) => [entry.code, entry]));
}

const D = "FACTUS_OFFICIAL_DOC" as const;

/**
 * Tipo de documento electrónico. `document` en el cuerpo de emisión.
 *
 * `"01"` es el único con etiqueta verificada en la documentación. `"03"` se
 * incluye porque la misma documentación lo nombra al exigir `related_documents`,
 * pero **sin etiqueta confirmada**, y por eso no se traduce a un tipo canónico.
 */
export const DOCUMENT_TYPE_CODES = table([
  { code: "01", label: "Factura electrónica de Venta", source: D },
]);

/** Tipo de operación. `operation_type` en el cuerpo de emisión. */
export const OPERATION_TYPE_CODES = table([
  { code: "10", label: "Estándar", source: D },
  { code: "11", label: "Mandatos", source: D },
  { code: "12", label: "Transporte", source: D },
]);

/** Tipo de documento de identificación del adquiriente. */
export const IDENTIFICATION_DOCUMENT_CODES = table([
  { code: "13", label: "Cédula de ciudadanía", source: D },
  { code: "31", label: "NIT", source: D },
]);

/** Naturaleza jurídica. Decide si es obligatorio `company` o `names`. */
export const LEGAL_ORGANIZATION_CODES = table([
  { code: "1", label: "Persona jurídica", source: D },
  { code: "2", label: "Persona natural", source: D },
]);

/** Tributo del adquiriente. `"ZZ"` es el valor por defecto documentado. */
export const TRIBUTE_CODES = table([
  { code: "ZZ", label: "No aplica", source: D },
]);

/** Responsabilidad fiscal. `["R-99-PN"]` es el valor por defecto documentado. */
export const FISCAL_RESPONSIBILITY_CODES = table([
  { code: "R-99-PN", label: "No responsable", source: D },
]);

/** Unidad de medida del ítem. */
export const UNIT_MEASURE_CODES = table([
  { code: "94", label: "Unidad", source: D },
]);

/** Estándar de código de producto. */
export const PRODUCT_STANDARD_CODES = table([
  { code: "999", label: "Adopción del contribuyente", source: D },
]);

/** Impuesto por línea de ítem. */
export const TAX_CODES = table([
  { code: "01", label: "IVA", source: D },
  { code: "04", label: "INC", source: D },
]);

/** Forma de pago: contado o crédito. Con `"2"`, `due_date` pasa a obligatorio. */
export const PAYMENT_FORM_CODES = table([
  { code: "1", label: "Contado", source: D },
  { code: "2", label: "Crédito", source: D },
]);

/** Método de pago. */
export const PAYMENT_METHOD_CODES = table([
  { code: "10", label: "Efectivo", source: D },
  { code: "42", label: "Consignación", source: D },
]);

/**
 * Correspondencia entre el código documental del proveedor y el tipo canónico.
 *
 * Fuentes verificadas en tablas oficiales FACTUS (`tablas-de-referencia/tablas`):
 * - `"01"` — tipo documental DIAN en cuerpo de factura (histórico sandbox).
 * - `"21"` — código de rango de numeración «Factura de Venta».
 * - `"22"` — código de rango de numeración «Nota Crédito».
 * - `"23"`, `"24"`, `"25"` — nota débito, documento soporte y nota de ajuste.
 * Las etiquetas se contrastaron con la respuesta sandbox del 2026-11-18.
 */
const DOCUMENT_TYPE_BY_CODE: ReadonlyMap<string, FiscalDocumentType> = new Map([
  ["01", "SALES_INVOICE"],
  ["21", "SALES_INVOICE"],
  ["22", "CREDIT_NOTE"],
  ["23", "DEBIT_NOTE"],
  ["24", "SUPPORT_DOCUMENT"],
  ["25", "SUPPORT_DOCUMENT_ADJUSTMENT_NOTE"],
]);

/**
 * Traduce el código (o nombre observado) del proveedor a tipo canónico.
 *
 * Algunos GET de `/v2/numbering-ranges` devuelven el nombre («Nota Crédito»)
 * en `document`; se aceptan sólo esas etiquetas documentadas por FACTUS.
 */
export function fiscalDocumentTypeForCode(code: string | null): FiscalDocumentType | null {
  if (code === null) return null;
  const normalized = code.trim();
  const mapped = DOCUMENT_TYPE_BY_CODE.get(normalized);
  if (mapped !== undefined) return mapped;
  const lower = normalized.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  if (lower === "nota credito" || lower === "nota de credito") return "CREDIT_NOTE";
  if (lower === "nota debito" || lower === "nota de debito") return "DEBIT_NOTE";
  if (lower === "factura de venta" || lower === "factura electronica de venta") return "SALES_INVOICE";
  if (lower === "documento soporte") return "SUPPORT_DOCUMENT";
  if (lower === "nota de ajuste documento soporte" || lower === "nota de ajuste de documento soporte") return "SUPPORT_DOCUMENT_ADJUSTMENT_NOTE";
  return null;
}

/**
 * Código DIAN para el cuerpo de emisión de **factura** (`document`).
 * Las notas crédito usan `/v2/credit-notes/validate` y no este campo.
 */
export function canonicalDocumentTypeCode(type: FiscalDocumentType): string | null {
  if (type === "SALES_INVOICE") return "01";
  return null;
}

/**
 * Código de documento para rangos de numeración FACTUS (`filter[document]`).
 * Fuente: tablas oficiales — `21` a `25`. Clasificar un rango no habilita emisión.
 */
export function numberingDocumentTypeCode(type: FiscalDocumentType): string | null {
  if (type === "SALES_INVOICE") return "21";
  if (type === "CREDIT_NOTE") return "22";
  if (type === "DEBIT_NOTE") return "23";
  if (type === "SUPPORT_DOCUMENT") return "24";
  if (type === "SUPPORT_DOCUMENT_ADJUSTMENT_NOTE") return "25";
  return null;
}

/** Busca un código en una tabla. `null` si no está listado. */
export function lookupCode(
  codes: ReadonlyMap<string, DianCode>,
  code: string | null | undefined,
): DianCode | null {
  if (code === null || code === undefined) return null;
  return codes.get(code) ?? null;
}

/** `true` sólo si el código está listado **y** su fuente es verificada. */
export function isVerifiedCode(
  codes: ReadonlyMap<string, DianCode>,
  code: string | null | undefined,
): boolean {
  const found = lookupCode(codes, code);
  return found !== null && found.source !== "UNVERIFIED";
}

/**
 * Regla documentada que no es un código pero se comprueba con ellos: persona
 * jurídica exige `company`, persona natural exige `names`.
 */
export function requiredCustomerNameField(
  legalOrganizationCode: string,
): "company" | "names" | null {
  if (legalOrganizationCode === "1") return "company";
  if (legalOrganizationCode === "2") return "names";
  return null;
}

/** `due_date` es obligatorio sólo cuando la forma de pago es crédito. */
export function paymentRequiresDueDate(paymentFormCode: string): boolean {
  return paymentFormCode === "2";
}

export const DianCodeSchema = z.strictObject({
  code: z.string().min(1).max(16),
  label: z.string().min(1).max(120),
  source: z.enum(CODE_SOURCES),
});
