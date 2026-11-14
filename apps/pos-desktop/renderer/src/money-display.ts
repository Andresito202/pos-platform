/**
 * Display helpers for COP amounts that travel as scale-6 strings.
 * Exact contract values remain untouched for backend payloads.
 */

export function parseCopMicros(value: string): bigint | null {
  const match = /^(-)?(\d{1,12})(?:\.(\d{1,6}))?$/.exec(value.trim());
  if (!match) return null;
  const magnitude = BigInt(match[2]!) * 1_000_000n + BigInt((match[3] ?? "").padEnd(6, "0"));
  return match[1] === "-" ? -magnitude : magnitude;
}

/** Human COP from micros, without trailing fractional zeros. */
export function formatCopMicros(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const pesos = (absolute / 1_000_000n).toLocaleString("es-CO");
  const decimals = (absolute % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  const body = decimals === "" ? `$${pesos}` : `$${pesos},${decimals}`;
  return negative ? `-${body}` : body;
}

export function formatCopPesos(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const body = `$${absolute.toLocaleString("es-CO")}`;
  return negative ? `-${body}` : body;
}

/** Display a scale-6 amount string for cashiers; keep raw via data-amount. */
export function formatScale6Display(value: string | null | undefined): string {
  if (value === null || value === undefined || value.trim() === "") return "—";
  const parsed = parseCopMicros(value);
  return parsed === null ? value : formatCopMicros(parsed);
}

/** Quantity display trimmed to the presentation's unit precision. */
export function formatQuantityDisplay(quantity: string, unitPrecision: number | null | undefined): string {
  const match = /^(\d{1,15})(?:\.(\d{1,6}))?$/.exec(quantity.trim());
  if (!match) return quantity;
  const whole = match[1]!.replace(/^0+(?=\d)/, "") || "0";
  const precision = unitPrecision === null || unitPrecision === undefined ? 6 : Math.max(0, Math.min(6, unitPrecision));
  if (precision === 0) return whole;
  const fraction = (match[2] ?? "").padEnd(6, "0").slice(0, precision).replace(/0+$/, "");
  return fraction === "" ? whole : `${whole},${fraction}`;
}

export function defaultQuantityInput(unitPrecision: number | null | undefined): string {
  const precision = unitPrecision === null || unitPrecision === undefined ? 0 : Math.max(0, Math.min(6, unitPrecision));
  return precision === 0 ? "1" : `1.${"0".repeat(precision)}`;
}
