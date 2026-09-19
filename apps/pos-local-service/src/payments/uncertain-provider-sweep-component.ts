import { randomUUID } from "node:crypto";
import type { LogLevel, StructuredLogger } from "@pos-platform/observability";
import type { RuntimeComponent } from "../lifecycle.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import type { SweepUncertainProviderPaymentsUseCase } from "./sweep-uncertain-provider-payments-use-case.js";

/**
 * Cada cuánto se le ofrece al barrido una oportunidad de ejecutarse.
 *
 * **No es una política de pagos.** Quién es elegible, cuántas veces se
 * pregunta y hasta cuándo lo decide `uncertain-payment-sweep-policy.ts` a
 * través de `next_attempt_at`; esto sólo fija con qué frecuencia el proceso
 * mira si hay algo vencido. Un tick sin trabajo no cuesta más que una consulta
 * a un índice parcial.
 *
 * El valor es explícito porque `parseServiceConfig` no tiene —ni debe tener
 * todavía— una llave para intervalos de tareas de fondo: su lista de claves
 * `POS_*` es estricta y añadirle una convertiría esta decisión en
 * configuración dinámica, que es justo lo que este bloque no hace.
 *
 * Quince segundos es el intervalo más largo que no degrada la política ya
 * cerrada: su cita más temprana ocurre a los 15 s de observarse la
 * incertidumbre, así que mirar más a menudo no adelanta ninguna consulta y
 * mirar más despacio retrasaría todas. No se importa de la política para
 * calcularlo — un invocador que leyera el backoff empezaría a ser el dueño de
 * la cadencia, y no lo es.
 */
export const UNCERTAIN_PROVIDER_SWEEP_TICK_MS = 15_000;

/**
 * Invocador de infraestructura del barrido de intentos `UNKNOWN`.
 *
 * Es la única pieza nueva entre el ciclo de vida del Local Service y
 * `SweepUncertainProviderPaymentsUseCase`, y no sabe nada de pagos: no conoce
 * backoff, ni ventana, ni `attempt_count`, ni un solo estado de pago. Su
 * trabajo entero es ofrecer oportunidades de ejecución y no pisarse a sí
 * mismo.
 *
 * ```
 * ServiceLifecycle → UncertainProviderSweepComponent → Sweep…UseCase
 *                                                        → PaymentProviderPort
 *                                                        → ResolveUncertain…UseCase
 * ```
 *
 * ## Sin proveedor no hay temporizador
 *
 * El caso de uso llega por una función y no por el constructor porque sólo
 * existe después de que arranque el componente comercial, y sólo si hay un
 * `PaymentProviderPort` inyectado. Hoy la producción no inyecta ninguno —la
 * misma carencia de aprovisionamiento de secretos que deja `registerQrPayment`
 * sin construir—, de modo que este componente arranca, dice en el log que no
 * hay a quién preguntar y **no arma ningún temporizador**. Prefiere decirlo a
 * desaparecer en silencio.
 *
 * ## Por qué un `setInterval` y no un bucle
 *
 * Un bucle con espera tendría que dormir, y dormir dentro del proceso que es
 * el único escritor de SQLite es exactamente lo que el caso de uso evita. El
 * temporizador queda registrado en un campo y se limpia en `stop()`, que es la
 * condición que el ciclo de vida real impone: nada puede sobrevivir al cierre.
 * Va `unref`'d, igual que los temporizadores de `lifecycle.ts` y
 * `channel/server.ts`, para que jamás sea él quien mantenga vivo el proceso.
 */
export class UncertainProviderSweepComponent implements RuntimeComponent {
  readonly name = "uncertain-provider-sweep";

  private timer: ReturnType<typeof setInterval> | undefined;
  private sweep: SweepUncertainProviderPaymentsUseCase | undefined;
  private inFlight: Promise<void> | undefined;
  private stopping = false;
  private skippedTicks = 0;

