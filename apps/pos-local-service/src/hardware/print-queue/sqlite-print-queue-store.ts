import { uuidV7 } from "@pos-platform/contracts";
import type { LocalDatabase } from "@pos-platform/database-sqlite";
import type { SyncScope } from "../../sync/durable-sync-store.js";
import type { CommandResult } from "../device-port.js";

export type PrintCopy = "ORIGINAL" | "REPRINT";
export type PrintJobStatus = "PENDING" | "PRINTED" | "FAILED" | "UNKNOWN";
export type AttemptOutcome = "SUCCEEDED" | "FAILED" | "TIMED_OUT" | "CANCELLED" | "UNKNOWN" | "INTERRUPTED";

export interface PrintJob {
  readonly id: string;
  readonly saleId: string;
  readonly copy: PrintCopy;
  readonly status: PrintJobStatus;
  readonly lastDiagnosticCode: string | null;
}

export interface ClosedAttempt {
  readonly outcome: AttemptOutcome;
  readonly retryable: boolean;
  readonly diagnosticCode: string | null;
}

export type OpenAttemptResult =
  /** Esta petición abrió un intento: hay que imprimir. */
  | { readonly kind: "OPENED"; readonly job: PrintJob; readonly attemptId: string }
  /** Otra petición está imprimiendo este trabajo ahora mismo. */
  | { readonly kind: "IN_PROGRESS"; readonly job: PrintJob }
  /** Esta misma petición ya llegó antes: no se imprime otra vez. */
  | { readonly kind: "REPLAY"; readonly job: PrintJob; readonly attempt: ClosedAttempt | null };

interface JobRow {
  id: string; sale_id: string; copy_kind: PrintCopy; status: PrintJobStatus; last_diagnostic_code: string | null;
}

const toJob = (row: JobRow): PrintJob => ({
  id: row.id, saleId: row.sale_id, copy: row.copy_kind, status: row.status, lastDiagnosticCode: row.last_diagnostic_code,
});

/**
 * Cola de impresión (`MIGRATION_032`). Único escritor de `hardware_print_*`.
 *
 * No toca tablas de venta: la venta sólo se referencia, y el esquema
 * garantiza que exista.
 */
export class SqlitePrintQueueStore {
  constructor(private readonly database: LocalDatabase, private readonly now: () => Date = () => new Date()) {}

  /**
   * Decide, en una sola transacción, qué hace esta petición:
   *
   * 1. si su clave ya existe, es la misma petición repetida → `REPLAY`;
   * 2. si la venta tiene un trabajo pendiente —el último intento falló de
   *    forma reintentable— se reintenta **ese** trabajo, con su identidad y su
   *    tipo de copia; un «sin papel» corregido no se convierte en reimpresión;
   * 3. si ese trabajo tiene un intento abierto → `IN_PROGRESS`;
   * 4. si no, trabajo nuevo: `ORIGINAL` si la venta nunca tuvo uno, `REPRINT`
   *    en cualquier otro caso — incluido tras un desenlace `UNKNOWN`, porque
   *    si aquel papel salió, éste es una segunda copia y debe decirlo.
   */
  openAttempt(
    scope: SyncScope,
    input: { readonly saleId: string; readonly userId: string; readonly idempotencyKey: string },
  ): OpenAttemptResult {
    const at = this.now().toISOString();
    const db = this.database.native;
    return db.transaction((): OpenAttemptResult => {
      const previous = db.prepare(
        `SELECT j.id, j.sale_id, j.copy_kind, j.status, j.last_diagnostic_code,
                a.outcome, a.retryable, a.diagnostic_code
           FROM hardware_print_attempt a
           JOIN hardware_print_job j ON j.tenant_id = a.tenant_id AND j.id = a.print_job_id
          WHERE a.tenant_id = ? AND a.idempotency_key = ?`,
      ).get(scope.tenantId, input.idempotencyKey) as
        (JobRow & { outcome: AttemptOutcome | null; retryable: number | null; diagnostic_code: string | null }) | undefined;
      if (previous !== undefined) {
        return {
          kind: "REPLAY",
          job: toJob(previous),
          attempt: previous.outcome === null
            ? null
            : { outcome: previous.outcome, retryable: previous.retryable === 1, diagnosticCode: previous.diagnostic_code },
        };
      }

      const pending = db.prepare(
        `SELECT id, sale_id, copy_kind, status, last_diagnostic_code
           FROM hardware_print_job
          WHERE tenant_id = ? AND company_id = ? AND branch_id = ? AND sale_id = ? AND status = 'PENDING'
          ORDER BY created_at DESC, id DESC LIMIT 1`,
      ).get(scope.tenantId, scope.companyId, scope.branchId, input.saleId) as JobRow | undefined;

      let job: PrintJob;
      if (pending !== undefined) {
        job = toJob(pending);
        const open = db.prepare(
          "SELECT 1 FROM hardware_print_attempt WHERE tenant_id = ? AND print_job_id = ? AND outcome IS NULL",
        ).get(scope.tenantId, job.id);
        if (open !== undefined) return { kind: "IN_PROGRESS", job };
      } else {
        const hasOriginal = db.prepare(
          "SELECT 1 FROM hardware_print_job WHERE tenant_id = ? AND sale_id = ? AND copy_kind = 'ORIGINAL'",
        ).get(scope.tenantId, input.saleId) !== undefined;
        job = { id: uuidV7(), saleId: input.saleId, copy: hasOriginal ? "REPRINT" : "ORIGINAL", status: "PENDING", lastDiagnosticCode: null };
        db.prepare(
          `INSERT INTO hardware_print_job(tenant_id,id,company_id,branch_id,sale_id,copy_kind,status,
             last_diagnostic_code,created_by_user_id,created_at,updated_at)
           VALUES (?,?,?,?,?,?,'PENDING',NULL,?,?,?)`,
        ).run(scope.tenantId, job.id, scope.companyId, scope.branchId, job.saleId, job.copy, input.userId, at, at);
      }

      const attemptId = uuidV7();
      db.prepare(
        `INSERT INTO hardware_print_attempt(tenant_id,id,print_job_id,idempotency_key,requested_by_user_id,
           requested_at,outcome,retryable,diagnostic_code,finished_at)
         VALUES (?,?,?,?,?,?,NULL,NULL,NULL,NULL)`,
      ).run(scope.tenantId, attemptId, job.id, input.idempotencyKey, input.userId, at);
      return { kind: "OPENED", job, attemptId };
    }).immediate();
  }

