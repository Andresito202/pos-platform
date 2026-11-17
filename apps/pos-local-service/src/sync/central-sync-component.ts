import type { RuntimeComponent } from "../lifecycle.js";
import type { SyncScope } from "./durable-sync-store.js";
import { SyncDispatcher, type DispatchOutcome } from "./sync-dispatcher.js";

/**
 * Componente que despacha el outbox periódicamente.
 *
 * Arranca el temporizador de drenaje cuando hay credencial de dispositivo. Si el
 * primer despacho es `NOT_AUTHENTICATED`, registra el ciclo de vida una vez y
 * arma un re-sonda espaciado: cuando aparece credencial (aprovisionamiento
 * posterior al boot), pasa a temporizar el drenaje normal. Sin inventar un
 * segundo motor de sync.
 *
 * Sin autoridad central a la que hablar, el outbox acumula durablemente
 * (`DEC-007` local-first).
 */

export type DispatchReason = "NO_DEVICE_CREDENTIAL" | "STARTED";

export interface CentralSyncReport {
  onOutcome(outcome: DispatchOutcome): void;
  onLifecycle(reason: DispatchReason, detail: Readonly<Record<string, unknown>>): void;
}

const MIN_INTERVAL_MS = 1_000;
/** Default probe while waiting for device credential after boot NOT_AUTHENTICATED. */
const DEFAULT_AUTH_PROBE_INTERVAL_MS = 30_000;

export class CentralSyncComponent implements RuntimeComponent {
  readonly name = "central-sync";
  private timer: NodeJS.Timeout | undefined;
  private probeTimer: NodeJS.Timeout | undefined;
  private inFlight: Promise<void> | undefined;
  private stopped = false;
  private readonly authProbeIntervalMs: number;

  constructor(
    private readonly dispatcherFactory: () => SyncDispatcher,
    private readonly scope: SyncScope,
    private readonly intervalMs: number,
    private readonly report: CentralSyncReport,
    authProbeIntervalMs: number = DEFAULT_AUTH_PROBE_INTERVAL_MS,
  ) {
    if (!Number.isSafeInteger(intervalMs) || intervalMs < MIN_INTERVAL_MS) {
      throw new RangeError(`intervalMs must be an integer >= ${MIN_INTERVAL_MS}`);
    }
    if (!Number.isSafeInteger(authProbeIntervalMs) || authProbeIntervalMs < MIN_INTERVAL_MS) {
      throw new RangeError(`authProbeIntervalMs must be an integer >= ${MIN_INTERVAL_MS}`);
    }
    this.authProbeIntervalMs = authProbeIntervalMs;
  }

  async start(): Promise<void> {
    this.stopped = false;
    const dispatcher = this.dispatcherFactory();

    // Un primer despacho inmediato sirve de sonda: decide si merece la pena
    // temporizar, y de paso drena lo que quedase de la ejecución anterior.
    const initial = dispatcher.dispatchOnce(this.scope);
    this.inFlight = initial.then(() => undefined, () => undefined);
    let first: DispatchOutcome;
    try {
      first = await initial;
    } finally {
      this.inFlight = undefined;
    }
    if (this.stopped) return;
    if (first.kind === "NOT_AUTHENTICATED") {
      this.report.onLifecycle("NO_DEVICE_CREDENTIAL", { code: first.code });
      this.armAuthProbe(dispatcher);
      return;
    }
    this.report.onOutcome(first);
    this.armDispatchTimer(dispatcher);
  }

  private armAuthProbe(dispatcher: SyncDispatcher): void {
    const probe = (): void => {
      if (this.stopped || this.inFlight) return;
      this.inFlight = dispatcher.dispatchOnce(this.scope)
        .then((outcome) => {
          if (this.stopped) return;
          if (outcome.kind === "NOT_AUTHENTICATED") return;
          this.clearProbeTimer();
          this.report.onOutcome(outcome);
          this.armDispatchTimer(dispatcher);
        })
        .catch(() => {
          // Same as dispatch tick: never crash the process on transport noise.
        })
        .finally(() => { this.inFlight = undefined; });
    };
    const timer = setInterval(probe, this.authProbeIntervalMs);
    timer.unref?.();
    this.probeTimer = timer;
  }

  private armDispatchTimer(dispatcher: SyncDispatcher): void {
    this.report.onLifecycle("STARTED", { interval_ms: this.intervalMs });
    const tick = (): void => {
      if (this.stopped || this.inFlight) return;
      this.inFlight = dispatcher.dispatchOnce(this.scope)
        .then((outcome) => { this.report.onOutcome(outcome); })
        .catch(() => {
          // `dispatchOnce` no lanza: ya asienta cada desenlace en el store. Si
          // aun así llegara algo, se ignora aquí para no derribar el proceso por
          // un fallo de red. El outbox conserva el estado.
        })
        .finally(() => { this.inFlight = undefined; });
    };

    const timer = setInterval(tick, this.intervalMs);
    timer.unref?.();
    this.timer = timer;
  }

  private clearProbeTimer(): void {
    if (this.probeTimer) {
      clearInterval(this.probeTimer);
      this.probeTimer = undefined;
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.clearProbeTimer();
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    // Esperar al despacho en curso evita que `recordResponse` escriba sobre una
    // base que `LocalDatabaseComponent.stop()` ya cerró: el orden de parada es
    // inverso al de arranque, así que este componente para antes que la base.
    await this.inFlight;
    this.inFlight = undefined;
  }
}
