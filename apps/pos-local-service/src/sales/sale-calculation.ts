/**
 * PRICING_PIPELINE_V1 simplificado para BLOQUE 4C SANDBOX.
 *
 * Alcance: impuesto por línea a partir de la tasa que declara el catálogo, sin
 * descuentos ni promociones. La tasa es opcional: una presentación sin atributos
 * fiscales produce impuesto cero, y el snapshot de la línea deja constancia de
 * que ese cero es desconocimiento, no exención.
 * Las cantidades son exactas como BigInt con escala 6 implícita (1 COP = 1_000_000 units).
 *
 * NEAREST_50_HALF_AWAY_FROM_ZERO_V1 (DEC-006):
 *   Para x >= 0: floor((x + 25) / 50) * 50
 *   Para x < 0:  ceil((x - 25) / 50) * 50
 * Todo en BigInt para evitar errores de punto flotante.
 */

import { scale6ToBigInt } from "../money.js";

const SCALE = 1_000_000n; // escala 6: 1 COP = 1_000_000 units
const ROUNDING_INCREMENT = 50n * SCALE;
const ROUNDING_HALF = 25n * SCALE;

/**
 * ¿La cantidad cabe en la precisión que declara la unidad?
 *
 * `unit_precision` existía en el catálogo, se arrastraba hasta el snapshot de la
 * línea y **no gobernaba nada**: el contrato IPC acepta cualquier escala 6
 * porque no ve el catálogo, así que sin esta comprobación se podía vender
 * `0.000001` de una botella y cobrarlo.
 *
 * Importa a los dos extremos del catálogo de comercios objetivo:
 *
 * - una **tienda, licorera o papelería** vende unidades discretas
 *   (`unit_precision` 0): media unidad es un error de captura, no una venta;
 * - una **carnicería o un fruver** venden por peso (`unit_precision` 3): tres
 *   decimales son legítimos y seis no, y además seis no se pueden facturar
 *   —el proveedor acepta dos— (`D-14`).
 *
 * Se comprueba sobre el texto y no sobre un número: convertir a `number` para
 * contar decimales metería coma flotante en la única ruta que decide qué se
 * cobra.
 */
export function quantityFitsUnitPrecision(quantityText: string, unitPrecision: number): boolean {
  const fractional = quantityText.split(".")[1];
  if (fractional === undefined) return true;
  return /^0*$/.test(fractional.slice(unitPrecision));
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
  /**
   * Impuesto de la línea. Cero **sólo** cuando la presentación no declara
   * atributos fiscales, y en ese caso el snapshot de la línea lo dice: cero por
   * desconocimiento no es lo mismo que cero por exención.
   */
  readonly taxUnits: bigint;
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
  taxRateText: string | null = null,
): SaleLineCalculation {
  const unitPriceUnits = scale6ToBigInt(unitPriceText);
  const quantityUnits = scale6ToBigInt(quantityText);

  if (unitPriceUnits <= 0n) throw new Error("unit price must be positive");
  if (quantityUnits <= 0n) throw new Error("quantity must be positive");

  // gross = floor(unit_price * quantity / SCALE)  — producto a escala 12, truncar a 6
  const grossUnits = (unitPriceUnits * quantityUnits) / SCALE;

  const taxableUnits = grossUnits;

  // impuesto = base × tasa / 100, truncado a escala 6.
  //
  // Trunca porque es lo que ya hace `grossUnits`, y porque el total pagadero
  // pasa después por NEAREST_50: la diferencia entre truncar y redondear queda
  // cuatro órdenes de magnitud por debajo del incremento que llega al cliente.
  // La regla exacta de redondeo de la DIAN no está verificada en este
  // repositorio (`D-16`); lo que sí está fijado es que aquí no hay coma
  // flotante.
  const taxUnits = taxRateText === null
    ? 0n
    : (taxableUnits * scale6ToBigInt(taxRateText)) / (100n * SCALE);

  const lineTotalUnits = taxableUnits + taxUnits;

  return {
    unitPriceUnits,
    quantityUnits,
    grossUnits,
    discountUnits: 0n,
    taxableUnits,
    taxUnits,
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
