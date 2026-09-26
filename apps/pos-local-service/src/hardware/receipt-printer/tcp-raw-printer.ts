import { isIPv4, Socket } from "node:net";
import type { CommandResult, DeviceAdapter, DeviceDiagnostics, DeviceHealth } from "../device-port.js";

export interface PrintJobCommand {
  /** Identidad del trabajo, estable entre reintentos (`DEC-010` §Impresión). */
  readonly commandId: string;
  readonly bytes: Uint8Array;
}

export interface TcpRawPrinterOptions {
  readonly deviceId: string;
  readonly host: string;
  readonly port: number;
  readonly connectTimeoutMs: number;
  readonly ioTimeoutMs: number;
  /**
   * Si el modelo responde a `DLE EOT n` por la misma conexión. Es una
   * capacidad, no un supuesto: con `false` no se consulta nada y un equipo sin
   * papel sólo se descubre mirándolo.
   */
  readonly realtimeStatus: boolean;
  readonly now?: () => Date;
}

/**
 * «Red local restringida» (`integration-contracts.md` §Perfil de conexión):
 * sólo una IPv4 literal privada, de enlace local o de bucle. Un nombre DNS
 * podría resolver a cualquier sitio, y este canal transporta el contenido de
 * cada venta.
 */
function isRestrictedLocalIpv4(host: string): boolean {
  if (!isIPv4(host)) return false;
  const [a, b] = host.split(".").map(Number) as [number, number];
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

const DLE = 0x10;
const EOT = 0x04;

/** Bits fijos de toda respuesta `DLE EOT`: bit1 y bit4 a 1, bit0 y bit7 a 0. */
const isStatusByte = (value: number): boolean => (value & 0x93) === 0x12;

class PhaseError extends Error {
  constructor(readonly phase: "CONNECT" | "STATUS" | "SEND", readonly timedOut: boolean, cause?: unknown) {
    super(`${phase} ${timedOut ? "timeout" : "error"}`, { cause });
  }
}

/** Una conexión con lectura byte a byte y plazos explícitos por fase. */
class PrinterConnection {
  private readonly received: number[] = [];
  private waiter: (() => void) | null = null;
  private failure: Error | null = null;

  private constructor(private readonly socket: Socket, private readonly ioTimeoutMs: number) {
    socket.on("data", (chunk: Buffer) => {
      this.received.push(...chunk);
      this.waiter?.();
    });
    socket.on("error", (error) => {
      this.failure = error;
      this.waiter?.();
    });
    socket.on("close", () => {
      this.failure ??= new Error("connection closed");
      this.waiter?.();
    });
  }

  static open(host: string, port: number, connectTimeoutMs: number, ioTimeoutMs: number): Promise<PrinterConnection> {
    return new Promise((resolve, reject) => {
      const socket = new Socket();
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new PhaseError("CONNECT", true));
      }, connectTimeoutMs);
      socket.once("error", (error) => {
        clearTimeout(timer);
        socket.destroy();
        reject(new PhaseError("CONNECT", false, error));
      });
      socket.connect(port, host, () => {
        clearTimeout(timer);
        socket.removeAllListeners("error");
        resolve(new PrinterConnection(socket, ioTimeoutMs));
      });
    });
  }

  async queryStatus(n: 1 | 2 | 4): Promise<number> {
    this.socket.write(Uint8Array.of(DLE, EOT, n));
    const deadline = Date.now() + this.ioTimeoutMs;
    while (this.received.length === 0) {
      if (this.failure !== null) throw new PhaseError("STATUS", false, this.failure);
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new PhaseError("STATUS", true);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, remaining);
        this.waiter = () => { clearTimeout(timer); resolve(); };
      });
      this.waiter = null;
    }
    return this.received.shift()!;
  }

  /** Resuelve cuando los bytes salieron y el otro extremo aceptó el cierre de escritura. */
  send(bytes: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new PhaseError("SEND", true)), this.ioTimeoutMs);
      const fail = (error: unknown): void => { clearTimeout(timer); reject(new PhaseError("SEND", false, error)); };
      if (this.failure !== null) {
        fail(this.failure);
        return;
      }
      this.socket.once("error", fail);
      this.socket.write(bytes, (error) => {
        if (error) {
          fail(error);
          return;
        }
        this.socket.end(() => { clearTimeout(timer); resolve(); });
      });
    });
  }

  close(): void {
    this.socket.destroy();
  }
}

type Outcome = Pick<CommandResult, "status" | "deviceStatus" | "retryable" | "diagnosticCode">;

/**
 * Impresora ESC/POS por TCP crudo (puerto 9100 habitual). Estado en
 * `docs/hardware/support-matrix.md`: **`UNTESTED`** contra equipo real — lo
 * probado aquí es el protocolo contra un par TCP que emula las respuestas
 * documentadas de `DLE EOT`, no un modelo concreto.
 *
 * `SUCCEEDED` significa «bytes entregados y conexión cerrada limpiamente»,
 * que es todo lo que TCP crudo puede afirmar. Si el papel se acaba **a mitad**
 * del trabajo, este adaptador no lo ve.
 */