  constructor(
    private readonly resolveSweep: () => SweepUncertainProviderPaymentsUseCase | undefined,
    private readonly scope: SyncScope,
    private readonly logger: StructuredLogger,
    private readonly tickMs: number = UNCERTAIN_PROVIDER_SWEEP_TICK_MS,
    private readonly correlationId: () => string = randomUUID,
  ) {
    if (!Number.isSafeInteger(tickMs) || tickMs <= 0) {
      throw new Error("uncertain provider sweep tick must be a positive integer");
    }
  }

  /** Ticks que encontraron una ejecución en curso y declinaron. */
  get skipped(): number { return this.skippedTicks; }

  async start(): Promise<void> {
    this.stopping = false;
    this.skippedTicks = 0;
    this.sweep = this.resolveSweep();

    if (this.sweep === undefined) {
      this.note("info", "payments.uncertain_sweep.disabled", { reason: "NO_PAYMENT_PROVIDER" });
      return;
    }

    const timer = setInterval(() => { void this.tick(); }, this.tickMs);
    timer.unref?.();
    this.timer = timer;
  }

  async stop(): Promise<void> {
    // El orden importa: primero se cierra la puerta, después se recoge. Marcar
    // `stopping` antes de limpiar el temporizador garantiza que un tick que ya
    // estuviera encolado no llegue a preguntarle nada al proveedor.
    this.stopping = true;
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }

    // Una ejecución en vuelo se espera, no se abandona: su llamada al
    // proveedor puede acabar escribiendo, y escribir contra una base que ya se
    // está cerrando es peor que tardar. La espera está acotada por el límite
    // del propio caso de uso y, por encima, por el tiempo de parada que
    // `ServiceLifecycle` aplica a cada componente.
    await this.inFlight;
    this.inFlight = undefined;
    this.sweep = undefined;
  }

  /**
   * Una oportunidad de ejecución. Devuelve cuando la ejecución que haya
   * disparado —si disparó alguna— termina.
   *
   * Nunca rechaza. Un fallo del barrido es un fallo de infraestructura de un
   * pago concreto, no del servicio: tumbar el proceso por él dejaría al cajero
   * sin POS por una consulta a un tercero. Queda en el log con nivel `error`,
   * que es lo contrario de tragárselo.
   */
  tick(): Promise<void> {
    if (this.stopping || this.sweep === undefined) return Promise.resolve();

    // Como mucho una ejecución activa por proceso. El tick que llega tarde
    // declina y vuelve en el siguiente: esperar a la anterior convertiría los
    // ticks en una cola y haría que el cierre tuviera que drenarla.
    if (this.inFlight !== undefined) {
      this.skippedTicks += 1;
      this.note("debug", "payments.uncertain_sweep.skipped", {
        reason: "RUN_IN_PROGRESS",
        skipped_ticks: this.skippedTicks,
      });
      return Promise.resolve();
    }

    const sweep = this.sweep;
    const run: Promise<void> = (async () => {
      try {
        const stats = await sweep.execute(this.scope, {
          correlationId: this.correlationId(),
          causationId: null,
        });
        // Un barrido que no encontró nada es el caso normal y no merece una
        // línea cada quince segundos.
        if (stats.scanned > 0) {
          this.note("info", "payments.uncertain_sweep.completed", { ...stats });
        }
      } catch (error: unknown) {
        this.note("error", "payments.uncertain_sweep.failed", {
          error_name: error instanceof Error ? error.name : "UnknownError",
          error_message: error instanceof Error ? error.message : String(error),
        });
      }
    })().finally(() => {
      if (this.inFlight === run) this.inFlight = undefined;
    });

    this.inFlight = run;
    return run;
  }

  /**
   * `StructuredLogger.log` lanza si su sink ya falló o si el buffer se colmó.
   * Eso es un problema del logger —que `main.ts` resuelve cerrando el
   * servicio— y no puede además impedir que el barrido siga funcionando, así
   * que aquí se contiene. Es lo único que este componente se guarda.
   */
  private note(level: LogLevel, event: string, fields: Record<string, unknown>): void {
    try {
      this.logger.log(level, event, fields);
    } catch {
      // Intencionadamente vacío: ver el comentario de arriba.
    }
  }
}
