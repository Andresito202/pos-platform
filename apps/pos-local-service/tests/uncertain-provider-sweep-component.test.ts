import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import { StructuredLogger, type LogRecord } from "@pos-platform/observability";
import { parseServiceConfig, type ServiceConfig } from "../src/config.js";
import { CommercialComponent } from "../src/commercial/commercial-component.js";
import { DurableSyncStore, type SyncScope } from "../src/sync/durable-sync-store.js";
import { SqliteCashShiftStore } from "../src/cash/sqlite-cash-shift-store.js";
import { SqliteInventoryStore } from "../src/inventory/sqlite-inventory-store.js";
import { SqlitePaymentStore } from "../src/payments/sqlite-payment-store.js";
import { ConfirmProviderPaymentUseCase } from "../src/payments/confirm-provider-payment-use-case.js";
import { ResolveUncertainProviderPaymentUseCase } from "../src/payments/resolve-uncertain-provider-payment-use-case.js";
import {
  SweepUncertainProviderPaymentsUseCase,
  type SweepUncertainProviderPaymentsStats,
} from "../src/payments/sweep-uncertain-provider-payments-use-case.js";
import {
  UncertainProviderSweepComponent,
  UNCERTAIN_PROVIDER_SWEEP_TICK_MS,
} from "../src/payments/uncertain-provider-sweep-component.js";
import type { PaymentProviderOutcome, PaymentProviderPort } from "../src/payments/payment-provider-port.js";

const TENANT = "018f0000-0000-7000-8000-0000000000a1";
const COMPANY = "018f0000-0000-7000-8000-0000000000a2";
const BRANCH = "018f0000-0000-7000-8000-0000000000a3";
const DEVICE = "018f0000-0000-7000-8000-0000000000a4";
const INSTALLATION = "018f0000-0000-7000-8000-0000000000a5";

const SCOPE: SyncScope = {
  tenantId: TENANT, companyId: COMPANY, branchId: BRANCH,
  deviceId: DEVICE, installationId: INSTALLATION,
};

const NOW = new Date("2026-09-06T10:00:00.000Z");

const directories: string[] = [];
const databases: LocalDatabase[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const database of databases.splice(0)) {
    try { database.close(); } catch { /* un cierre fallido no debe tapar el fallo real */ }
  }
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

async function directory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "pos-sweep-component-"));
  directories.push(value);
  return value;
}

/** Logger real con un sink en memoria: lo que se afirma es lo que se emitiría. */
function recordingLogger() {
  const records: LogRecord[] = [];
  return {
    logger: new StructuredLogger({ write: (record) => { records.push(record); } }, () => NOW),
    records,
    events: () => records.map((record) => record.event),
  };
}

const NO_STATS: SweepUncertainProviderPaymentsStats = {
  scanned: 0, queried: 0, confirmed: 0, declined: 0, rescheduled: 0, abandoned: 0, skipped: 0,
};

/**
 * Doble del caso de uso: el componente sólo ve `execute`, así que esto basta
 * para observar cuántas ejecuciones dispara y con qué alcance.
 */
function fakeSweep(behaviour: {
  readonly gate?: Promise<void>;
  readonly fail?: Error;
  readonly stats?: SweepUncertainProviderPaymentsStats;
} = {}) {
  const scopes: SyncScope[] = [];
  let active = 0;
  let maxActive = 0;
  const use = {
    async execute(scope: SyncScope): Promise<SweepUncertainProviderPaymentsStats> {
      scopes.push(scope);
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        if (behaviour.gate) await behaviour.gate;
        if (behaviour.fail) throw behaviour.fail;
        return behaviour.stats ?? NO_STATS;
      } finally {
        active -= 1;
      }
    },
  } as unknown as SweepUncertainProviderPaymentsUseCase;

  return { use, scopes, calls: () => scopes.length, maxActive: () => maxActive };
}

function component(
  sweep: SweepUncertainProviderPaymentsUseCase | undefined,
  logger: StructuredLogger,
  tickMs?: number,
) {
  return new UncertainProviderSweepComponent(() => sweep, SCOPE, logger, tickMs);
}

// ── A ────────────────────────────────────────────────────────────────────────

