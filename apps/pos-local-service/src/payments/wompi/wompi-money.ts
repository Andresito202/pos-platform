import { bigIntToScale6, scale6ToBigInt } from "../../money.js";

/**
 * POS money is the canonical scale-6 `TEXT`/`BigInt` representation in
 * `../../money.js` — the single source of truth after this app had two
 * diverging money parsers (see that file's history). Wompi's COP API works
 * in integer centavos (scale-2): four fewer decimal digits than scale-6.
 */
const CENTS_PER_SCALE6_UNIT = 10_000n;

export function amountToCents(amount: string): string {
  const units = scale6ToBigInt(amount);
  if (units < 0n) throw new Error("Wompi amount must be a non-negative decimal");
  if (units % CENTS_PER_SCALE6_UNIT !== 0n) {
    throw new Error("Wompi amount has precision below one COP cent");
  }
  return (units / CENTS_PER_SCALE6_UNIT).toString();
}

export function centsToAmount(amountInCents: number): string {
  if (!Number.isInteger(amountInCents) || amountInCents < 0) {
    throw new Error("Wompi amount_in_cents must be a non-negative integer");
  }
  return bigIntToScale6(BigInt(amountInCents) * CENTS_PER_SCALE6_UNIT);
}
