import * as z from "zod";

/**
 * Saldo de bolsa (`D-5` ratificada, `fiscal-adapter-gate.md` §12).
 *
 * Se modela como **proyección observable, no como autoridad**: la verdad la
 * tiene el proveedor. Sirve para alertar antes del agotamiento.
 *
 * **El modelo comercial no es el mismo en los tres proveedores**, y eso obliga
 * a tres ramas, no dos:
 *
 * | Proveedor | Modelo | Rama |
 * |---|---|---|
 * | FACTUS | bolsa anual divisible entre NITs | `MODELLED` |
 * | SIIGO | paquetes anuales cerrados (24, 120…) | `MODELLED` |
 * | ALEGRA | documentos **ilimitados** en plan de pago | `NOT_APPLICABLE` |
 *
 * `NOT_APPLICABLE` se añadió el 2026-09-06 tras la investigación comercial del
 * propietario. Antes, un proveedor ilimitado sólo podía declararse
 * `NOT_EVALUATED`, y eso era **falso**: sí se evaluó, y el resultado es que no
 * hay bolsa que agotar. Decir «no lo sé» de algo que sí se sabe es la misma
 * clase de error que decir «lo sé» de algo que no.
 */

export const QUOTA_OBSERVATION_SOURCES = ["PROVIDER_QUERY", "LOCAL_PROJECTION"] as const;

export type QuotaObservationSource = (typeof QUOTA_OBSERVATION_SOURCES)[number];

export const QuotaObservationSourceSchema = z.enum(QUOTA_OBSERVATION_SOURCES);

export const QuotaObservabilitySchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("MODELLED"),
    source: QuotaObservationSourceSchema,
    warnThresholdRemaining: z.number().int().positive(),
  }),
  z.strictObject({
    /** El plan del cliente no impone bolsa: no hay saldo que vigilar. */
    kind: z.literal("NOT_APPLICABLE"),
    reason: z.string().min(1).max(280),
  }),
  z.strictObject({
    kind: z.literal("NOT_EVALUATED"),
    reason: z.string().min(1).max(280),
  }),
]);

export type QuotaObservability = z.infer<typeof QuotaObservabilitySchema>;

export type QuotaSignal =
  | { readonly kind: "OK"; readonly remaining: number }
  | { readonly kind: "APPROACHING_EXHAUSTION"; readonly remaining: number }
  | { readonly kind: "EXHAUSTED" }
  /** El plan no impone bolsa. Distinto de `UNKNOWN`: aquí sí se sabe. */
  | { readonly kind: "UNLIMITED" }
  | { readonly kind: "UNKNOWN" };

export function evaluateQuotaSignal(
  observability: QuotaObservability,
  remaining: number | null,
): QuotaSignal {
  // Sin bolsa no hay agotamiento posible: la señal es `OK`, no `UNKNOWN`.
  // Confundirlas alertaría de un riesgo que ese plan no tiene.
  if (observability.kind === "NOT_APPLICABLE") return { kind: "UNLIMITED" };
  if (observability.kind === "NOT_EVALUATED" || remaining === null) return { kind: "UNKNOWN" };
  if (remaining <= 0) return { kind: "EXHAUSTED" };
  if (remaining <= observability.warnThresholdRemaining) {
    return { kind: "APPROACHING_EXHAUSTION", remaining };
  }
  return { kind: "OK", remaining };
}

/**
 * Invariante del producto, no una preferencia: **el saldo fiscal nunca bloquea
 * una venta comercial.**
 *
 * `electronic-invoicing.md` regla 6: la caída fiscal no pierde la venta. Un
 * saldo agotado detiene la emisión, no el cobro. La función devuelve `false`
 * para toda señal, agotamiento incluido, y la prueba lo fija para cada rama:
 * si alguien intenta convertir esto en un bloqueo, rompe una prueba.
 */
export function quotaBlocksCommercialSale(signal: QuotaSignal): false {
  void signal;
  return false;
}

/** El saldo sí condiciona la **emisión fiscal**, que es otra decisión. */
export function quotaAllowsNewIssuance(signal: QuotaSignal): boolean {
  return signal.kind !== "EXHAUSTED";
}
