/**
 * POS money is a scale-6 decimal string (see `sales_sales`/`cash_movement`).
 * Wompi's COP API works in integer centavos (scale-2). Both conversions stay
 * in BigInt arithmetic; floating point is forbidden for money.
 */

const AMOUNT_PATTERN = /^(\d+)(?:\.(\d{1,6}))?$/;

export function amountToCents(amount: string): string {
  const match = AMOUNT_PATTERN.exec(amount);
  if (match === null) throw new Error("Wompi amount must be a non-negative decimal");

  const whole = match[1];
  if (whole === undefined) throw new Error("Wompi amount must be a non-negative decimal");
  const fraction = (match[2] ?? "").padEnd(6, "0");

  // COP checkout accepts centavos, so the four sub-cent digits must be zero;
  // silently rounding financial amounts is forbidden.
  if (fraction.slice(2) !== "0000") {
    throw new Error("Wompi amount has precision below one COP cent");
  }

  return (BigInt(whole) * 100n + BigInt(fraction.slice(0, 2))).toString();
}

export function centsToAmount(amountInCents: number): string {
  if (!Number.isInteger(amountInCents) || amountInCents < 0) {
    throw new Error("Wompi amount_in_cents must be a non-negative integer");
  }

  const cents = BigInt(amountInCents);
  const whole = cents / 100n;
  const centavos = cents % 100n;
  return `${whole.toString()}.${centavos.toString().padStart(2, "0")}0000`;
}
