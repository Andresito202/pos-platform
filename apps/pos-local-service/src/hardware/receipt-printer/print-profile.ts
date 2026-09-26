import * as z from "zod";

/**
 * Perfil de impresora térmica (`docs/hardware/support-matrix.md` §Impresora
 * térmica: «ancho configurado por perfil», «corte solo si la capacidad
 * existe»).
 *
 * Ningún valor tiene un predeterminado de «modelo típico»: el ancho, la página
 * de códigos y el número de tabla ESC/POS **dependen del modelo exacto** —el
 * mismo CP850 es la tabla 2 en unos fabricantes y otra en otros—, y la matriz
 * prohíbe presumir compatibilidad sin equipo. Quien configure el equipo los da
 * explícitamente.
 */
export const ReceiptPrinterProfileSchema = z.strictObject({
  /** Caracteres por línea en la fuente por defecto (p. ej. 32 en 58 mm, 48 en 80 mm). */
  width_characters: z.number().int().min(24).max(64),
  /** Codificación de un byte que el equipo tiene cargada en `escpos_code_table`. */
  code_page: z.enum(["CP850", "CP1252"]),
  /** Argumento `n` de `ESC t n` para esa página en ESC/POS **de este modelo**. */
  escpos_code_table: z.number().int().min(0).max(255),
  cut: z.enum(["NONE", "PARTIAL", "FULL"]),
  feed_lines_before_cut: z.number().int().min(0).max(10),
});
export type ReceiptPrinterProfile = z.infer<typeof ReceiptPrinterProfileSchema>;
