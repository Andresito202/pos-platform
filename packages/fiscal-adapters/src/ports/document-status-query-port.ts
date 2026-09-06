import type { CredentialReference } from "../credential.js";
import type { FiscalEnvironment } from "../provider.js";
import type {
  ExternalDocumentIdentity,
  NormalizedResult,
  ProviderStatusEcho,
} from "../outcome.js";

/**
 * `DocumentStatusQueryPort` — `electronic-invoicing.md` §Puertos.
 *
 * - consultar por referencia interna o externa;
 * - recuperar estado actual;
 * - **distinguir no encontrado de resultado incierto**.
 *
 * Esa tercera obligación es la que gobierna la forma del resultado: `NOT_FOUND`
 * e `INDETERMINATE` son ramas distintas porque significan cosas opuestas. «No
 * existe» permite reemitir; «no lo sé» prohíbe reemitir y abre incidencia
 * (regla 7 de §Idempotencia).
 */

/** Referencia por la que se consulta. Interna o externa, nunca ambigua. */
export type DocumentStatusQueryReference =
  | { readonly by: "INTERNAL"; readonly electronicDocumentId: string }
  | { readonly by: "EXTERNAL"; readonly providerOperationId: string }
  | { readonly by: "NUMBER"; readonly prefix: string; readonly number: string };

export interface DocumentStatusQuery {
  readonly reference: DocumentStatusQueryReference;
  readonly environment: FiscalEnvironment;
  readonly credential: CredentialReference;
}

export type DocumentStatusQueryOutcome =
  | {
      readonly kind: "FOUND";
      readonly normalizedResult: NormalizedResult;
      readonly externalIdentity: ExternalDocumentIdentity;
      readonly providerStatus: ProviderStatusEcho;
    }
  | {
      /** El proveedor afirma que no existe. Reemitir es seguro. */
      readonly kind: "NOT_FOUND";
      readonly providerStatus: ProviderStatusEcho | null;
    }
  | {
      /**
       * El proveedor no permite una consulta inequívoca, o respondió algo que
       * no resuelve la duda. Reemitir está **prohibido**: se abre incidencia.
       */
      readonly kind: "INDETERMINATE";
      readonly reasonCode: string;
      readonly providerStatus: ProviderStatusEcho | null;
    };

export interface DocumentStatusQueryPort {
  queryStatus(query: DocumentStatusQuery, signal: AbortSignal): Promise<DocumentStatusQueryOutcome>;
}

/**
 * Regla 7 de §Idempotencia hecha función: sólo un `NOT_FOUND` autoriza volver a
 * emitir. Un resultado indeterminado nunca lo autoriza.
 */
export function authorizesReissue(outcome: DocumentStatusQueryOutcome): boolean {
  return outcome.kind === "NOT_FOUND";
}
