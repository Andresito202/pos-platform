/**
 * Fecha comercial canónica para vencimientos e inventario.
 *
 * `business_date` / `expiry_date` son calendarios YYYY-MM-DD, no instantes UTC.
 * La evaluación de elegibilidad de lote usa la zona horaria comercial autorizada
 * de la sucursal — para Colombia: America/Bogota — no la zona del proceso ni
 * `Date#toISOString().slice(0,10)`.
 *
 * Política: un lote con `expiry_date = D` permanece elegible durante todo el
 * día comercial D (`expiry_date >= commercialDate`). Las marcas UTC de
 * auditoría (`created_at`, `occurred_at`, etc.) no usan esta función.
 *
 * Fuente normativa: conceptual-data-model § Tiempo técnico y fecha comercial.
 */

/** Zona comercial autorizada para Camacho POS Colombia. */
export const COMMERCIAL_TIMEZONE_ID = "America/Bogota";

const BUSINESS_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Deriva la fecha comercial YYYY-MM-DD de un instante UTC en la zona dada.
 * No depende de la zona horaria del sistema operativo.
 */
export function commercialBusinessDate(
  instant: Date,
  timeZoneId: string = COMMERCIAL_TIMEZONE_ID,
): string {
  if (Number.isNaN(instant.getTime())) {
    throw new Error("COMMERCIAL_DATE_INVALID_INSTANT");
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZoneId,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error("COMMERCIAL_DATE_UNRESOLVED");
  }
  const value = `${year}-${month}-${day}`;
  if (!BUSINESS_DATE.test(value)) {
    throw new Error("COMMERCIAL_DATE_MALFORMED");
  }
  return value;
}

/** Lote sin vencimiento, o con vencimiento ≥ fecha comercial, es elegible. */
export function isLotEligibleOnCommercialDate(
  expiryDate: string | null,
  commercialDate: string,
): boolean {
  return expiryDate === null || expiryDate >= commercialDate;
}
