import { createServer, type AddressInfo, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { SimulatedReceiptPrinter, TcpRawReceiptPrinter } from "../src/hardware/index.js";

/**
 * Par TCP que emula las respuestas `DLE EOT n` documentadas en ESC/POS. No es
 * un modelo real: prueba que el adaptador habla el protocolo y clasifica cada
 * desenlace, no que un equipo concreto responda así (`UNTESTED` en la matriz).
 */
interface FakePrinter {
  readonly port: number;
  readonly received: () => number[];
  readonly close: () => Promise<void>;
}

const OK = 0x12;

async function fakePrinter(options: {
  status?: { 1: number; 2: number; 4: number } | "SILENT";
  stopReading?: boolean;
}): Promise<FakePrinter> {
  const received: number[] = [];
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    if (options.stopReading === true) {
      socket.pause();
      return;
    }
    socket.on("data", (chunk) => {
      for (let i = 0; i < chunk.length; i += 1) {
        received.push(chunk[i]!);
        const status = options.status;
        if (status !== undefined && status !== "SILENT" && chunk[i] === 0x04 && received.at(-2) === 0x10) {
          // El byte siguiente dice qué estado se pide; puede llegar en otro trozo.
          const n = chunk[i + 1];
          if (n === 1 || n === 2 || n === 4) socket.write(Uint8Array.of(status[n]));
        }
      }
    });
    socket.on("error", () => {});
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    received: () => [...received],
    close: () => new Promise<void>((resolve) => {
      for (const socket of sockets) socket.destroy();
      server.close(() => resolve());
    }),
  };
}

const JOB = Uint8Array.of(0x1b, 0x40, 0x48, 0x4f, 0x4c, 0x41, 0x0a);
const QUERIES = [0x10, 0x04, 1, 0x10, 0x04, 2, 0x10, 0x04, 4];

let printer: FakePrinter | null = null;
afterEach(async () => {
  await printer?.close();
  printer = null;
});

const adapter = (port: number, realtimeStatus: boolean, ioTimeoutMs = 500): TcpRawReceiptPrinter =>
  new TcpRawReceiptPrinter({ deviceId: "printer-1", host: "127.0.0.1", port, connectTimeoutMs: 500, ioTimeoutMs, realtimeStatus });

