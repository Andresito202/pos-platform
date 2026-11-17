const MAX_COLLECTION_WHOLE_COP = 12_100_000n;
const MIN_COLLECTION_WHOLE_COP = 1_000n;

/** Scale-6 COP → amount string for Factus Pay (max 2 decimal pesos). */
export function scale6ToFactusPayAmount(scale6: string): string {
  const match = /^(\d+)\.(\d{6})$/.exec(scale6);
  if (match === null) throw new Error("FACTUS_PAY_AMOUNT_INVALID");
  const whole = match[1]!;
  const fraction = match[2]!;
  if (fraction.slice(2) !== "0000") throw new Error("FACTUS_PAY_AMOUNT_PRECISION");
  const wholeCop = BigInt(whole);
  if (wholeCop < MIN_COLLECTION_WHOLE_COP || wholeCop > MAX_COLLECTION_WHOLE_COP) {
    throw new Error("FACTUS_PAY_AMOUNT_RANGE");
  }
  if (wholeCop === MAX_COLLECTION_WHOLE_COP && fraction !== "000000") {
    throw new Error("FACTUS_PAY_AMOUNT_RANGE");
  }
  const cents = fraction.slice(0, 2);
  if (cents === "00") return whole;
  return `${whole}.${cents}`;
}

/** Provider amount (≤2 decimals) → scale-6 for local payment store comparison. */
export function factusPayAmountToScale6(providerAmount: string): string {
  if (!/^(?:0|[1-9]\d{0,14})(?:\.\d{1,2})?$/.test(providerAmount)) {
    throw new Error("FACTUS_PAY_AMOUNT_INVALID");
  }
  const [whole, frac = ""] = providerAmount.split(".");
  const padded = frac.padEnd(2, "0").slice(0, 2);
  return `${whole}.${padded}0000`;
}