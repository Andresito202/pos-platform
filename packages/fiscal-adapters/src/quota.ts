import * as z from "zod";

/**
 * Saldo de bolsa (`D-5` ratificada, `fiscal-adapter-gate.md` §12).
 *
 * El modelo comercial vende una bolsa anual de documentos divisible entre NITs.
 * Se modela el saldo como **proyección observable, no como autoridad**: la
 * verdad la tiene el proveedor. Sirve para alertar antes del agotamiento.
 *
 * La forma concreta de consulta o reporte sigue `NOT_EVALUATED`: no se verificó
 * endpoint oficial. Por eso `NOT_EVALUATED` es una rama del tipo y no una
 * omisión.
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
    kind: z.literal("NOT_EVALUATED"),
    reason: z.string().min(1).max(280),
  }),
]);

export type QuotaObservability = z.infer<typeof QuotaObservabilitySchema>;

export type QuotaSignal =
  | { readonly kind: "OK"; readonly remaining: number }
  | { readonly kind: "APPROACHING_EXHAUSTION"; readonly remaining: number }
  | { readonly kind: "EXHAUSTED" }
  | { readonly kind: "UNKNOWN" };

export function evaluateQuotaSignal(
  observability: QuotaObservability,
  remaining: number | null,
): QuotaSignal {
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
