import * as z from "zod";

/**
 * Proveedores reconocidos por `provider-integration-matrix.md`.
 *
 * Aparecer aquí no afirma que exista adapter ni que haya sido evaluado:
 * `THE_FACTORY_HKA` y `ODOO` están `FUTURE / NOT_IMPLEMENTED` en la matriz.
 */
export const FISCAL_PROVIDERS = [
  "SIIGO",
  "FACTUS",
  "ALEGRA",
  "THE_FACTORY_HKA",
  "ODOO",
] as const;

export type FiscalProvider = (typeof FISCAL_PROVIDERS)[number];

export const FiscalProviderSchema = z.enum(FISCAL_PROVIDERS);

/**
 * Sandbox y producción son `ExternalIntegration` distintas
 * (`electronic-invoicing.md` §Configuración por empresa). No son una bandera
 * sobre la misma conexión.
 */
export const FISCAL_ENVIRONMENTS = ["SANDBOX", "PRODUCTION"] as const;

export type FiscalEnvironment = (typeof FISCAL_ENVIRONMENTS)[number];

export const FiscalEnvironmentSchema = z.enum(FISCAL_ENVIRONMENTS);

/**
 * Los cinco puertos por capacidad de `electronic-invoicing.md` §Puertos.
 *
 * Un adapter declara cuáles soporta; no se simula una capacidad inexistente
 * para satisfacer una interfaz única.
 */
export const FISCAL_PORTS = [
  "DOCUMENT_ISSUANCE",
  "DOCUMENT_STATUS_QUERY",
  "DOCUMENT_ARTIFACT",
  "NUMBERING_RANGE",
  "FISCAL_CONFIGURATION_VALIDATION",
] as const;

export type FiscalPortName = (typeof FISCAL_PORTS)[number];

export const FiscalPortNameSchema = z.enum(FISCAL_PORTS);
