/**
 * Aritmética monetaria del servicio local — **única** representación del dinero.
 *
 * SQLite no tiene DECIMAL nativo, así que el dinero viaja como TEXT con
 * exactamente seis decimales y se opera en `BigInt`. No hay coma flotante en
 * ningún punto: un céntimo perdido por redondeo binario es un descuadre de caja.
 *
 * ## Por qué este archivo existe
 *
 * Hasta ahora había **dos** implementaciones de esta misma conversión —una en
 * `sales/sale-calculation.ts` y otra en `payments/money.ts`— y **no se
 * comportaban igual**. Medido:
 *
 * ```
 * "18000.000000"   estricta=18000000000   laxa=18000000000   IGUAL
 * "18000.5"        estricta=THROWS        laxa=18000500000   DIVERGEN
 * "18000"          estricta=THROWS        laxa=18000000000   DIVERGEN
 * "18000.1234567"  estricta=THROWS        laxa=18000123456   DIVERGEN
 * ```
 *
 * Cuatro de cinco casos. Dos verdades sobre el mismo importe dentro de la misma
 * aplicación es exactamente lo que este proyecto no admite, y el riesgo no es
 * teórico: una venta y su cobro podían interpretar la misma cadena de forma
 * distinta.
 *
 * ## Se queda la estricta, y no es arbitrario
 *
 * Una cadena que no tiene la forma canónica **es un defecto**, no un dato que
 * haya que adivinar. La versión laxa aceptaba `"18000.5"` como 18 000,50 y
 * truncaba `"18000.1234567"` en silencio; ambas conversiones son plausibles y
 * ninguna es verificable. Fallar ruidoso convierte un descuadre silencioso en un
 * error localizable.
 *
 * Todo lo que llega aquí ya está acotado: las columnas de dinero tienen `CHECK`
 * de seis decimales exactos y los contratos IPC usan `NonNegativeScale6Schema`.
 */

const SCALE = 1_000_000n;

/** Forma canónica: dígitos, punto, exactamente seis decimales, signo opcional. */
const CANONICAL_SCALE6 = /^-?\d+\.\d{6}$/;

/**
 * TEXT de escala 6 a `BigInt`.
 *
 * Acepta el signo porque `bigIntToScale6` lo produce —el ajuste de redondeo
 * comercial y el vuelto pueden ser negativos—, y la ida y la vuelta tienen que
 * cerrar. Hay una prueba que fija ese invariante.
 *
 * @throws si la cadena no tiene la forma canónica.
 */
export function scale6ToBigInt(value: string): bigint {
  if (!CANONICAL_SCALE6.test(value)) {
    throw new Error(`invalid scale-6 amount: ${value}`);
  }
  const negative = value.startsWith("-");
  const [integer, fractional] = (negative ? value.slice(1) : value).split(".") as [string, string];
  const units = BigInt(integer) * SCALE + BigInt(fractional);
  return negative ? -units : units;
}

/** `BigInt` a TEXT de escala 6. */
export function bigIntToScale6(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? "-" : ""}${absolute / SCALE}.${(absolute % SCALE).toString().padStart(6, "0")}`;
}
