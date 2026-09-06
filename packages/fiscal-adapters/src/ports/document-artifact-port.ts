import * as z from "zod";
import type { CredentialReference } from "../credential.js";
import type { FiscalEnvironment } from "../provider.js";

/**
 * `DocumentArtifactPort` — `electronic-invoicing.md` §Puertos.
 *
 * - descargar XML;
 * - descargar PDF o representación disponible;
 * - **verificar checksum y tipo**.
 *
 * `FiscalArtifact` no guarda secretos y no asume que todos los proveedores
 * produzcan todos los formatos: por eso `UNAVAILABLE` es un desenlace legítimo
 * y no un error.
 */

export const FISCAL_ARTIFACT_TYPES = [
  "XML",
  "PDF",
  "APPLICATION_RESPONSE",
  "QR_DATA",
  "SIGNED_PAYLOAD",
  "PROVIDER_RESPONSE",
] as const;

export type FiscalArtifactType = (typeof FISCAL_ARTIFACT_TYPES)[number];

export const FiscalArtifactTypeSchema = z.enum(FISCAL_ARTIFACT_TYPES);

export interface DocumentArtifactRequest {
  readonly electronicDocumentId: string;
  readonly providerOperationId: string;
  readonly artifactType: FiscalArtifactType;
  readonly environment: FiscalEnvironment;
  readonly credential: CredentialReference;
}

/**
 * Artefacto obtenido y **verificado**.
 *
 * El checksum acompaña siempre al contenido: la tercera obligación del puerto
 * es verificar checksum y tipo, así que un artefacto sin ellos no es un
 * artefacto entregable.
 */
export interface VerifiedFiscalArtifact {
  readonly artifactType: FiscalArtifactType;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
  readonly checksumSha256: string;
  readonly byteLength: number;
}

export type DocumentArtifactOutcome =
  | { readonly kind: "RETRIEVED"; readonly artifact: VerifiedFiscalArtifact }
  | {
      /** El proveedor no produce este formato para este documento. */
      readonly kind: "UNAVAILABLE";
      readonly reasonCode: string;
    }
  | {
      /**
       * Se descargó algo, pero no coincide con lo esperado. No se entrega: un
       * artefacto fiscal cuya integridad no se puede afirmar no sirve como
       * evidencia.
       */
      readonly kind: "INTEGRITY_MISMATCH";
      readonly expectedChecksumSha256: string;
      readonly actualChecksumSha256: string;
    }
  | {
      readonly kind: "MEDIA_TYPE_MISMATCH";
      readonly expectedMediaType: string;
      readonly actualMediaType: string;
    };

export interface DocumentArtifactPort {
  fetchArtifact(
    request: DocumentArtifactRequest,
    signal: AbortSignal,
  ): Promise<DocumentArtifactOutcome>;
}

/** Sólo un artefacto recuperado e íntegro puede archivarse como evidencia. */
export function isStorableAsEvidence(outcome: DocumentArtifactOutcome): boolean {
  return outcome.kind === "RETRIEVED";
}
