import * as z from "zod";
import {
  ContractVersionSchema,
  Sha256HexSchema,
  StableCodeSchema,
  UtcDateTimeSchema,
  type ContractVersion,
} from "./primitives.js";
import {
  ContractVersionRangeSchema,
  compareContractVersions,
  isContractVersionCompatible,
} from "./versioning.js";

// DEC-010 "Actualizaciones" regla 1: la aplicación de escritorio, el servicio
// local, el esquema y los contratos tienen versiones explícitas.
export const ReleaseComponentSchema = z.enum([
  "DESKTOP_APP",
  "LOCAL_SERVICE",
  "LOCAL_SCHEMA",
  "CONTRACTS",
]);

export const REQUIRED_RELEASE_COMPONENTS = ReleaseComponentSchema.options;

// Sólo SHA-256: fijar el algoritmo evita que un manifiesto degrade la
// verificación eligiendo uno más débil.
export const ReleaseArtifactSchema = z.strictObject({
  component: ReleaseComponentSchema,
  version: ContractVersionSchema,
  sha256: Sha256HexSchema,
  size_bytes: z.number().int().positive(),
});

export const ReleaseSignatureSchema = z.strictObject({
  algorithm: z.literal("ED25519"),
  key_id: StableCodeSchema,
  value: z.string().min(1).max(512),
});

export const ReleaseManifestSchema = z.strictObject({
  manifest_version: z.literal("1"),
  release_version: ContractVersionSchema,
  released_at: UtcDateTimeSchema,
  artifacts: z.array(ReleaseArtifactSchema).length(REQUIRED_RELEASE_COMPONENTS.length),
  // Rango de esquema local que esta release sabe operar. Gobierna tanto la
  // actualización como el rollback (regla 7).
  supported_local_schema: ContractVersionRangeSchema,
  // null representa una release sin firmar de forma explícita, no la ausencia
  // del campo: la regla 2 exige decidir sobre ello, no ignorarlo.
  signature: ReleaseSignatureSchema.nullable(),
}).superRefine((manifest, context) => {
  const seen = new Set<string>();
  for (const artifact of manifest.artifacts) {
    if (seen.has(artifact.component)) {
      context.addIssue({
        code: "custom",
        path: ["artifacts"],
        message: `duplicate artifact for component ${artifact.component}`,
      });
    }
    seen.add(artifact.component);
  }
  for (const component of REQUIRED_RELEASE_COMPONENTS) {
    if (!seen.has(component)) {
      context.addIssue({
        code: "custom",
        path: ["artifacts"],
        message: `missing artifact for component ${component}`,
      });
    }
  }
});

export const InstalledStateSchema = z.strictObject({
  release_version: ContractVersionSchema,
  local_schema_version: ContractVersionSchema,
});

export type ReleaseComponent = z.infer<typeof ReleaseComponentSchema>;
export type ReleaseArtifact = z.infer<typeof ReleaseArtifactSchema>;
export type ReleaseSignature = z.infer<typeof ReleaseSignatureSchema>;
export type ReleaseManifest = z.infer<typeof ReleaseManifestSchema>;
export type InstalledState = z.infer<typeof InstalledStateSchema>;

export const ReleaseDecisionSchema = z.enum(["ALLOW", "REJECT"]);
export type ReleaseDecision = z.infer<typeof ReleaseDecisionSchema>;

export const ReleaseRejectionCodeSchema = z.enum([
  "UNSIGNED_RELEASE",
  "UNTRUSTED_SIGNING_KEY",
  "CHECKSUM_MISMATCH",
  "ARTIFACT_SIZE_MISMATCH",
  "MISSING_VERIFIED_ARTIFACT",
  "SCHEMA_INCOMPATIBLE",
  "INSUFFICIENT_DISK_SPACE",
  "NOT_AN_UPGRADE",
  "NOT_A_ROLLBACK",
]);
export type ReleaseRejectionCode = z.infer<typeof ReleaseRejectionCodeSchema>;

export interface ReleaseEvaluation {
  readonly decision: ReleaseDecision;
  readonly reasons: readonly ReleaseRejectionCode[];
}

// Resultado de verificar físicamente un artefacto descargado. La verificación
// en sí pertenece al instalador; aquí sólo se evalúa su resultado.
export const VerifiedArtifactSchema = z.strictObject({
  component: ReleaseComponentSchema,
  sha256: Sha256HexSchema,
  size_bytes: z.number().int().nonnegative(),
});

export type VerifiedArtifact = z.infer<typeof VerifiedArtifactSchema>;

export const UpgradePreconditionsSchema = z.strictObject({
  manifest: ReleaseManifestSchema,
  installed: InstalledStateSchema,
  trusted_signing_key_ids: z.array(StableCodeSchema).readonly(),
  verified_artifacts: z.array(VerifiedArtifactSchema).readonly(),
  available_bytes: z.number().int().nonnegative(),
});

export type UpgradePreconditions = z.infer<typeof UpgradePreconditionsSchema>;

