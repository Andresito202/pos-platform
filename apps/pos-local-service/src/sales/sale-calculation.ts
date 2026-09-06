/**
 * PRICING_PIPELINE_V1 simplificado para BLOQUE 4C SANDBOX.
 *
 * Alcance autorizado: Tax EXCLUDED (0%), sin descuentos ni promociones.
 * Las cantidades son exactas como BigInt con escala 6 implícita (1 COP = 1_000_000 units).
 *
 * NEAREST_50_HALF_AWAY_FROM_ZERO_V1 (DEC-006):
 *   Para x >= 0: floor((x + 25) / 50) * 50
 *   Para x < 0:  ceil((x - 25) / 50) * 50
 * Todo en BigInt para evitar errores de punto flotante.
 */

const SCALE = 1_000_000n; // escala 6: 1 COP = 1_000_000 units
const ROUNDING_INCREMENT = 50n * SCALE;
const ROUNDING_HALF = 25n * SCALE;

/** Convierte un TEXT de escala 6 a BigInt con escala 6 implícita. */
export function scale6ToBigInt(text: string): bigint {
  // Valida formato: dígitos, un punto, exactamente 6 dígitos decimales
  if (!/^\d+\.\d{6}$/.test(text)) {
    throw new Error(`invalid scale-6 amount: ${text}`);
  }
  const [integer, fractional] = text.split(".") as [string, string];
  return BigInt(integer) * SCALE + BigInt(fractional);
}

/** Convierte BigInt con escala 6 implícita a TEXT de escala 6. */
export function bigIntToScale6(value: bigint): string {
  if (value < 0n) {
    return `-${bigIntToScale6(-value)}`;
  }
  const integer = value / SCALE;
  const fractional = value % SCALE;
  return `${integer}.${fractional.toString().padStart(6, "0")}`;
}

/** NEAREST_50_HALF_AWAY_FROM_ZERO_V1 (DEC-006). Entrada y salida en BigInt escala 6. */
export function nearestFiftyHalfAwayFromZero(value: bigint): bigint {
  if (value >= 0n) {
    return ((value + ROUNDING_HALF) / ROUNDING_INCREMENT) * ROUNDING_INCREMENT;
  }
  // Para negativos: ceil((x - 25) / 50) * 50 equivale a:
  // -(floor((-x + 25) / 50) * 50)
  return -((((-value) + ROUNDING_HALF) / ROUNDING_INCREMENT) * ROUNDING_INCREMENT);
}

/** Resultado de la línea de venta calculada por PRICING_PIPELINE_V1. */
export interface SaleLineCalculation {
  /** Precio unitario congelado, BigInt escala 6. */
  readonly unitPriceUnits: bigint;
  /** Cantidad en BigInt escala 6. */
  readonly quantityUnits: bigint;
  /** gross_amount = unit_price * quantity, truncado a escala 6. */
  readonly grossUnits: bigint;
  /** SANDBOX: sin descuentos. */
  readonly discountUnits: 0n;
  /** taxable_amount = gross - discount. */
  readonly taxableUnits: bigint;
  /** SANDBOX Tax EXCLUDED: siempre 0. */
  readonly taxUnits: 0n;
  /** line_total = taxable_amount + tax_amount. */
  readonly lineTotalUnits: bigint;
}

/** Totales del sale calculados por PRICING_PIPELINE_V1. */
export interface SaleTotalsCalculation {
  readonly subtotalUnits: bigint;
  readonly discountUnits: bigint;
  readonly taxUnits: bigint;
  readonly fiscalTotalUnits: bigint;
  readonly commercialRoundingAdjustmentUnits: bigint;
  readonly payableUnits: bigint;
}

/**
 * Calcula una línea de venta siguiendo PRICING_PIPELINE_V1 (DEC-003) para
 * SANDBOX: Tax EXCLUDED, sin descuentos.
 *
 * gross_amount = floor(unit_price * quantity) a escala 6.
 */
export function calculateSaleLine(
  unitPriceText: string,
  quantityText: string,
): SaleLineCalculation {
  const unitPriceUnits = scale6ToBigInt(unitPriceText);
  const quantityUnits = scale6ToBigInt(quantityText);

  if (unitPriceUnits <= 0n) throw new Error("unit price must be positive");
  if (quantityUnits <= 0n) throw new Error("quantity must be positive");

  // gross = floor(unit_price * quantity / SCALE)  — producto a escala 12, truncar a 6
  const grossUnits = (unitPriceUnits * quantityUnits) / SCALE;

  const taxableUnits = grossUnits;
  const lineTotalUnits = taxableUnits;

  return {
    unitPriceUnits,
    quantityUnits,
    grossUnits,
    discountUnits: 0n,
    taxableUnits,
    taxUnits: 0n,
    lineTotalUnits,
  };
}

/**
 * Calcula los totales del sale a partir de las líneas.
 * Aplica NEAREST_50_HALF_AWAY_FROM_ZERO_V1 al total fiscal para obtener el
 * payable_amount.
 */
export function calculateSaleTotals(lines: readonly SaleLineCalculation[]): SaleTotalsCalculation {
  if (lines.length === 0) throw new Error("sale must have at least one line");

  let subtotalUnits = 0n;
  let discountUnits = 0n;
  let taxUnits = 0n;

  for (const line of lines) {
    subtotalUnits += line.grossUnits;
    discountUnits += line.discountUnits;
    taxUnits += line.taxUnits;
  }

  const fiscalTotalUnits = subtotalUnits - discountUnits + taxUnits;
  const payableUnits = nearestFiftyHalfAwayFromZero(fiscalTotalUnits);
  const commercialRoundingAdjustmentUnits = payableUnits - fiscalTotalUnits;

  return {
    subtotalUnits,
    discountUnits,
    taxUnits,
    fiscalTotalUnits,
    commercialRoundingAdjustmentUnits,
    payableUnits,
  };
}
