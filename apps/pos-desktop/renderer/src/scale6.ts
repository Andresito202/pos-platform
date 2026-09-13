/**
 * Lo que teclea un cajero, escrito como lo exige el contrato.
 *
 * Cantidades e importes viajan en **escala 6** —`"2.000000"`, `"0.000000"`—
 * porque el servicio los trata como enteros de precisión fija y nunca como
 * coma flotante. Un cajero no teclea eso: teclea `2`, o `1,5`, o `0`.
 *
 * Sin esta normalización la venta se rechaza en la frontera con un error de
 * expresión regular, y el cajero no puede vender. No es una hipótesis: era el
 * comportamiento real del POS ejecutándose contra el servicio, y ninguna prueba
 * lo veía porque todas tecleaban ya el valor canónico.
 *
 * **Esto no calcula dinero.** Sólo reescribe lo tecleado en la forma del
 * contrato: sin redondeos, sin tasas, sin aritmética de negocio. Si el valor no
 * cabe en escala 6 sin perder dígitos, se rechaza en vez de truncarlo en
 * silencio — perder un decimal del importe de apertura es descuadrar la caja.
 */

const SCALE = 6;
const TYPED = /^(\d{1,15})(?:[.,](\d*))?$/;

export function toScale6(typed: string): string | null {
  const trimmed = typed.trim();
  if (trimmed === "") return null;

  const match = TYPED.exec(trimmed);
  if (match === null) return null;

  const whole = match[1]!.replace(/^0+(?=\d)/, "");
  const fraction = match[2] ?? "";
  // Truncar aquí sería decidir por el cajero: se rechaza y él corrige.
  if (fraction.length > SCALE) return null;

  return `${whole}.${fraction.padEnd(SCALE, "0")}`;
}
