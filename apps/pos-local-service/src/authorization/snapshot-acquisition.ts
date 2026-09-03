import type { SignedAuthorizationSnapshot } from "@pos-platform/contracts";
import type { AuthorizationSnapshotDecision } from "../security/authorization-snapshot-verifier.js";
import type { AuthorizationSnapshotVerifier } from "../security/authorization-snapshot-verifier.js";
import type {
  AuthorizationSnapshotStore,
  SnapshotBinding,
} from "./authorization-snapshot-store.js";
import type { SnapshotProvider } from "./snapshot-provider.js";

/**
 * Resultado tipado de una tentativa de adquisición (SAS-003).
 *
 * ACQUIRED           — el snapshot fue verificado y persistido como activo.
 * STALE_SEQUENCE     — el proveedor devolvió una secuencia ≤ la activa;
 *                      el snapshot local permanece sin cambios.
 * BINDING_MISMATCH   — los claims no corresponden al binding del dispositivo;
 *                      nunca alcanza el store.
 * VERIFICATION_FAILED — la firma, la clave o la vigencia no son válidas;
 *                       nunca alcanza el store.
 * PROVIDER_UNAVAILABLE — el proveedor externo lanzó; el snapshot local
 *                        válido no se toca.
 */
export type SnapshotAcquisitionOutcome =
  | { readonly kind: "ACQUIRED"; readonly sequence: number }
  | { readonly kind: "STALE_SEQUENCE"; readonly currentSequence: number }
  | { readonly kind: "BINDING_MISMATCH" }
  | { readonly kind: "VERIFICATION_FAILED"; readonly decision: AuthorizationSnapshotDecision }
  | { readonly kind: "PROVIDER_UNAVAILABLE"; readonly cause: unknown };

/**
 * Servicio de adquisición y refresh del Authorization Snapshot (SAS-003).
 *
 * Única ruta canónica que puede activar un snapshot:
 *   provider.fetch → verifier.verify (SAS-001) → store.activate (SAS-002)
 *
 * Invariantes:
 * — fail-closed: ningún camino alternativo activa autorización.
 * — fallo del proveedor devuelve PROVIDER_UNAVAILABLE; el snapshot local
 *   previo permanece intacto.
 * — fallo de persistencia (store.activate lanza): se propaga; el rollback
 *   transaccional de SAS-002 garantiza que el snapshot anterior permanece.
 * — un snapshot expirado o con firma inválida nunca alcanza el store.
 */
export class SnapshotAcquisitionService {
  constructor(
    private readonly provider: SnapshotProvider,
    private readonly verifier: AuthorizationSnapshotVerifier,
    private readonly store: AuthorizationSnapshotStore,
  ) {}

  async acquire(binding: SnapshotBinding): Promise<SnapshotAcquisitionOutcome> {
    let signed: SignedAuthorizationSnapshot;
    try {
      signed = await this.provider.fetch(binding);
    } catch (cause: unknown) {
      return { kind: "PROVIDER_UNAVAILABLE", cause };
    }

    const result = this.verifier.verify(signed, binding);
    if (result.decision !== "VALID") {
      return { kind: "VERIFICATION_FAILED", decision: result.decision };
    }

    // Si el store lanza (p. ej. fallo de I/O), se propaga al llamador.
    // La transacción SQLite de SAS-002 garantiza que el snapshot anterior queda intacto.
    const activation = this.store.activate(signed, binding);
    if (activation.kind === "ACTIVATED") {
      return { kind: "ACQUIRED", sequence: activation.sequence };
    }
    return activation;
  }
}
