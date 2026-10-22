import { bigIntToScale6, scale6ToBigInt } from "../money.js";
import { quantityFitsUnitPrecision } from "../quantity.js";

const QUANTITY = /^(0|[1-9]\d{0,12})\.\d{6}$/; // numeric(19,6), TECH-002E
const FACTOR = /^(0|[1-9]\d{0,8})\.\d{10}$/; // numeric(19,10), TECH-002D
const FACTOR_SCALE = 10_000_000_000n;
const MAX_QUANTITY = 9_999_999_999_999_999_999n;

function quantityUnits(value: string, precision: number): bigint {
  if (!Number.isInteger(precision) || precision < 0 || precision > 6) throw new Error("INVENTORY_UNIT_PRECISION_INVALID");
  if (!QUANTITY.test(value)) throw new Error("INVENTORY_QUANTITY_INVALID");
  const units = scale6ToBigInt(value);
  if (units <= 0n) throw new Error("INVENTORY_QUANTITY_NOT_POSITIVE");
  if (!quantityFitsUnitPrecision(value, precision)) throw new Error("INVENTORY_QUANTITY_PRECISION_EXCEEDED");
  return units;
}

/** Arithmetic only for UC-INVENTORY-001: caller must first resolve a published,
 * current, scoped unit-conversion rule and preserve its ID/factor/version.
 * Neither this factor nor a computed number grants authority to post stock.
 * There is no rounding/loss policy fallback: a non-exact receipt is rejected.
 */
export function convertReceiptQuantity(sourceQuantity: string, factor: string, sourcePrecision: number, inventoryPrecision: number): string {
  const source = quantityUnits(sourceQuantity, sourcePrecision);
  if (!FACTOR.test(factor)) throw new Error("INVENTORY_CONVERSION_FACTOR_INVALID");
  const factorUnits = BigInt(factor.replace(".", ""));
  if (factorUnits <= 0n) throw new Error("INVENTORY_CONVERSION_FACTOR_INVALID");
  const product = source * factorUnits;
  if (product % FACTOR_SCALE !== 0n) throw new Error("INVENTORY_CONVERSION_NOT_EXACT");
  const resultUnits = product / FACTOR_SCALE;
  if (resultUnits > MAX_QUANTITY) throw new Error("INVENTORY_QUANTITY_OVERFLOW");
  const result = bigIntToScale6(resultUnits);
  quantityUnits(result, inventoryPrecision);
  return result;
}

/** Allocations describe the receipt line, never additional receipts. No stock
 * mutation, lot creation, deduplication or cost/price inference occurs here.
 */
export function validateReceiptAllocationQuantities(inventoryQuantity: string, allocations: readonly string[], inventoryPrecision: number): void {
  const expected = quantityUnits(inventoryQuantity, inventoryPrecision);
  if (allocations.length === 0 || allocations.length > 1000) throw new Error("INVENTORY_ALLOCATIONS_INVALID");
  const actual = allocations.reduce((total, quantity) => total + quantityUnits(quantity, inventoryPrecision), 0n);
  if (actual !== expected) throw new Error("INVENTORY_ALLOCATIONS_QUANTITY_MISMATCH");
}
