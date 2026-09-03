import type {
  AuthorizationSnapshotClaims,
  SignedAuthorizationSnapshot,
} from "@pos-platform/contracts";

/**
 * Puerto de persistencia del Signed Authorization Snapshot (DEC-011, SAS-002).
 *
 * Define el contrato sin nombrar SQLite, Kysely ni better-sqlite3, de modo que
 * el almacenamiento concreto pueda sustituirse sin tocar a sus consumidores.
 */

export interface SnapshotBinding {
  readonly userId: string;
  readonly installationId: string;
  readonly deviceId: string;
}

export interface StoredAuthorizationSnapshot {
  readonly claims: AuthorizationSnapshotClaims;
  readonly signature: string;
  readonly activatedAt: string;
}

/**
 * `STALE_SEQUENCE` cubre tanto una secuencia menor como una igual: solo una
 * estrictamente mayor puede desplazar al snapshot activo, de modo que reenviar
 * el snapshot vigente nunca cuenta como una actualización.
 */
export type SnapshotActivationOutcome =
  | { readonly kind: "ACTIVATED"; readonly sequence: number }
  | { readonly kind: "STALE_SEQUENCE"; readonly currentSequence: number }
  | { readonly kind: "BINDING_MISMATCH" };

export interface AuthorizationSnapshotStore {
  /**
   * Activa un snapshot **ya verificado criptográficamente**. Este puerto no
   * verifica firmas: esa es responsabilidad de `AuthorizationSnapshotVerifier`
   * (SAS-001). Persistir no confiere autoridad.
   */
  activate(
    signed: SignedAuthorizationSnapshot,
    binding: SnapshotBinding,
  ): SnapshotActivationOutcome;

  /**
   * Devuelve el snapshot activo del binding únicamente si está dentro de su
   * ventana temporal. Un snapshot expirado no concede autorización y se
   * comunica como ausencia, no como advertencia: no existe gracia offline.
   */
  loadActive(binding: SnapshotBinding): StoredAuthorizationSnapshot | null;
}