describe("UncertainProviderSweepComponent", () => {
  it("dispara el barrido con el alcance del servicio", async () => {
    const { logger } = recordingLogger();
    const sweep = fakeSweep({ stats: { ...NO_STATS, scanned: 1, queried: 1 } });
    const subject = component(sweep.use, logger);

    await subject.start();
    await subject.tick();
    await subject.stop();

    expect(sweep.calls()).toBe(1);
    expect(sweep.scopes[0]).toEqual(SCOPE);
  });

  it("el temporizador dispara una ejecución por intervalo", async () => {
    vi.useFakeTimers();
    const { logger } = recordingLogger();
    const sweep = fakeSweep();
    const subject = component(sweep.use, logger);

    await subject.start();
    await vi.advanceTimersByTimeAsync(UNCERTAIN_PROVIDER_SWEEP_TICK_MS - 1);
    expect(sweep.calls()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(sweep.calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(UNCERTAIN_PROVIDER_SWEEP_TICK_MS);
    expect(sweep.calls()).toBe(2);

    await subject.stop();
  });

  // ── B ──────────────────────────────────────────────────────────────────────

  it("dos disparos concurrentes no ejecutan dos barridos a la vez", async () => {
    const { logger, events } = recordingLogger();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const sweep = fakeSweep({ gate });
    const subject = component(sweep.use, logger);

    await subject.start();
    const first = subject.tick();
    // El segundo llega con el primero todavía en vuelo: declina y vuelve.
    await subject.tick();

    expect(sweep.calls()).toBe(1);
    expect(subject.skipped).toBe(1);

    release();
    await first;
    // Pasada la ejecución anterior, el siguiente tick sí ejecuta.
    await subject.tick();
    expect(sweep.calls()).toBe(2);
    expect(sweep.maxActive()).toBe(1);
    expect(events()).toContain("payments.uncertain_sweep.skipped");

    await subject.stop();
  });

  it("el tick que declina no espera a la ejecución en curso", async () => {
    const { logger } = recordingLogger();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const sweep = fakeSweep({ gate });
    const subject = component(sweep.use, logger);

    await subject.start();
    const first = subject.tick();
    // Si el tick declinado devolviera la ejecución en curso, esta espera no
    // terminaría hasta abrir la puerta, y el `await` de abajo colgaría.
    await subject.tick();

    release();
    await first;
    await subject.stop();
  });

  // ── C ──────────────────────────────────────────────────────────────────────

  it("un fallo del barrido queda registrado y no rompe el componente", async () => {
    const { logger, records, events } = recordingLogger();
    const sweep = fakeSweep({ fail: new Error("provider credentials rejected") });
    const subject = component(sweep.use, logger);

    await subject.start();
    await expect(subject.tick()).resolves.toBeUndefined();

    const failure = records.find((record) => record.event === "payments.uncertain_sweep.failed");
    expect(failure?.level).toBe("error");
    expect(failure?.fields).toMatchObject({ error_message: "provider credentials rejected" });
    expect(events()).not.toContain("payments.uncertain_sweep.completed");

    // El componente sigue vivo: el siguiente tick vuelve a ejecutar.
    await subject.tick();
    expect(sweep.calls()).toBe(2);
    await subject.stop();
  });

  it("un fallo del temporizador no produce un rechazo sin capturar", async () => {
    vi.useFakeTimers();
    const { logger } = recordingLogger();
    const sweep = fakeSweep({ fail: new Error("network down") });
    const subject = component(sweep.use, logger);
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on("unhandledRejection", onUnhandled);

    try {
      await subject.start();
      await vi.advanceTimersByTimeAsync(UNCERTAIN_PROVIDER_SWEEP_TICK_MS * 3);
      await subject.stop();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }

    expect(sweep.calls()).toBe(3);
    expect(unhandled).toEqual([]);
  });

  // ── D ──────────────────────────────────────────────────────────────────────

  it("el cierre limpia el temporizador", async () => {
    vi.useFakeTimers();
    const { logger } = recordingLogger();
    const subject = component(fakeSweep().use, logger);

    const before = vi.getTimerCount();
    await subject.start();
    expect(vi.getTimerCount()).toBe(before + 1);

    await subject.stop();
    expect(vi.getTimerCount()).toBe(before);
  });

  it("el cierre espera a la ejecución en vuelo", async () => {
    const { logger } = recordingLogger();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const sweep = fakeSweep({ gate });
    const subject = component(sweep.use, logger);

    await subject.start();
    void subject.tick();
    expect(sweep.maxActive()).toBe(1);

    let stopped = false;
    const stopping = subject.stop().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);

    release();
    await stopping;
    expect(stopped).toBe(true);
  });

  // ── E ──────────────────────────────────────────────────────────────────────

  it("después del cierre no se ejecuta ningún barrido más", async () => {
    vi.useFakeTimers();
    const { logger } = recordingLogger();
    const sweep = fakeSweep();
    const subject = component(sweep.use, logger);

    await subject.start();
    await vi.advanceTimersByTimeAsync(UNCERTAIN_PROVIDER_SWEEP_TICK_MS);
    expect(sweep.calls()).toBe(1);

    await subject.stop();
    await vi.advanceTimersByTimeAsync(UNCERTAIN_PROVIDER_SWEEP_TICK_MS * 5);
    await subject.tick();

    expect(sweep.calls()).toBe(1);
  });

  it("sin proveedor no arma temporizador y lo dice", async () => {
    vi.useFakeTimers();
    const { logger, events } = recordingLogger();
    const subject = component(undefined, logger);

    const before = vi.getTimerCount();
    await subject.start();

    expect(vi.getTimerCount()).toBe(before);
    expect(events()).toContain("payments.uncertain_sweep.disabled");
    await expect(subject.tick()).resolves.toBeUndefined();
    await subject.stop();
  });

  // ── G / H ──────────────────────────────────────────────────────────────────

  it("no existe configuración de intervalo, así que el valor explícito es 15 s", () => {
    // Si el proyecto tuviera una llave para esto, `parseServiceConfig` la
    // aceptaría. Su lista de claves `POS_*` es estricta y la rechaza, que es la
    // evidencia de que no hay configuración previa que reutilizar.
    expect(() => parseServiceConfig({
      POS_DATA_DIRECTORY: "/tmp/pos",
      POS_INSTALLATION_ID: INSTALLATION,
      POS_DEVICE_ID: DEVICE,
      POS_SERVICE_VERSION: "1.0.0",
      POS_PROTOCOL_MIN: "1.0.0",
      POS_PROTOCOL_MAX: "1.0.0",
      POS_TENANT_ID: TENANT,
      POS_COMPANY_ID: COMPANY,
      POS_BRANCH_ID: BRANCH,
      POS_UNCERTAIN_SWEEP_INTERVAL_MS: "15000",
    } as NodeJS.ProcessEnv)).toThrow("POS_UNCERTAIN_SWEEP_INTERVAL_MS");

    expect(UNCERTAIN_PROVIDER_SWEEP_TICK_MS).toBe(15_000);
  });

  it("respeta el intervalo que se le inyecta", async () => {
    vi.useFakeTimers();
    const { logger } = recordingLogger();
    const sweep = fakeSweep();
    const subject = component(sweep.use, logger, 500);

    await subject.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sweep.calls()).toBe(2);
    await subject.stop();
  });

  it("rechaza un intervalo que no es un entero positivo", () => {
    const { logger } = recordingLogger();
    expect(() => component(fakeSweep().use, logger, 0)).toThrow("positive integer");
    expect(() => component(fakeSweep().use, logger, 1.5)).toThrow("positive integer");
  });
});

