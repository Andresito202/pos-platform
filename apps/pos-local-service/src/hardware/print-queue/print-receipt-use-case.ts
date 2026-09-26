import type { StoredAuthorizationSnapshot } from "../../authorization/authorization-snapshot-store.js";
import type { GetReceiptUseCase } from "../../receipts/get-receipt-use-case.js";
import type { SyncScope } from "../../sync/durable-sync-store.js";
import type { CommandResult, DeviceAdapter } from "../device-port.js";
import type { ReceiptPrinterProfile } from "../receipt-printer/print-profile.js";
import { renderReceiptTicket } from "../receipt-printer/receipt-ticket.js";
import type { PrintJobCommand } from "../receipt-printer/tcp-raw-printer.js";
import type { AttemptOutcome, PrintCopy, SqlitePrintQueueStore } from "./sqlite-print-queue-store.js";

export interface ConfiguredReceiptPrinter {
  readonly adapter: DeviceAdapter<PrintJobCommand>;
  readonly profile: ReceiptPrinterProfile;
}

export type PrintOutcome = "PRINTED" | "PRINT_FAILED" | "PRINT_REJECTED" | "PRINT_UNCERTAIN";

export type PrintReceiptResult =
  | {
    readonly kind: PrintOutcome;
    readonly jobId: string;
    readonly copy: PrintCopy;
    readonly diagnosticCode: string | null;
    /** `true` = esta petición ya había llegado; no salió un papel nuevo. */
    readonly replayed: boolean;
  }
  | { readonly kind: "IN_PROGRESS"; readonly jobId: string; readonly copy: PrintCopy }
  | { readonly kind: "NOT_CONFIGURED" | "NOT_FOUND" | "NOT_COMPLETED" | "IDEMPOTENCY_CONFLICT" }
  | { readonly kind: "UNAUTHORIZED"; readonly reason: string };

/**
 * Lo que el cajero lee de cada desenlace del equipo. `PRINT_FAILED` se puede
 * reintentar y reutilizará el mismo trabajo; `PRINT_UNCERTAIN` no se reintenta
 * solo porque el papel pudo salir — el cajero mira la impresora.
 */
function outcomeOf(outcome: AttemptOutcome, retryable: boolean): PrintOutcome {
  if (outcome === "SUCCEEDED") return "PRINTED";
  if (outcome === "UNKNOWN" || outcome === "INTERRUPTED") return "PRINT_UNCERTAIN";
  return retryable ? "PRINT_FAILED" : "PRINT_REJECTED";
}

/**
 * Imprimir el recibo de una venta cobrada (`DEC-010` §Impresión, `D-46`).
 *
 * Mismo permiso que leerlo, `SALES_RECEIPT_READ`: el papel contiene
 * exactamente lo que la pantalla del recibo ya muestra, y reimprimir está
 * marcado en el propio papel. La autorización y el «no existe / no está
 * cobrada» salen del caso de uso del recibo, no de una segunda copia de esa
 * lógica.
 *
 * Imprimir **nunca** toca la venta, el pago, la caja ni el inventario: sólo
 * la cola. Un fallo de impresión no deshace nada ni autoriza a repetir nada
 * más que este trabajo.
 */
export class PrintReceiptUseCase {
  constructor(
    private readonly getReceipt: GetReceiptUseCase,
    private readonly queue: SqlitePrintQueueStore,
    private readonly printer: ConfiguredReceiptPrinter | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(
    scope: SyncScope,
    authSnapshot: StoredAuthorizationSnapshot,
    input: { readonly saleId: string; readonly idempotencyKey: string },
  ): Promise<PrintReceiptResult> {
    const read = this.getReceipt.execute(scope, authSnapshot, input.saleId, this.now());
    if (read.kind === "UNAUTHORIZED") return read;
    if (read.kind !== "FOUND") return { kind: read.kind };
    if (this.printer === null) return { kind: "NOT_CONFIGURED" };

    const opened = this.queue.openAttempt(scope, {
      saleId: input.saleId,
      userId: authSnapshot.claims.user_id,
      idempotencyKey: input.idempotencyKey,
    });
    if (opened.kind === "REPLAY") {
      // Misma clave para otra venta: no es la misma petición, es un defecto
      // del llamador, y no se le responde con el resultado de otra.
      if (opened.job.saleId !== input.saleId) return { kind: "IDEMPOTENCY_CONFLICT" };
      if (opened.attempt === null) return { kind: "IN_PROGRESS", jobId: opened.job.id, copy: opened.job.copy };
      return {
        kind: outcomeOf(opened.attempt.outcome, opened.attempt.retryable),
        jobId: opened.job.id,
        copy: opened.job.copy,
        diagnosticCode: opened.attempt.diagnosticCode,
        replayed: true,
      };
    }
    if (opened.kind === "IN_PROGRESS") return { kind: "IN_PROGRESS", jobId: opened.job.id, copy: opened.job.copy };

    const { bytes } = renderReceiptTicket(read.receipt, this.printer.profile, opened.job.copy);
    let result: Pick<CommandResult, "status" | "retryable" | "diagnosticCode">;
    try {
      // La identidad del comando es la del trabajo: un reintento del mismo
      // papel es el mismo comando para el equipo.
      result = await this.printer.adapter.execute({ commandId: opened.job.id, bytes });
    } catch {
      // Un adaptador que lanza no dice en qué fase: pudo haber enviado algo.
      result = { status: "UNKNOWN", retryable: false, diagnosticCode: "ADAPTER_ERROR" };
    }
    this.queue.closeAttempt(scope, opened.job.id, opened.attemptId, result);
    return {
      kind: outcomeOf(result.status, result.retryable),
      jobId: opened.job.id,
      copy: opened.job.copy,
      diagnosticCode: result.diagnosticCode,
      replayed: false,
    };
  }
}
