/**
 * Aritmética monetaria a escala 6 — misma representación que `sales_sales` y
 * `cash_movement`.
 *
 * SQLite no tiene DECIMAL nativo, de modo que el dinero viaja como TEXT con
 * exactamente seis decimales y se opera en `BigInt`. No se usa coma flotante en
 * ningún punto: un céntimo perdido por redondeo binario es un descuadre de caja.
 */

const SCALE = 1_000_000n;

export function scale6ToBigInt(value: string): bigint {
  const dot = value.indexOf(".");
  const integerPart = dot === -1 ? value : value.slice(0, dot);
  const fractionPart = dot === -1 ? "000000" : value.slice(dot + 1).padEnd(6, "0").slice(0, 6);
  return BigInt(integerPart) * SCALE + BigInt(fractionPart);
}

export function bigIntToScale6(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / SCALE}.${(absolute % SCALE).toString().padStart(6, "0")}`;
}
