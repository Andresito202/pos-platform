import { BarcodeSchema } from "@pos-platform/contracts";

export type ScannedCode =
  | { readonly kind: "EMPTY" }
  | { readonly kind: "INVALID"; readonly code: string }
  | { readonly kind: "CODE"; readonly code: string };

/**
 * Lo que dejó el lector (o el teclado) en el campo, validado con la regla del
 * contrato (`BarcodeSchema`) antes de preguntar al servicio. Se quitan sólo
 * los espacios de los extremos: un lector configurado con prefijo o sufijo
 * distinto de Enter deja caracteres que **no** se limpian aquí, sino que se
 * rechazan, para que la mala configuración se vea en vez de adivinarse.
 */
export function readScannedCode(raw: string): ScannedCode {
  const code = raw.trim();
  if (code === "") return { kind: "EMPTY" };
  return BarcodeSchema.safeParse(code).success ? { kind: "CODE", code } : { kind: "INVALID", code };
}
