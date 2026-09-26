import { createServer, type AddressInfo, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  CashDrawerProfileSchema,
  drawerPulseBytes,
  PrinterConnectedCashDrawer,
  SimulatedReceiptPrinter,
  TcpRawReceiptPrinter,
  type CashDrawerProfile,
} from "../src/hardware/index.js";

const PROFILE: CashDrawerProfile = { connector_pin: 2, pulse_on_ms: 50, pulse_off_ms: 250 };
const OK = 0x12;

let closeServer: (() => Promise<void>) | null = null;
afterEach(async () => {
  await closeServer?.();
  closeServer = null;
});

/** Par TCP que responde `DLE EOT n` con los bytes dados y guarda lo recibido. */
async function fakePrinter(status: { 1: number; 2: number; 4: number }): Promise<{ port: number; received: number[] }> {
  const received: number[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("data", (chunk) => {
      for (let i = 0; i < chunk.length; i += 1) {
        received.push(chunk[i]!);
        const n = chunk[i + 1];
        if (chunk[i] === 0x04 && received.at(-2) === 0x10 && (n === 1 || n === 2 || n === 4)) socket.write(Uint8Array.of(status[n]));
      }
    });
    socket.on("error", () => {});
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closeServer = () => new Promise<void>((resolve) => { for (const s of sockets) s.destroy(); server.close(() => resolve()); });
  return { port: (server.address() as AddressInfo).port, received };
}

const tcp = (port: number): TcpRawReceiptPrinter =>
  new TcpRawReceiptPrinter({ deviceId: "p1", host: "127.0.0.1", port, connectTimeoutMs: 500, ioTimeoutMs: 500, realtimeStatus: true });

describe("pulso de cajón (HW-DRW-001)", () => {
  it("ESC p con conector y tiempos en unidades de 2 ms", () => {
    expect([...drawerPulseBytes(PROFILE)]).toEqual([0x1b, 0x70, 0, 25, 125]);
    expect([...drawerPulseBytes({ connector_pin: 5, pulse_on_ms: 100, pulse_off_ms: 100 })]).toEqual([0x1b, 0x70, 1, 50, 50]);
  });

  it("el perfil rechaza tiempos que ESC p no puede expresar", () => {
    expect(CashDrawerProfileSchema.safeParse({ ...PROFILE, pulse_on_ms: 51 }).success).toBe(false);
    expect(CashDrawerProfileSchema.safeParse({ ...PROFILE, pulse_on_ms: 512 }).success).toBe(false);
    expect(CashDrawerProfileSchema.safeParse({ ...PROFILE, pulse_off_ms: 20 }).success).toBe(false);
    expect(CashDrawerProfileSchema.safeParse({ ...PROFILE, connector_pin: 3 }).success).toBe(false);
    expect(CashDrawerProfileSchema.safeParse(PROFILE).success).toBe(true);
  });

  it("sin papel no impide abrir el cajón por el par TCP real", async () => {
    const printer = await fakePrinter({ 1: OK, 2: OK, 4: OK | 0x60 });
    const result = await new PrinterConnectedCashDrawer(tcp(printer.port), PROFILE).execute({ commandId: "d1" });
    expect(result).toMatchObject({ status: "SUCCEEDED", deviceStatus: "DELIVERED", deviceId: "drawer@p1" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(printer.received.slice(-5)).toEqual([0x1b, 0x70, 0, 25, 125]);
  });

  it("con la tapa abierta el equipo no procesa comandos: no se envía el pulso", async () => {
    const printer = await fakePrinter({ 1: OK, 2: OK | 0x04, 4: OK });
    const result = await new PrinterConnectedCashDrawer(tcp(printer.port), PROFILE).execute({ commandId: "d2" });
    expect(result).toMatchObject({ status: "FAILED", diagnosticCode: "COVER_OPEN", retryable: true });
    expect(printer.received).not.toContain(0x70);
  });

  it("la impresión sigue bloqueada sin papel: la excepción es sólo del cajón", async () => {
    const printer = await fakePrinter({ 1: OK, 2: OK, 4: OK | 0x60 });
    const result = await tcp(printer.port).execute({ commandId: "t1", bytes: Uint8Array.of(0x41) });
    expect(result.diagnosticCode).toBe("PAPER_OUT");
  });

  it("no declara sensor: nunca afirma que el cajón quedó abierto", async () => {
    const simulated = new SimulatedReceiptPrinter("sim");
    const drawer = new PrinterConnectedCashDrawer(simulated, PROFILE);
    expect(drawer.capabilities).toEqual(["OPEN_PULSE"]);
    expect((await drawer.diagnostics()).capabilities).toEqual(["OPEN_PULSE"]);
    simulated.inject("PAPER_OUT");
    expect((await drawer.execute({ commandId: "d3" })).status).toBe("SUCCEEDED");
    expect([...simulated.lastDelivery()!]).toEqual([0x1b, 0x70, 0, 25, 125]);
  });
});