export class TcpRawReceiptPrinter implements DeviceAdapter<PrintJobCommand> {
  readonly adapterId = "escpos-tcp-raw";
  readonly adapterVersion = "1.0.0";
  readonly deviceKind = "RECEIPT_PRINTER" as const;
  readonly deviceId: string;
  readonly capabilities: readonly string[];
  private readonly now: () => Date;
  private lastResult: DeviceDiagnostics["lastResult"] = null;

  constructor(private readonly options: TcpRawPrinterOptions) {
    if (!isRestrictedLocalIpv4(options.host)) {
      throw new Error("printer host must be a private, link-local or loopback IPv4 literal");
    }
    if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
      throw new Error("printer port must be an integer between 1 and 65535");
    }
    this.deviceId = options.deviceId;
    this.capabilities = options.realtimeStatus ? ["PRINT", "REALTIME_STATUS"] : ["PRINT"];
    this.now = options.now ?? (() => new Date());
  }

  async health(): Promise<DeviceHealth> {
    const outcome = await this.withConnection(async (connection) => this.readStatus(connection));
    return { deviceStatus: outcome?.deviceStatus ?? "READY", checkedAt: this.now(), diagnosticCode: outcome?.diagnosticCode ?? null };
  }

  async execute(command: PrintJobCommand): Promise<CommandResult> {
    const startedAt = this.now();
    const outcome = await this.withConnection(async (connection) => {
      const blocked = await this.readStatus(connection);
      if (blocked !== null) return blocked;
      await connection.send(command.bytes);
      return { status: "SUCCEEDED", deviceStatus: "DELIVERED", retryable: false, diagnosticCode: null } satisfies Outcome;
    });
    const result: CommandResult = {
      commandId: command.commandId,
      deviceId: this.deviceId,
      ...(outcome ?? { status: "SUCCEEDED", deviceStatus: "READY", retryable: false, diagnosticCode: null }),
      startedAt,
      finishedAt: this.now(),
      result: null,
    };
    this.lastResult = { commandId: result.commandId, status: result.status, diagnosticCode: result.diagnosticCode, finishedAt: result.finishedAt };
    return result;
  }

  async diagnostics(): Promise<DeviceDiagnostics> {
    return {
      adapterId: this.adapterId,
      adapterVersion: this.adapterVersion,
      deviceKind: this.deviceKind,
      connection: `tcp://${this.options.host}:${String(this.options.port)}`,
      capabilities: this.capabilities,
      lastResult: this.lastResult,
    };
  }

  /** `null` = el equipo puede imprimir (o no sabe informar su estado). */
  private async readStatus(connection: PrinterConnection): Promise<Outcome | null> {
    if (!this.options.realtimeStatus) return null;
    const printer = await connection.queryStatus(1);
    const offlineCause = await connection.queryStatus(2);
    const paper = await connection.queryStatus(4);
    if (![printer, offlineCause, paper].every(isStatusByte)) {
      return { status: "FAILED", deviceStatus: "UNKNOWN", retryable: false, diagnosticCode: "STATUS_PROTOCOL_MISMATCH" };
    }
    if ((paper & 0x60) !== 0) return { status: "FAILED", deviceStatus: "PAPER_OUT", retryable: true, diagnosticCode: "PAPER_OUT" };
    if ((offlineCause & 0x04) !== 0) return { status: "FAILED", deviceStatus: "COVER_OPEN", retryable: true, diagnosticCode: "COVER_OPEN" };
    if ((printer & 0x08) !== 0) return { status: "FAILED", deviceStatus: "OFFLINE", retryable: true, diagnosticCode: "DEVICE_OFFLINE" };
    return null;
  }

  /**
   * Traduce cada fallo a su estado según **en qué fase** ocurrió, que es lo que
   * decide si repetir es seguro: antes de enviar el trabajo no se imprimió
   * nada; durante el envío pudo imprimirse una parte.
   */
  private async withConnection(work: (connection: PrinterConnection) => Promise<Outcome | null>): Promise<Outcome | null> {
    let connection: PrinterConnection | null = null;
    try {
      connection = await PrinterConnection.open(this.options.host, this.options.port, this.options.connectTimeoutMs, this.options.ioTimeoutMs);
      return await work(connection);
    } catch (error) {
      if (!(error instanceof PhaseError)) throw error;
      if (error.phase === "SEND") {
        return { status: "UNKNOWN", deviceStatus: "UNKNOWN", retryable: false, diagnosticCode: "DELIVERY_UNCERTAIN" };
      }
      if (error.timedOut) {
        return { status: "TIMED_OUT", deviceStatus: "UNREACHABLE", retryable: true, diagnosticCode: error.phase === "CONNECT" ? "CONNECT_TIMEOUT" : "STATUS_TIMEOUT" };
      }
      return { status: "FAILED", deviceStatus: "UNREACHABLE", retryable: true, diagnosticCode: error.phase === "CONNECT" ? "DEVICE_UNREACHABLE" : "STATUS_READ_FAILED" };
    } finally {
      connection?.close();
    }
  }
}
