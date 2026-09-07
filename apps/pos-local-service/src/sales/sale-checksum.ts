import { createHash } from "node:crypto";
import { canonicalJson } from "../channel/canonical-json.js";
import type { SaleLineCalculation, SaleTotalsCalculation } from "./sale-calculation.js";
import { bigIntToScale6 } from "../money.js";

/**
 * SALE_CALCULATION_CHECKSUM_V1 (BLOQUE 4C).
 *
 * SHA-256 sobre canonicalJson de las entradas y resultados de cálculo.
 * Los montos y cantidades se representan como strings de escala 6.
 *
 * Excluidos explícitamente (no determinísticos o de ciclo de vida):
 * timestamps, actor, operation_id, document series/number, idempotency,
 * correlation, version, status.
 */

export interface SaleChecksumLineInput {
  readonly product_id: string;
  readonly presentation_id: string;
  readonly quantity: string;
  readonly unit_price_amount: string;
  readonly gross_amount: string;
  readonly discount_amount: string;
  readonly taxable_amount: string;
  readonly tax_amount: string;
  readonly line_total_amount: string;
}

export interface SaleChecksumInput {
  readonly schema_version: 1;
  readonly pipeline_version: string;
  readonly tax_policy_version: string;
  readonly rounding_policy_version: string;
  readonly currency_code: string;
  readonly lines: readonly SaleChecksumLineInput[];
  readonly subtotal_amount: string;
  readonly discount_amount: string;
  readonly tax_amount: string;
  readonly fiscal_total_amount: string;
  readonly commercial_rounding_adjustment: string;
  readonly payable_amount: string;
}

/**
 * Construye el payload de checksum a partir de los datos de cálculo.
 * Los nulos explícitos se incluyen (discount_amount = "0.000000", tax_amount = "0.000000").
 */
export function buildChecksumInput(
  pipelineVersion: string,
  taxPolicyVersion: string,
  roundingPolicyVersion: string,
  currencyCode: string,
  lines: ReadonlyArray<{
    productId: string;
    presentationId: string;
    calculation: SaleLineCalculation;
  }>,
  totals: SaleTotalsCalculation,
): SaleChecksumInput {
  return {
    schema_version: 1,
    pipeline_version: pipelineVersion,
    tax_policy_version: taxPolicyVersion,
    rounding_policy_version: roundingPolicyVersion,
    currency_code: currencyCode,
    lines: lines.map((line) => ({
      product_id: line.productId,
      presentation_id: line.presentationId,
      quantity: bigIntToScale6(line.calculation.quantityUnits),
      unit_price_amount: bigIntToScale6(line.calculation.unitPriceUnits),
      gross_amount: bigIntToScale6(line.calculation.grossUnits),
      discount_amount: bigIntToScale6(line.calculation.discountUnits),
      taxable_amount: bigIntToScale6(line.calculation.taxableUnits),
      tax_amount: bigIntToScale6(line.calculation.taxUnits),
      line_total_amount: bigIntToScale6(line.calculation.lineTotalUnits),
    })),
    subtotal_amount: bigIntToScale6(totals.subtotalUnits),
    discount_amount: bigIntToScale6(totals.discountUnits),
    tax_amount: bigIntToScale6(totals.taxUnits),
    fiscal_total_amount: bigIntToScale6(totals.fiscalTotalUnits),
    commercial_rounding_adjustment: bigIntToScale6(totals.commercialRoundingAdjustmentUnits),
    payable_amount: bigIntToScale6(totals.payableUnits),
  };
}

export function computeSaleChecksum(input: SaleChecksumInput): string {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}
