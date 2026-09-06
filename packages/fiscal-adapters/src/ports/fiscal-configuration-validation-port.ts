import type { CredentialReference, CredentialRequirement } from "../credential.js";
import type { FiscalCapabilityMatrix } from "../capability.js";
import type { FiscalEnvironment } from "../provider.js";

/**
 * `FiscalConfigurationValidationPort` — `electronic-invoicing.md` §Puertos.
 *
 * - validar credenciales;
 * - validar ambiente;
 * - consultar capacidades;
 * - **detectar configuración incompleta sin exponer secretos**.
 *
 * La última obligación decide la forma del resultado: un hallazgo nombra el
 * campo y el motivo, nunca el valor. No existe en este módulo un tipo capaz de
 * transportar el contenido de una credencial.
 */

export const CONFIGURATION_FINDING_CODES = [
  "CREDENTIAL_FIELD_MISSING",
  "CREDENTIAL_REJECTED_BY_PROVIDER",
  "ENVIRONMENT_MISMATCH",
  "CERTIFICATE_REFERENCE_MISSING",
  "NUMBERING_RANGE_MISSING",
  "CAPABILITY_NOT_ENABLED_FOR_ACCOUNT",
  "ACCOUNT_IDENTITY_UNRESOLVED",
] as const;

export type ConfigurationFindingCode = (typeof CONFIGURATION_FINDING_CODES)[number];

/**
 * Hallazgo de configuración.
 *
 * `fieldName` es el **nombre** declarado del campo —`access_key`,
 * `client_secret`—, que es público. El valor no aparece por construcción: este
 * tipo no tiene dónde ponerlo.
 */
export interface ConfigurationFinding {
  readonly code: ConfigurationFindingCode;
  readonly fieldName: string | null;
  readonly diagnosticReference: string;
}

export interface FiscalConfigurationValidationRequest {
  readonly environment: FiscalEnvironment;
  readonly credential: CredentialReference;
  readonly expectedCredentialShape: CredentialRequirement;
}

export type FiscalConfigurationValidationOutcome =
  | {
      readonly kind: "VALID";
      readonly environment: FiscalEnvironment;
      readonly observedCapabilities: FiscalCapabilityMatrix;
    }
  | {
      readonly kind: "INCOMPLETE";
      readonly findings: readonly ConfigurationFinding[];
    }
  | {
      /**
       * No se pudo determinar. Distinto de `INCOMPLETE`: allí sabemos qué
       * falta, aquí no sabemos nada. No autoriza dar por buena la
       * configuración ni por mala.
       */
      readonly kind: "UNDETERMINED";
      readonly reasonCode: string;
      readonly diagnosticReference: string;
    };

export interface FiscalConfigurationValidationPort {
  validateConfiguration(
    request: FiscalConfigurationValidationRequest,
    signal: AbortSignal,
  ): Promise<FiscalConfigurationValidationOutcome>;
}

/** Sólo una validación explícitamente válida habilita emitir. */
export function authorizesIssuance(
  outcome: FiscalConfigurationValidationOutcome,
): boolean {
  return outcome.kind === "VALID";
}