// ── F ────────────────────────────────────────────────────────────────────────

describe("integración con el caso de uso existente", () => {
  async function realSweep() {
    const dir = await directory();
    const database = LocalDatabase.open({ dataDirectory: dir });
    databases.push(database);
    const sync = new DurableSyncStore(database);
    const paymentStore = new SqlitePaymentStore(
      database, sync,
      new SqliteCashShiftStore(database, sync, () => NOW),
      new SqliteInventoryStore(database, sync, () => NOW),
      () => NOW,
    );
    const asked: string[] = [];
    const provider: PaymentProviderPort = {
      async createPaymentIntent() { throw new Error("no usado"); },
      async getPaymentStatus(input): Promise<PaymentProviderOutcome> {
        asked.push(input.providerTransactionId);
        return { kind: "UNKNOWN", reason: "TIMEOUT" };
      },
      async normalizeNotification() { throw new Error("no usado"); },
    };
    const resolver = new ResolveUncertainProviderPaymentUseCase(
      paymentStore, new ConfirmProviderPaymentUseCase(paymentStore),
    );
    const sweep = new SweepUncertainProviderPaymentsUseCase(
      paymentStore, provider, resolver, () => NOW,
    );
    return { sweep, asked, database };
  }

  it("el componente invoca el caso de uso real, no una copia de su lógica", async () => {
    const { logger } = recordingLogger();
    const { sweep, asked } = await realSweep();
    const execute = vi.spyOn(sweep, "execute");

    const subject = new UncertainProviderSweepComponent(() => sweep, SCOPE, logger);
    await subject.start();
    await subject.tick();
    await subject.stop();

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0]).toEqual(SCOPE);
    // Sin candidatos elegibles el barrido no le pregunta nada al proveedor: la
    // elegibilidad la sigue decidiendo `next_attempt_at`, no el invocador.
    await expect(execute.mock.results[0]?.value).resolves.toMatchObject({ scanned: 0, queried: 0 });
    expect(asked).toEqual([]);
  });

  it("el componente comercial construye el barrido sólo cuando hay proveedor", async () => {
    const dir = await directory();
    const database = LocalDatabase.open({ dataDirectory: dir });
    databases.push(database);
    const sync = new DurableSyncStore(database);
    const config = {
      tenant_id: TENANT, company_id: COMPANY, branch_id: BRANCH,
      device_id: DEVICE, installation_id: INSTALLATION,
    } as ServiceConfig;

    const withoutProvider = new CommercialComponent(
      config, { database } as never, { store: sync } as never, new Map(), () => NOW,
    );
    await withoutProvider.start();
    expect(withoutProvider.sweepUncertainProviderPayments).toBeUndefined();
    await withoutProvider.stop();

    const provider: PaymentProviderPort = {
      async createPaymentIntent() { throw new Error("no usado"); },
      async getPaymentStatus(): Promise<PaymentProviderOutcome> {
        return { kind: "UNKNOWN", reason: "TIMEOUT" };
      },
      async normalizeNotification() { throw new Error("no usado"); },
    };
    const withProvider = new CommercialComponent(
      config, { database } as never, { store: sync } as never, new Map(), () => NOW, provider,
    );
    await withProvider.start();
    expect(withProvider.sweepUncertainProviderPayments)
      .toBeInstanceOf(SweepUncertainProviderPaymentsUseCase);
    await withProvider.stop();
  });
});
