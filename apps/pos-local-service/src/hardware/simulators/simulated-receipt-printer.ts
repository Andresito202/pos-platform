import type { CommandResult, DeviceAdapter, DeviceDiagnostics, DeviceHealth } from "../device-port.js";
import type { PrintJobCommand } from "../receipt-printer/tcp-raw-printer.js";

/**
 * Fallos que el simulador sabe producir. Cada uno reproduce el desenlace que
 * el adaptador real da para esa situación, incluida la diferencia que más
 * importa: si el trabajo pudo llegar a imprimirse (`LOST_DURING_SEND`) o no.
 */
export type SimulatedPrinterFault = "PAPER_OUT" | "COVER_OPEN" | "OFFLINE" | "UNREACHABLE" | "TIMEOUT_BEFORE_SEND" | "LOST_DURING_SEND";

/**
 * Impresora simulada (`docs/hardware/support-matrix.md` §Simuladores).
 * Determinista, con fallos inyectables uno por comando, y con registro de
 * cada trabajo entregado para poder afirmar **cuántas veces** salió un papel.
 *
 * Usarla no sube ninguna fila de la matriz por encima de `SIMULATED`.
 */
export class SimulatedReceiptPrinter implements DeviceAdapter<PrintJobCommand> {
  readonly adapterId = "escpos-simulator";
  readonly adapterVersion = "1.0.0";
  readonly deviceKind = "RECEIPT_PRINTER" as const;
  readonly capabilities = ["PRINT", "REALTIME_STATUS"] as const;
  private readonly faults: SimulatedPrinterFault[] = [];
  private readonly deliveries: { commandId: string; bytes: Uint8Array }[] = [];
  private lastResult: DeviceDiagnostics["lastResult"] = null;

  constructor(readonly deviceId: string, private readonly now: () => Date = () => new Date()) {}

  /** El próximo `execute` sufre este fallo; se consumen en orden. */
  inject(fault: SimulatedPrinterFault): void {
    this.faults.push(fault);
  }

  /** Veces que un trabajo llegó al papel (o pudo llegar, en `LOST_DURING_SEND`). */
  deliveredCount(commandId: string): number {
    return this.deliveries.filter((delivery) => delivery.commandId === commandId).length;
  }

  lastDelivery(): Uint8Array | null {
    return this.deliveries.at(-1)?.bytes ?? null;
  }

  health(): Promise<DeviceHealth> {
    const pending = this.faults[0];
    return Promise.resolve({ deviceStatus: pending === undefined ? "READY" : pending, checkedAt: this.now(), diagnosticCode: pending ?? null });
  }

  execute(command: PrintJobCommand): Promise<CommandResult> {
    const startedAt = this.now();
    const fault = this.faults.shift();
    const outcome = ((): Pick<CommandResult, "status" | "deviceStatus" | "retryable" | "diagnosticCode"> => {
      switch (fault) {
        case undefined:
          this.deliveries.push({ commandId: command.commandId, bytes: command.bytes });
          return { status: "SUCCEEDED", deviceStatus: "DELIVERED", retryable: false, diagnosticCode: null };
        case "PAPER_OUT":
          // Igual que el adaptador real: sin papel no impide un pulso de cajón.
          if (command.requirePaper === false) {
            this.deliveries.push({ commandId: command.commandId, bytes: command.bytes });
            return { status: "SUCCEEDED", deviceStatus: "DELIVERED", retryable: false, diagnosticCode: null };
          }
          return { status: "FAILED", deviceStatus: "PAPER_OUT", retryable: true, diagnosticCode: "PAPER_OUT" };
        case "COVER_OPEN":
          return { status: "FAILED", deviceStatus: "COVER_OPEN", retryable: true, diagnosticCode: "COVER_OPEN" };
        case "OFFLINE":
          return { status: "FAILED", deviceStatus: "OFFLINE", retryable: true, diagnosticCode: "DEVICE_OFFLINE" };
        case "UNREACHABLE":
          return { status: "FAILED", deviceStatus: "UNREACHABLE", retryable: true, diagnosticCode: "DEVICE_UNREACHABLE" };
        case "TIMEOUT_BEFORE_SEND":
          return { status: "TIMED_OUT", deviceStatus: "UNREACHABLE", retryable: true, diagnosticCode: "CONNECT_TIMEOUT" };
        case "LOST_DURING_SEND":
          // Pudo imprimirse: se registra como entrega posible, que es
          // exactamente la duda que `UNKNOWN` comunica.
          this.deliveries.push({ commandId: command.commandId, bytes: command.bytes });
          return { status: "UNKNOWN", deviceStatus: "UNKNOWN", retryable: false, diagnosticCode: "DELIVERY_UNCERTAIN" };
      }
    })();
    const result: CommandResult = { commandId: command.commandId, deviceId: this.deviceId, ...outcome, startedAt, finishedAt: this.now(), result: null };
    this.lastResult = { commandId: result.commandId, status: result.status, diagnosticCode: result.diagnosticCode, finishedAt: result.finishedAt };
    return Promise.resolve(result);
  }

  diagnostics(): Promise<DeviceDiagnostics> {
    return Promise.resolve({
      adapterId: this.adapterId,
      adapterVersion: this.adapterVersion,
      deviceKind: this.deviceKind,
      connection: "simulator",
      capabilities: this.capabilities,
      lastResult: this.lastResult,
    });
  }
}
