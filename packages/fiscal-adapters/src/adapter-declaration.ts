import * as z from "zod";
import {
  FiscalCapabilityMatrixSchema,
  FiscalDocumentTypeSchema,
  matrixStateForDocumentType,
  type FiscalCapabilityMatrix,
  type FiscalDocumentType,
} from "./capability.js";
import { CredentialRequirementSchema } from "./credential.js";
import { FiscalEnvironmentSchema, FiscalPortNameSchema, FiscalProviderSchema } from "./provider.js";
import { QuotaObservabilitySchema } from "./quota.js";
import { VerificationLevelSchema } from "./verification.js";

/**
 * Declaración de un adapter (`D-3` ratificada: declaración tipada en el
 * adapter, **verificada contra la matriz de capacidades**).
 *
 * Declarar no es implementar y no es haber verificado. Una declaración
 * coherente sólo garantiza que el adapter no se contradice a sí mismo.
 */

/**
 * Política de límite de peticiones.
 *
 * `UNVERIFIED` es una rama real: SIIGO no publica límites numéricos en las
 * fuentes revisadas, mientras FACTUS declara 80/min y ALEGRA 150/min. Inventar
 * un número para SIIGO sería exactamente el tipo de dato falso que este
 * proyecto no admite.
 */
export const RateLimitPolicySchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("DECLARED"),
    requestsPerMinute: z.number().int().positive(),
    scope: z.enum(["USER", "ACCOUNT", "CONNECTION"]),
    honoursRetryAfter: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal("UNVERIFIED"),
    policy: z.literal("HEADER_DRIVEN_UNTIL_VERIFIED"),
  }),
]);

export type RateLimitPolicy = z.infer<typeof RateLimitPolicySchema>;

export const FiscalAdapterDeclarationSchema = z.strictObject({
  provider: FiscalProviderSchema,
  adapterVersion: z.string().min(1).max(64),
  environments: z.array(FiscalEnvironmentSchema).min(1).max(2),
  credential: CredentialRequirementSchema,
  capabilities: FiscalCapabilityMatrixSchema,
  supportedPorts: z.array(FiscalPortNameSchema).min(1).max(5),
  supportedDocumentTypes: z.array(FiscalDocumentTypeSchema).max(5),
  verification: VerificationLevelSchema,
  rateLimit: RateLimitPolicySchema,
  quota: QuotaObservabilitySchema,
});

export type FiscalAdapterDeclaration = z.infer<typeof FiscalAdapterDeclarationSchema>;

export const DECLARATION_FINDING_CODES = [
  "DOCUMENT_TYPE_WITHOUT_CAPABILITY",
  "DEBIT_NOTE_REQUIRES_OWN_CAPABILITY",
  "ARTIFACT_CAPABILITY_WITHOUT_PORT",
  "STATUS_QUERY_CAPABILITY_WITHOUT_PORT",
  "ISSUANCE_WITHOUT_ISSUANCE_PORT",
  "DUPLICATE_PORT_DECLARED",
  "DUPLICATE_DOCUMENT_TYPE_DECLARED",
  "DUPLICATE_ENVIRONMENT_DECLARED",
] as const;

export type DeclarationFindingCode = (typeof DECLARATION_FINDING_CODES)[number];

export interface DeclarationFinding {
  readonly code: DeclarationFindingCode;
  readonly detail: string;
}

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

/**
 * Verificación cruzada entre lo que el adapter dice soportar y lo que su matriz
 * de capacidades declara.
 *
 * No consulta al proveedor ni afirma nada sobre él: sólo detecta que una
 * declaración se contradice. Devolver `[]` significa «coherente», nunca
 * «verificado».
 */
export function validateAdapterDeclaration(
  declaration: FiscalAdapterDeclaration,
): readonly DeclarationFinding[] {
  const findings: DeclarationFinding[] = [];
  const ports = new Set(declaration.supportedPorts);
  const capabilities: FiscalCapabilityMatrix = declaration.capabilities;

  if (hasDuplicates(declaration.supportedPorts)) {
    findings.push({ code: "DUPLICATE_PORT_DECLARED", detail: "supportedPorts" });
  }
  if (hasDuplicates(declaration.supportedDocumentTypes)) {
    findings.push({ code: "DUPLICATE_DOCUMENT_TYPE_DECLARED", detail: "supportedDocumentTypes" });
  }
  if (hasDuplicates(declaration.environments)) {
    findings.push({ code: "DUPLICATE_ENVIRONMENT_DECLARED", detail: "environments" });
  }

  for (const documentType of declaration.supportedDocumentTypes) {
    if (matrixStateForDocumentType(capabilities, documentType) !== "SUPPORTED") {
      findings.push({ code: "DOCUMENT_TYPE_WITHOUT_CAPABILITY", detail: documentType });
    }
  }

  // Nota débito exige `DEBIT_NOTES`; no hereda soporte de facturación genérica.
  const declaresDebitNote: boolean = declaration.supportedDocumentTypes.includes(
    "DEBIT_NOTE" satisfies FiscalDocumentType,
  );
  if (declaresDebitNote && capabilities.debitNote !== "SUPPORTED") {
    findings.push({ code: "DEBIT_NOTE_REQUIRES_OWN_CAPABILITY", detail: "debitNote" });
  }

  if (declaration.supportedDocumentTypes.length > 0 && !ports.has("DOCUMENT_ISSUANCE")) {
    findings.push({ code: "ISSUANCE_WITHOUT_ISSUANCE_PORT", detail: "DOCUMENT_ISSUANCE" });
  }

  if (
    (capabilities.xmlDownload === "SUPPORTED" || capabilities.pdfDownload === "SUPPORTED")
    && !ports.has("DOCUMENT_ARTIFACT")
  ) {
    findings.push({ code: "ARTIFACT_CAPABILITY_WITHOUT_PORT", detail: "DOCUMENT_ARTIFACT" });
  }

  if (capabilities.statusQuery === "SUPPORTED" && !ports.has("DOCUMENT_STATUS_QUERY")) {
    findings.push({ code: "STATUS_QUERY_CAPABILITY_WITHOUT_PORT", detail: "DOCUMENT_STATUS_QUERY" });
  }

  return findings;
}

/**
 * Tipos documentales que se pueden afirmar comercialmente.
 *
 * Exige dos cosas a la vez: capacidad `SUPPORTED` **y** evidencia ejecutada
 * contra el proveedor. `MOCK_TESTED` no basta —un fake verde no es
 * compatibilidad (`D-4`)—, así que el umbral es `SANDBOX_VERIFIED`.
 */
export function commerciallyClaimableDocumentTypes(
  declaration: FiscalAdapterDeclaration,
): readonly FiscalDocumentType[] {
  const verified = declaration.verification === "SANDBOX_VERIFIED"
    || declaration.verification === "PRODUCTION_VERIFIED"
    || declaration.verification === "CERTIFIED";
  if (!verified) return [];
  return declaration.supportedDocumentTypes.filter(
    (documentType) => matrixStateForDocumentType(declaration.capabilities, documentType) === "SUPPORTED",
  );
}
