import type { RuntimeComponent } from "../lifecycle.js";
import type { SyncScope } from "./durable-sync-store.js";
import { SyncDispatcher, type DispatchOutcome } from "./sync-dispatcher.js";

/**
 * Componente que despacha el outbox periódicamente.
 *
 * Arranca el temporizador **sólo si consigue una credencial de dispositivo**. Lo
 * comprueba una vez, en `start()`, y si no la hay registra una línea y se queda
 * quieto. La alternativa —temporizar igualmente y fallar en cada tic— produciría
 * un log inútil cada pocos segundos durante toda la vida del proceso sin cambiar
 * nada: hoy no existe aprovisionamiento de credencial (`DEC-008` sin
 * materializar), de modo que un fallo en el primer intento no es transitorio.
 *
 * **No hacerlo arrancar no es degradar nada.** Sin autoridad central a la que
 * hablar, el outbox acumula durablemente, que es exactamente lo que `DEC-007`
 * pide de un sistema local-first sin conexión.
 */

export type DispatchReason = "NO_DEVICE_CREDENTIAL" | "STARTED";

export interface CentralSyncReport {
  onOutcome(outcome: DispatchOutcome): void;
  onLifecycle(reason: DispatchReason, detail: Readonly<Record<string, unknown>>): void;
}

const MIN_INTERVAL_MS = 1_000;

export class CentralSyncComponent implements RuntimeComponent {
  readonly name = "central-sync";
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<void> | undefined;
  private stopped = false;

  constructor(
    private readonly dispatcherFactory: () => SyncDispatcher,
    private readonly scope: SyncScope,
    private readonly intervalMs: number,
    private readonly report: CentralSyncReport,
  ) {
    if (!Number.isSafeInteger(intervalMs) || intervalMs < MIN_INTERVAL_MS) {
      throw new RangeError(`intervalMs must be an integer >= ${MIN_INTERVAL_MS}`);
    }
  }

  async start(): Promise<void> {
    this.stopped = false;
    const dispatcher = this.dispatcherFactory();

    // Un primer despacho inmediato sirve de sonda: decide si merece la pena
    // temporizar, y de paso drena lo que quedase de la ejecución anterior.
    // Track the initial dispatch too. stop() must not let the database close
    // while its response or failure is still being committed to SQLite.
    const initial = dispatcher.dispatchOnce(this.scope);
    this.inFlight = initial.then(() => undefined);
    let first: DispatchOutcome;
    try {
      first = await initial;
    } finally {
      this.inFlight = undefined;
    }
    if (this.stopped) return;
    if (first.kind === "NOT_AUTHENTICATED") {
      this.report.onLifecycle("NO_DEVICE_CREDENTIAL", { code: first.code });
      return;
    }
    this.report.onOutcome(first);
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

  async stop(): Promise<void> {
    this.stopped = true;
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
