import * as z from "zod";

/**
 * Escalera de verificación de `provider-integration-matrix.md`.
 *
 * El orden importa: cada nivel exige evidencia estrictamente mayor que el
 * anterior. `NOT_EVALUATED` no es un fallo, es la ausencia de evidencia.
 */
export const VERIFICATION_LEVELS = [
  "NOT_EVALUATED",
  "MOCK_TESTED",
  "SANDBOX_VERIFIED",
  "PRODUCTION_VERIFIED",
  "CERTIFIED",
] as const;

export type VerificationLevel = (typeof VERIFICATION_LEVELS)[number];

export const VerificationLevelSchema = z.enum(VERIFICATION_LEVELS);

const VERIFICATION_RANK: Readonly<Record<VerificationLevel, number>> = {
  NOT_EVALUATED: 0,
  MOCK_TESTED: 1,
  SANDBOX_VERIFIED: 2,
  PRODUCTION_VERIFIED: 3,
  CERTIFIED: 4,
};

export function verificationRank(level: VerificationLevel): number {
  return VERIFICATION_RANK[level];
}

export function meetsVerification(
  actual: VerificationLevel,
  required: VerificationLevel,
): boolean {
  return verificationRank(actual) >= verificationRank(required);
}

/**
 * Origen de la evidencia que sustenta un nivel.
 *
 * `DETERMINISTIC_FAKE` es el fake de los contract tests que corren en CI.
 * `PROVIDER_SANDBOX` y `PROVIDER_PRODUCTION` exigen credenciales reales, que
 * nunca entran en CI (`fiscal-adapter-gate.md` §12.3).
 */
export const EVIDENCE_SOURCES = [
  "NONE",
  "DETERMINISTIC_FAKE",
  "PROVIDER_SANDBOX",
  "PROVIDER_PRODUCTION",
  "PROVIDER_CERTIFICATION",
] as const;

export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

export const EvidenceSourceSchema = z.enum(EVIDENCE_SOURCES);

const MAX_LEVEL_BY_SOURCE: Readonly<Record<EvidenceSource, VerificationLevel>> = {
  NONE: "NOT_EVALUATED",
  DETERMINISTIC_FAKE: "MOCK_TESTED",
  PROVIDER_SANDBOX: "SANDBOX_VERIFIED",
  PROVIDER_PRODUCTION: "PRODUCTION_VERIFIED",
  PROVIDER_CERTIFICATION: "CERTIFIED",
};

/**
 * Techo de nivel que una fuente de evidencia puede sustentar.
 *
 * `D-4` ratificada prohíbe que un fake verde se reporte como compatibilidad con
 * el proveedor. Aquí esa prohibición deja de ser una nota y pasa a ser una
 * función: un `DETERMINISTIC_FAKE` nunca supera `MOCK_TESTED`.
 */
export function maxVerificationForSource(source: EvidenceSource): VerificationLevel {
  return MAX_LEVEL_BY_SOURCE[source];
}

export function isVerificationSupportedBySource(
  level: VerificationLevel,
  source: EvidenceSource,
): boolean {
  return verificationRank(level) <= verificationRank(maxVerificationForSource(source));
}
