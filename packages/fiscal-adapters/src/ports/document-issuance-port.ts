import type { CredentialReference } from "../credential.js";
import type { FiscalDocumentType } from "../capability.js";
import type { FiscalEnvironment } from "../provider.js";
import type { DocumentIssuanceOutcome } from "../outcome.js";

/**
 * `DocumentIssuancePort` — `electronic-invoicing.md` §Puertos.
 *
 * - validar payload canónico;
 * - transmitir documento;
 * - devolver identidad externa y resultado normalizado.
 */

/**
 * Payload congelado con su checksum.
 *
 * Reglas 1–2 y 8 de §Idempotencia: el documento tiene identidad interna
 * anterior al primer envío, el payload congelado tiene checksum, y la misma
 * identidad con payload diferente se rechaza. Por eso el checksum viaja con el
 * payload y no se recalcula dentro del adapter.
 */
export interface FrozenDocumentPayload {
  readonly documentType: FiscalDocumentType;
  readonly payload: unknown;
  readonly checksumSha256: string;
}

/**
 * Petición de emisión.
 *
 * No transporta credenciales: sólo la referencia opaca al secreto custodiado
 * (`fiscal-adapter-gate.md` §12.5). El adapter resuelve la referencia; el
 * núcleo nunca ve el valor.
 */
export interface DocumentIssuanceRequest {
  readonly electronicDocumentId: string;
  readonly idempotencyKey: string;
  readonly attemptNumber: number;
  readonly environment: FiscalEnvironment;
  readonly credential: CredentialReference;
  readonly document: FrozenDocumentPayload;
}

/** Hallazgo de validación: código y campo, jamás el valor del campo. */
export interface PayloadValidationFinding {
  readonly code: string;
  readonly path: string;
}

/**
 * Resultado de validar el payload canónico **antes** de transmitir.
 *
 * Es una rama separada de la emisión a propósito: un payload inválido no debe
 * consumir un intento ni un consecutivo.
 */
export type PayloadValidationResult =
  | { readonly kind: "VALID" }
  | { readonly kind: "INVALID"; readonly findings: readonly PayloadValidationFinding[] };

export interface DocumentIssuancePort {
  validatePayload(document: FrozenDocumentPayload): Promise<PayloadValidationResult>;
  issue(request: DocumentIssuanceRequest, signal: AbortSignal): Promise<DocumentIssuanceOutcome>;
}
