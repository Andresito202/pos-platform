import * as z from "zod";

/**
 * Separación entre estado técnico y resultado fiscal.
 *
 * `electronic-invoicing.md` §Intentos: «`transport_status` y `normalized_result`
 * permanecen separados. Para este contrato, `normalized_result` solo reutiliza
 * `ACCEPTED` o `REJECTED` cuando existe evidencia; fallo técnico o
 * incertidumbre lo dejan ausente.»
 *
 * Aquí esa regla no es un comentario sobre dos campos opcionales: es la forma
 * del tipo. `TECHNICAL_FAILURE` y `UNCERTAIN` **no tienen** propiedad de
 * resultado normalizado, así que escribirla no compila.
 */

/** Estados técnicos persistentes de `FiscalSubmissionAttempt`. */
export const TRANSPORT_STATUSES = [
  "CREATED",
  "IN_PROGRESS",
  "COMPLETED",
  "FAILED",
  "UNKNOWN_OUTCOME",
  "CANCELLED",
] as const;

export type TransportStatus = (typeof TRANSPORT_STATUSES)[number];

export const TransportStatusSchema = z.enum(TRANSPORT_STATUSES);

/** Resultado fiscal normalizado. Sólo existe cuando existe evidencia. */
export const NORMALIZED_RESULTS = ["ACCEPTED", "REJECTED"] as const;

export type NormalizedResult = (typeof NORMALIZED_RESULTS)[number];

export const NormalizedResultSchema = z.enum(NORMALIZED_RESULTS);

/**
 * Estado original del proveedor.
 *
 * Se conserva sin convertirlo en enum global: un valor desconocido no se mapea
 * a un estado inventado, se conserva tal cual y el documento va a revisión.
 */
export interface ProviderStatusEcho {
  readonly providerCode: string;
  readonly providerStatus: string;
  readonly httpStatus: number | null;
}

/** Identidad que el proveedor asigna al documento aceptado o rechazado. */
export interface ExternalDocumentIdentity {
  readonly providerOperationId: string;
  readonly providerDocumentId: string | null;
  readonly prefix: string | null;
  readonly number: string | null;
  readonly cufe: string | null;
}

/** Diagnóstico sin secretos: código estable y referencia, nunca payload. */
export interface FiscalDiagnostic {
  readonly code: string;
  readonly diagnosticReference: string;
  readonly retryAfterSeconds: number | null;
}

/**
 * Resultado de un intento de emisión.
 *
 * Las tres ramas son excluyentes y sólo la primera puede afirmar un resultado
 * fiscal. Un timeout después de transmitir es `UNCERTAIN`, nunca `EVIDENCED`
 * con resultado inferido: la regla 5 de §Idempotencia lo exige, y la exclusión
 * de fallos DIAN del SLA (`fiscal-adapter-gate.md` §10) lo confirma —un fallo
 * aguas arriba no autoriza inferir aceptación.
 */
export type DocumentIssuanceOutcome =
  | {
      readonly kind: "EVIDENCED";
      readonly transportStatus: "COMPLETED";
      readonly normalizedResult: NormalizedResult;
      readonly externalIdentity: ExternalDocumentIdentity;
      readonly providerStatus: ProviderStatusEcho;
    }
  | {
      readonly kind: "TECHNICAL_FAILURE";
      readonly transportStatus: "FAILED";
      readonly providerStatus: ProviderStatusEcho | null;
      readonly diagnostic: FiscalDiagnostic;
    }
  | {
      readonly kind: "UNCERTAIN";
      readonly transportStatus: "UNKNOWN_OUTCOME";
      readonly providerStatus: ProviderStatusEcho | null;
      readonly diagnostic: FiscalDiagnostic;
    };

/**
 * Lectura segura del resultado fiscal.
 *
 * Devuelve `null` para todo lo que no sea evidencia. Existe para que ningún
 * consumidor tenga que hacer el `switch` a mano y equivocarse.
 */
export function normalizedResultOf(outcome: DocumentIssuanceOutcome): NormalizedResult | null {
  return outcome.kind === "EVIDENCED" ? outcome.normalizedResult : null;
}

/**
 * Un desenlace incierto **exige consulta o conciliación** antes de reintentar
 * (regla 6 de §Idempotencia). Nunca se resuelve por vencimiento de un plazo.
 */
export function requiresReconciliationBeforeRetry(outcome: DocumentIssuanceOutcome): boolean {
  return outcome.kind === "UNCERTAIN";
}
