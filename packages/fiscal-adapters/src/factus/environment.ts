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

/** Endpoints verificados contra la documentación oficial. */
export const FACTUS_PATH = {
  token: "/oauth/token",
  validateBill: "/v2/bills/validate",
  numberingRanges: "/v2/numbering-ranges/dian",
} as const;