describe("TcpRawReceiptPrinter", () => {
  it("consulta el estado, entrega el trabajo y cierra: SUCCEEDED", async () => {
    printer = await fakePrinter({ status: { 1: OK, 2: OK, 4: OK } });
    const result = await adapter(printer.port, true).execute({ commandId: "job-1", bytes: JOB });
    expect(result).toMatchObject({ commandId: "job-1", status: "SUCCEEDED", deviceStatus: "DELIVERED", diagnosticCode: null });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(printer.received()).toEqual([...QUERIES, ...JOB]);
  });

  it.each([
    ["sin papel", { 1: OK, 2: OK, 4: OK | 0x60 }, "PAPER_OUT"],
    ["tapa abierta", { 1: OK, 2: OK | 0x04, 4: OK }, "COVER_OPEN"],
    ["fuera de línea", { 1: OK | 0x08, 2: OK, 4: OK }, "DEVICE_OFFLINE"],
  ] as const)("%s: falla antes de enviar, reintentable, sin imprimir nada", async (_label, status, diagnostic) => {
    printer = await fakePrinter({ status });
    const result = await adapter(printer.port, true).execute({ commandId: "job-2", bytes: JOB });
    expect(result).toMatchObject({ status: "FAILED", retryable: true, diagnosticCode: diagnostic });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(printer.received()).toEqual(QUERIES);
  });

  it("una respuesta que no es un byte de estado no se interpreta: no reintentable", async () => {
    printer = await fakePrinter({ status: { 1: 0xff, 2: OK, 4: OK } });
    const result = await adapter(printer.port, true).execute({ commandId: "job-3", bytes: JOB });
    expect(result).toMatchObject({ status: "FAILED", retryable: false, diagnosticCode: "STATUS_PROTOCOL_MISMATCH" });
  });

  it("un equipo que no responde al estado agota el plazo sin haber enviado el trabajo", async () => {
    printer = await fakePrinter({ status: "SILENT" });
    const result = await adapter(printer.port, true, 200).execute({ commandId: "job-4", bytes: JOB });
    expect(result).toMatchObject({ status: "TIMED_OUT", retryable: true, diagnosticCode: "STATUS_TIMEOUT" });
    expect(printer.received()).toEqual([0x10, 0x04, 1]);
  });

  it("sin capacidad de estado, entrega directamente", async () => {
    printer = await fakePrinter({});
    const result = await adapter(printer.port, false).execute({ commandId: "job-5", bytes: JOB });
    expect(result.status).toBe("SUCCEEDED");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(printer.received()).toEqual([...JOB]);
  });

  it("equipo inalcanzable: FAILED reintentable", async () => {
    const closed = await fakePrinter({});
    const port = closed.port;
    await closed.close();
    const result = await adapter(port, true).execute({ commandId: "job-6", bytes: JOB });
    expect(result).toMatchObject({ status: "FAILED", retryable: true, diagnosticCode: "DEVICE_UNREACHABLE" });
  });

  it("si el envío no termina, el desenlace es UNKNOWN y NO se marca reintentable", async () => {
    // El par deja de leer: el trabajo grande no cabe en los búferes del
    // sistema y la escritura nunca se completa. Parte pudo imprimirse.
    printer = await fakePrinter({ stopReading: true });
    const big = new Uint8Array(64 * 1024 * 1024).fill(0x41);
    const result = await adapter(printer.port, false, 300).execute({ commandId: "job-7", bytes: big });
    expect(result).toMatchObject({ status: "UNKNOWN", retryable: false, diagnosticCode: "DELIVERY_UNCERTAIN" });
  });

  it("sólo acepta IPv4 literales de red local restringida", () => {
    const build = (host: string) => () => new TcpRawReceiptPrinter({ deviceId: "p", host, port: 9100, connectTimeoutMs: 1, ioTimeoutMs: 1, realtimeStatus: false });
    for (const host of ["192.168.1.50", "10.0.0.7", "172.16.0.1", "172.31.255.254", "169.254.1.1", "127.0.0.1"]) expect(build(host)).not.toThrow();
    for (const host of ["printer.local", "8.8.8.8", "172.32.0.1", "::1", ""]) expect(build(host)).toThrow(/IPv4 literal/);
  });

  it("diagnóstico sin contenido de trabajos, con el último desenlace", async () => {
    printer = await fakePrinter({ status: { 1: OK, 2: OK, 4: OK | 0x60 } });
    const device = adapter(printer.port, true);
    await device.execute({ commandId: "job-8", bytes: JOB });
    const diagnostics = await device.diagnostics();
    expect(diagnostics).toMatchObject({ adapterId: "escpos-tcp-raw", connection: `tcp://127.0.0.1:${String(printer.port)}`, lastResult: { commandId: "job-8", status: "FAILED", diagnosticCode: "PAPER_OUT" } });
    expect(JSON.stringify(diagnostics)).not.toContain("HOLA");
  });
});

describe("SimulatedReceiptPrinter", () => {
  it("consume fallos en orden y cuenta cuántas veces llegó un trabajo al papel", async () => {
    const simulated = new SimulatedReceiptPrinter("sim-1", () => new Date("2026-09-26T12:00:00Z"));
    simulated.inject("PAPER_OUT");
    simulated.inject("LOST_DURING_SEND");
    expect((await simulated.execute({ commandId: "a", bytes: JOB })).status).toBe("FAILED");
    expect(simulated.deliveredCount("a")).toBe(0);
    expect(await simulated.execute({ commandId: "a", bytes: JOB })).toMatchObject({ status: "UNKNOWN", retryable: false });
    expect(simulated.deliveredCount("a")).toBe(1);
    expect((await simulated.execute({ commandId: "a", bytes: JOB })).status).toBe("SUCCEEDED");
    expect(simulated.deliveredCount("a")).toBe(2);
  });
});