  /** Cierra el intento con lo que dijo el equipo y deja el trabajo en su estado consecuente. */
  closeAttempt(scope: SyncScope, jobId: string, attemptId: string, result: Pick<CommandResult, "status" | "retryable" | "diagnosticCode">): PrintJobStatus {
    const at = this.now().toISOString();
    const jobStatus: PrintJobStatus = result.status === "SUCCEEDED"
      ? "PRINTED"
      : result.status === "UNKNOWN"
        ? "UNKNOWN"
        : result.retryable ? "PENDING" : "FAILED";
    const db = this.database.native;
    db.transaction(() => {
      db.prepare(
        `UPDATE hardware_print_attempt SET outcome = ?, retryable = ?, diagnostic_code = ?, finished_at = ?
          WHERE tenant_id = ? AND id = ? AND outcome IS NULL`,
      ).run(result.status, result.retryable ? 1 : 0, result.diagnosticCode, at, scope.tenantId, attemptId);
      db.prepare(
        `UPDATE hardware_print_job SET status = ?, last_diagnostic_code = ?, updated_at = ?
          WHERE tenant_id = ? AND id = ?`,
      ).run(jobStatus, result.diagnosticCode, at, scope.tenantId, jobId);
    }).immediate();
    return jobStatus;
  }

  /**
   * Un intento abierto al arrancar es un corte a mitad de impresión: el papel
   * pudo salir o no. Se cierra como `INTERRUPTED` y su trabajo pasa a
   * `UNKNOWN`; nunca se reimprime solo. Devuelve cuántos cerró.
   */
  interruptOpenAttempts(): number {
    const at = this.now().toISOString();
    const db = this.database.native;
    return db.transaction((): number => {
      const open = db.prepare(
        "SELECT tenant_id, id, print_job_id FROM hardware_print_attempt WHERE outcome IS NULL",
      ).all() as { tenant_id: string; id: string; print_job_id: string }[];
      for (const attempt of open) {
        db.prepare(
          `UPDATE hardware_print_attempt SET outcome = 'INTERRUPTED', retryable = 0, diagnostic_code = 'INTERRUPTED', finished_at = ?
            WHERE tenant_id = ? AND id = ?`,
        ).run(at, attempt.tenant_id, attempt.id);
        db.prepare(
          `UPDATE hardware_print_job SET status = 'UNKNOWN', last_diagnostic_code = 'INTERRUPTED', updated_at = ?
            WHERE tenant_id = ? AND id = ? AND status = 'PENDING'`,
        ).run(at, attempt.tenant_id, attempt.print_job_id);
      }
      return open.length;
    }).immediate();
  }

  jobsForSale(scope: SyncScope, saleId: string): PrintJob[] {
    return (this.database.native.prepare(
      `SELECT id, sale_id, copy_kind, status, last_diagnostic_code FROM hardware_print_job
        WHERE tenant_id = ? AND sale_id = ? ORDER BY created_at, id`,
    ).all(scope.tenantId, saleId) as JobRow[]).map(toJob);
  }
}
