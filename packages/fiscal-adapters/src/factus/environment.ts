import type { FiscalEnvironment } from "../provider.js";

/**
 * Bases oficiales de FACTUS (`provider-integration-matrix.md`, 2026-08-17).
 *
 * Sandbox y producción son `ExternalIntegration` distintas, no una bandera
 * sobre la misma conexión (`electronic-invoicing.md` §Configuración).
 */
const BASE_URL: Readonly<Record<FiscalEnvironment, string>> = {
  SANDBOX: "https://api-sandbox.factus.com.co",
  PRODUCTION: "https://api.factus.com.co",
};

export function factusBaseUrl(environment: FiscalEnvironment): string {
  return BASE_URL[environment];
}

/**
 * Endpoints verificados contra la documentación oficial.
 *
 * **`numberingRanges` y `dianNumberingRanges` no son el mismo recurso**, y
 * confundirlos costó una ronda de diagnóstico:
 *
 * - `/v2/numbering-ranges` devuelve los rangos **de Factus**, cada uno con su
 *   `id`. Ese `id` es el `numbering_range_id` que exige el cuerpo de emisión.
 *   Es el que hace falta para facturar.
 * - `/v2/numbering-ranges/dian` devuelve las **resoluciones DIAN** en crudo
 *   —`prefix`, `resolution_number`, `technical_key`, `from`, `to`, fechas— sin
 *   `id` de Factus. Sirve para conocer la vigencia, no para emitir.
 */
export const FACTUS_PATH = {
  token: "/oauth/token",
  validateBill: "/v2/bills/validate",
  numberingRanges: "/v2/numbering-ranges",
  dianNumberingRanges: "/v2/numbering-ranges/dian",
} as const;
