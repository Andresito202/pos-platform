import type { MasterSnapshotFailureCode, SignedMasterSnapshot } from "@pos-platform/contracts";
import type {
  MasterSnapshotScope,
  MasterSnapshotVerifier,
} from "../security/master-snapshot-verifier.js";
import type {
  MasterSnapshotScopeKey,
  SqliteMasterSnapshotStore,
} from "./sqlite-master-snapshot-store.js";

/**
 * Ruta única de activación de un snapshot maestro (`DEC-013` §13, §27).
 *
 * `VERIFY → VALIDATE → WRITE → ACTIVATE`. La verificación no persiste; la
 * escritura y la activación ocurren en una sola transacción del store. Un fallo
 * en cualquier punto deja intacta la proyección anterior y **no avanza la
 * coordenada aceptada**.
 *
 * El transporte no es autoridad: este servicio no consulta el checkpoint para
 * decidir si acepta, y sólo lo avanza **después** de una activación confirmada.
 */

/**
 * Cota que la autoridad central afirma sobre **sus propios acuses**
 * (`DEC-013` §27.2). No afirma qué aceptó la instalación: es una cota inferior.
 *
 * Su implementación real depende del emisor central, bloqueado por `B-3`. Aquí
 * sólo existe el puerto; no se provee un sustituto local, porque un sustituto
 * local sería una segunda autoridad.
 */
export interface AcknowledgedFloorSource {
  /** `null` cuando la central no tiene acuse registrado para este ámbito. */
  floorFor(scope: MasterSnapshotScopeKey): number | null;
}

/**
 * Costura con `SyncCheckpoint` en dirección `DOWNLOAD` (`DEC-013` §6).
 *
 * El cursor es opaco y **nunca** decide la aceptación. Su persistencia durable
 * pertenece al bloque que materialice el transporte: aquí sólo se declara el
 * punto de integración, y avanzar el cursor ocurre después del commit.
 */
export interface DownloadCheckpointPort {
  advance(scope: MasterSnapshotScopeKey, cursor: string): void;
}

export interface MasterSnapshotObserver {
  accepted(scope: MasterSnapshotScopeKey, sequence: number): void;
  rejected(scope: MasterSnapshotScopeKey, code: MasterSnapshotFailureCode): void;
}

export type MasterSnapshotAcceptanceOutcome =
  | { readonly kind: "ACTIVATED"; readonly sequence: number }
  | { readonly kind: "REJECTED"; readonly code: MasterSnapshotFailureCode };

export interface MasterSnapshotAcceptanceOptions {
  /** Cursor opaco del transporte, avanzado sólo tras una activación confirmada. */
  readonly cursor?: string;
}

/** Traduce la decisión del verificador al código de fallo de `DEC-013` §16. */
function failureCodeFor(decision: string): MasterSnapshotFailureCode {
  switch (decision) {
    case "INVALID_SCHEMA": return "INVALID_SCHEMA";
    case "INVALID_SIGNATURE": return "INVALID_SIGNATURE";
    case "UNKNOWN_KEY": return "UNKNOWN_KEY";
    case "WRONG_KEY_PURPOSE": return "WRONG_KEY_PURPOSE";
    case "REVOKED_KEY": return "REVOKED_KEY";
    case "WRONG_ENVIRONMENT": return "WRONG_ENVIRONMENT";
    case "WRONG_SCOPE": return "WRONG_SCOPE";
    case "OBSOLETE_SEQUENCE": return "OBSOLETE_SEQUENCE";
    case "DUPLICATE_SEQUENCE": return "DUPLICATE_SEQUENCE";
    default: return "ACTIVATION_FAILURE";
  }
}

export class MasterSnapshotActivationService {
  constructor(
    private readonly verifier: MasterSnapshotVerifier,
    private readonly store: SqliteMasterSnapshotStore,
    private readonly acknowledgedFloor: AcknowledgedFloorSource,
    private readonly checkpoint?: DownloadCheckpointPort,
    private readonly observer?: MasterSnapshotObserver,
  ) {}

  accept(
    input: unknown,
    scope: MasterSnapshotScope,
    options: MasterSnapshotAcceptanceOptions = {},
  ): MasterSnapshotAcceptanceOutcome {
    const scopeKey: MasterSnapshotScopeKey = {
      tenantId: scope.tenantId,
      companyId: scope.companyId,
      branchId: scope.branchId,
    };

    const local = this.store.highestAcceptedSequence(scopeKey);

    // `DEC-013` §27.4, regla 5: la confirmación de cota es **incondicional por
    // sesión**, no condicionada a detectar una restauración. Así una
    // restauración silenciosa queda cubierta por construcción.
    let central: number | null;
    try {
      central = this.acknowledgedFloor.floorFor(scopeKey);
    } catch {
      // Sin cota central no se acepta nada. El estado restaurado local es sólo
      // una cota inferior candidata, y operar sin confirmarla permitiría
      // aceptar un artefacto auténtico pero antiguo.
      return this.reject(scopeKey, "TRANSPORT_FAILURE");
    }

    // `effective_floor = max(local, central)`. Ambos son cotas inferiores
    // válidas; el máximo de dos cotas inferiores válidas es la más ajustada.
    // Nunca se adopta la menor.
    const effectiveFloor = local === null
      ? (central ?? undefined)
      : Math.max(local, central ?? local);

    const verification = this.verifier.verify(
      input,
      scope,
      effectiveFloor === undefined ? {} : { effectiveFloor },
    );
    if (verification.decision !== "VALID" || verification.claims === null) {
      return this.reject(scopeKey, failureCodeFor(verification.decision));
    }

    let outcome;
    try {
      outcome = this.store.activate(input as SignedMasterSnapshot, verification.claims);
    } catch {
      // Un fallo de escritura deja la proyección anterior intacta por el
      // rollback de la transacción; aquí sólo se traduce a un código estable.
      return this.reject(scopeKey, "SQLITE_FAILURE");
    }

    if (outcome.kind !== "ACTIVATED") {
      return this.reject(scopeKey, outcome.kind);
    }

    // El cursor avanza **después** del commit y nunca antes: un cursor adelantado
    // sobre una activación fallida haría saltar snapshots.
    if (options.cursor !== undefined) this.checkpoint?.advance(scopeKey, options.cursor);
    this.observer?.accepted(scopeKey, outcome.sequence);
    return { kind: "ACTIVATED", sequence: outcome.sequence };
  }

  private reject(
    scope: MasterSnapshotScopeKey,
    code: MasterSnapshotFailureCode,
  ): MasterSnapshotAcceptanceOutcome {
    this.store.recordRejection(scope.tenantId, {
      tenant_id: scope.tenantId,
      company_id: scope.companyId,
      branch_id: scope.branchId,
      code,
    });
    this.observer?.rejected(scope, code);
    return { kind: "REJECTED", code };
  }
}
