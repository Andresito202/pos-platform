/** Shared unit-precision check, formerly under sales/sale-calculation.
 * Inputs must already have the canonical quantity shape and a validated
 * unit precision; this function is not an authorization/normalization boundary.
 */
export function quantityFitsUnitPrecision(quantityText: string, unitPrecision: number): boolean {
  const fractional = quantityText.split(".")[1];
  if (fractional === undefined) return true;
  return /^0*$/.test(fractional.slice(unitPrecision));
}
