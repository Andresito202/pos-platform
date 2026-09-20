import type { LocalDatabase } from "@pos-platform/database-sqlite";
import type { SyncScope } from "./durable-sync-store.js";

/**
 * Las señales operativas del outbox que `UC-SYNC-003` §Observabilidad exige.
 *
 * ## Por qué existe
 *
 * `sync-outbox-semantics.test.ts` probó que **una dead letter detiene toda la
 * cola detrás de ella** y que el bloqueo sobrevive al reinicio. Esa propiedad
 * es correcta —`DEC-007` no admite reordenar— pero era **invisible**: nada le
 * decía a un comerciante que su cola lleva días parada por una sola operación
 * atascada. Estas señales son lo que convierte ese silencio en un número.
 *
 * ## Lectura pura
 *
 * No escribe, no abre transacción y no decide nada. `UC-SYNC-003`
 * §«Separación entre observabilidad y auditoría» es explícito: la
 * observabilidad «no debe convertirse en fuente de verdad del dominio», y una
 * métrica no sustituye un registro auditable. De ahí que esto viva fuera de
 * `DurableSyncStore`: quien mide no es quien decide.
 *
 * ## Qué NO se puede medir todavía, y no es omisión
 *
 * De la lista de §Observabilidad quedan fuera tres señales, cada una por una
 * razón estructural concreta:
 *
 * - **`review_required` y `waiting_for_dependency`.** El `CHECK` de
 *   `local_sync_outbox.status` admite cinco estados y ninguno de los dos está
 *   entre ellos; localmente esas condiciones no tienen representación. Sí
 *   viajan en `local_sync_inbox.server_status`, así que se cuentan **como
 *   veredictos recibidos**, que es lo que de verdad existe, y no como estado
 *   local.
 * - **`clock_offset`.** Exige una hora central de referencia.
 *   `TrustedClockGuard` sólo impide el retroceso del reloj local; no hay con
 *   qué comparar. Inventar un origen sería fabricar la señal.
 *
 * Decirlo aquí es parte del contrato: una métrica ausente que nadie declara
 * se lee como un cero, y un cero se lee como salud.
 */

/** Veredictos que el central ya devolvió, contados sobre el inbox. */
export interface SyncServerVerdictCounts {
  readonly serverAccepted: number;
  readonly serverRejected: number;
  readonly conflict: number;
  readonly reviewRequired: number;
  readonly waitingForDependency: number;
}

export interface SyncHealthSnapshot {
  /** Operaciones que aún no están confirmadas por el central. */
  readonly outboxDepth: number;
  /** Desglose del estado local de esas operaciones. */
  readonly pending: number;
  readonly inFlight: number;
  readonly retryWaiting: number;
  readonly deadLetter: number;
  /**
   * Edad de la operación no confirmada más antigua, en milisegundos.
   *
   * `null` cuando no hay ninguna — que es distinto de cero, y la distinción
   * importa: cero significaría «hay una operación recién encolada».
   */
  readonly oldestPendingAgeMs: number | null;
  /**
   * Cuántas secuencias separan el checkpoint de la última operación
   * encolada. Es la medida directa del atasco: con la cola bloqueada crece
   * y no vuelve a bajar sola.
   */
  readonly checkpointLag: number;
  readonly checkpointSequence: number;
  readonly highestLocalSequence: number;
  readonly verdicts: SyncServerVerdictCounts;
}

interface CountRow { n: number }

const SCOPE_FILTER =
  "tenant_id=? AND company_id=? AND branch_id=? AND device_id=? AND installation_id=?";

function scopeValues(scope: SyncScope): readonly string[] {
  return [scope.tenantId, scope.companyId, scope.branchId, scope.deviceId, scope.installationId];
}

export class SyncHealthReader {
  constructor(
    private readonly database: LocalDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  read(scope: SyncScope): SyncHealthSnapshot {
    const values = scopeValues(scope);

    const byStatus = this.database.native.prepare(
      `SELECT status, COUNT(*) AS n FROM local_sync_outbox
        WHERE ${SCOPE_FILTER} GROUP BY status`,
    ).all(...values) as Array<{ status: string; n: number }>;
    const count = (status: string): number =>
      byStatus.find((row) => row.status === status)?.n ?? 0;

    const pending = count("PENDING");
    const inFlight = count("IN_FLIGHT");
    const retryWaiting = count("RETRY_WAIT");
    const deadLetter = count("DEAD_LETTER");

    const oldest = this.database.native.prepare(
      `SELECT MIN(created_at) AS at FROM local_sync_outbox
        WHERE ${SCOPE_FILTER} AND status <> 'ACKNOWLEDGED'`,
    ).get(...values) as { at: string | null };

    const checkpointSequence = (this.database.native.prepare(
      `SELECT acknowledged_through_local_sequence AS sequence
         FROM local_sync_checkpoint WHERE ${SCOPE_FILTER}`,
    ).get(...values) as { sequence: number } | undefined)?.sequence ?? 0;

    const highestLocalSequence = (this.database.native.prepare(
      `SELECT COALESCE(MAX(local_sequence), 0) AS sequence FROM local_sync_outbox
        WHERE ${SCOPE_FILTER}`,
    ).get(...values) as { sequence: number }).sequence;

    return {
      outboxDepth: pending + inFlight + retryWaiting + deadLetter,
      pending, inFlight, retryWaiting, deadLetter,
      oldestPendingAgeMs: oldest.at === null
        ? null
        : Math.max(0, this.now().getTime() - Date.parse(oldest.at)),
      // Nunca negativo: el checkpoint no puede rebasar lo encolado, y si una
      // base corrupta lo hiciera, un lag negativo se leería como salud.
      checkpointLag: Math.max(0, highestLocalSequence - checkpointSequence),
      checkpointSequence,
      highestLocalSequence,
      verdicts: this.verdicts(scope),
    };
  }

  /**
   * Los veredictos se cuentan sobre el inbox, que es donde viven. Se une con
   * el outbox porque `local_sync_inbox` no lleva tenant: su identidad es la
   * operación, y el alcance lo aporta la operación que la originó.
   */
  private verdicts(scope: SyncScope): SyncServerVerdictCounts {
    const rows = this.database.native.prepare(
      `SELECT i.server_status AS status, COUNT(*) AS n
         FROM local_sync_inbox i
         JOIN local_sync_outbox o ON o.operation_id = i.operation_id
        WHERE o.tenant_id=? AND o.company_id=? AND o.branch_id=?
          AND o.device_id=? AND o.installation_id=?
        GROUP BY i.server_status`,
    ).all(...scopeValues(scope)) as Array<{ status: string; n: number }>;
    const of = (status: string): number => rows.find((row) => row.status === status)?.n ?? 0;
    return {
      serverAccepted: of("SERVER_ACCEPTED"),
      serverRejected: of("SERVER_REJECTED"),
      conflict: of("CONFLICT"),
      reviewRequired: of("REVIEW_REQUIRED"),
      waitingForDependency: of("WAITING_FOR_DEPENDENCY"),
    };
  }

  /** Cuántas operaciones hay en total, confirmadas incluidas. Para el log. */
  totalOperations(scope: SyncScope): number {
    return (this.database.native.prepare(
      `SELECT COUNT(*) AS n FROM local_sync_outbox WHERE ${SCOPE_FILTER}`,
    ).get(...scopeValues(scope)) as CountRow).n;
  }
}