function evaluateSignature(
  manifest: ReleaseManifest,
  trustedKeyIds: readonly string[],
): ReleaseRejectionCode[] {
  // Regla 2: toda actualización productiva está firmada. Sin firma no se
  // evalúa la confianza de la clave: falta el hecho, no el permiso.
  if (manifest.signature === null) return ["UNSIGNED_RELEASE"];
  if (!trustedKeyIds.includes(manifest.signature.key_id)) return ["UNTRUSTED_SIGNING_KEY"];
  return [];
}

// Regla 3 y "checksums verificables": cada artefacto declarado debe tener una
// verificación física que coincida en digest y tamaño. Una verificación
// ausente es un rechazo, nunca una omisión silenciosa.
function evaluateArtifactIntegrity(
  manifest: ReleaseManifest,
  verified: readonly VerifiedArtifact[],
): ReleaseRejectionCode[] {
  const reasons = new Set<ReleaseRejectionCode>();
  for (const artifact of manifest.artifacts) {
    const match = verified.find((candidate) => candidate.component === artifact.component);
    if (match === undefined) {
      reasons.add("MISSING_VERIFIED_ARTIFACT");
      continue;
    }
    if (match.sha256 !== artifact.sha256) reasons.add("CHECKSUM_MISMATCH");
    if (match.size_bytes !== artifact.size_bytes) reasons.add("ARTIFACT_SIZE_MISMATCH");
  }
  return [...reasons];
}

function requiredBytes(manifest: ReleaseManifest): number {
  return manifest.artifacts.reduce((total, artifact) => total + artifact.size_bytes, 0);
}

function decide(reasons: readonly ReleaseRejectionCode[]): ReleaseEvaluation {
  return reasons.length === 0
    ? { decision: "ALLOW", reasons: [] }
    : { decision: "REJECT", reasons: [...reasons].sort() };
}

/**
 * Evalúa las precondiciones de una actualización (DEC-010 "Actualizaciones"
 * reglas 2, 3 y 7). Acumula todas las causas de rechazo en vez de cortar en la
 * primera, para que el instalador pueda reportar el estado completo.
 */
export function evaluateUpgrade(input: UpgradePreconditions): ReleaseEvaluation {
  const parsed = UpgradePreconditionsSchema.parse(input);
  const reasons: ReleaseRejectionCode[] = [
    ...evaluateSignature(parsed.manifest, parsed.trusted_signing_key_ids),
    ...evaluateArtifactIntegrity(parsed.manifest, parsed.verified_artifacts),
  ];

  if (compareContractVersions(parsed.manifest.release_version, parsed.installed.release_version) <= 0) {
    reasons.push("NOT_AN_UPGRADE");
  }

  // Regla 7 aplicada también hacia adelante: la release entrante debe saber
  // operar el esquema local ya instalado.
  if (!isContractVersionCompatible(parsed.installed.local_schema_version, parsed.manifest.supported_local_schema)) {
    reasons.push("SCHEMA_INCOMPATIBLE");
  }

  if (parsed.available_bytes < requiredBytes(parsed.manifest)) {
    reasons.push("INSUFFICIENT_DISK_SPACE");
  }

  return decide(reasons);
}

export const RollbackPreconditionsSchema = z.strictObject({
  target: ReleaseManifestSchema,
  installed: InstalledStateSchema,
  trusted_signing_key_ids: z.array(StableCodeSchema).readonly(),
  verified_artifacts: z.array(VerifiedArtifactSchema).readonly(),
});

export type RollbackPreconditions = z.infer<typeof RollbackPreconditionsSchema>;

/**
 * Evalúa un rollback de binarios (DEC-010 "Actualizaciones" reglas 6 y 7).
 *
 * El caso peligroso es revertir binarios cuando el esquema local ya migró hacia
 * adelante: la release destino debe declarar soporte para la versión de esquema
 * actualmente instalada. No se asume que un esquema mayor sea compatible.
 */
export function evaluateRollback(input: RollbackPreconditions): ReleaseEvaluation {
  const parsed = RollbackPreconditionsSchema.parse(input);
  const reasons: ReleaseRejectionCode[] = [
    ...evaluateSignature(parsed.target, parsed.trusted_signing_key_ids),
    ...evaluateArtifactIntegrity(parsed.target, parsed.verified_artifacts),
  ];

  if (compareContractVersions(parsed.target.release_version, parsed.installed.release_version) >= 0) {
    reasons.push("NOT_A_ROLLBACK");
  }

  if (!isContractVersionCompatible(parsed.installed.local_schema_version, parsed.target.supported_local_schema)) {
    reasons.push("SCHEMA_INCOMPATIBLE");
  }

  return decide(reasons);
}

export function findReleaseArtifact(
  manifest: ReleaseManifest,
  component: ReleaseComponent,
): ReleaseArtifact | undefined {
  return manifest.artifacts.find((artifact) => artifact.component === component);
}

export function releaseComponentVersion(
  manifest: ReleaseManifest,
  component: ReleaseComponent,
): ContractVersion | undefined {
  return findReleaseArtifact(manifest, component)?.version;
}
