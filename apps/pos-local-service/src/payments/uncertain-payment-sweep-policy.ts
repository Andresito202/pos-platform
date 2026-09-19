/**
 * Cadencia y ventana de la resolución automática de intentos `UNKNOWN`
 * (`D-5`, `D-6`).
 *
 * Es aritmética pura sobre instantes: no lee base de datos, no llama al
 * proveedor y no conoce el barrido. Así la política puede comprobarse sola y
 * el barrido no tiene que reimplementarla para explicarla.
 *
 * **No reutiliza `DEFAULT_RETRY_POLICY` del outbox.** Aquella cadencia
 * reintenta un envío propio y puede permitirse empezar en 1 s; ésta le
 * pregunta a un tercero por dinero ajeno, donde preguntar demasiado pronto o
 * demasiadas veces es maltratar al proveedor sin ganar certeza. Son dos
 * problemas distintos con dos políticas distintas, y compartir los números
 * habría acoplado una decisión financiera a una de transporte.
 */

/**
 * Espera antes de cada consulta, en orden. El índice `0` es el retardo
 * inicial —desde que se observó la incertidumbre hasta la consulta 1—, y el
 * índice `n` es la espera entre la consulta `n` y la `n + 1`.
 *
 * Agotada la lista, la última espera se repite. La ventana (`D-6`) llega
 * antes que esa repetición en cualquier trayectoria natural
 * —15+30+60+120+180 = 405 s, y otra espera de 180 s cae fuera de los 480 s—,
 * así que el valor repetido sólo describe qué haría la política si alguien la
 * empujara más allá; no inventa un sexto número que `D-5` no fijó.
 */
export const UNCERTAIN_PAYMENT_BACKOFF_MS = [15_000, 30_000, 60_000, 120_000, 180_000] as const;

/** `D-5`: ninguna incertidumbre se consulta automáticamente más de seis veces. */
export const UNCERTAIN_PAYMENT_MAX_QUERIES = 6;

/** `D-5`: ocho minutos medidos desde `provider_uncertainty_observed_at`. */
export const UNCERTAIN_PAYMENT_WINDOW_MS = 8 * 60_000;

/**
 * Cuántos candidatos toca como mucho una invocación.
 *
 * El barrido es acotado por contrato: una invocación termina. El número no
 * sale de ninguna medición —no la hay— así que se elige bajo a propósito,
 * porque cada candidato es una llamada de red secuencial y el servicio local
 * es el único escritor de SQLite: una invocación larga bloquea al cajero.
 * Quien lo invoque puede pedir otro tamaño.
 */
export const UNCERTAIN_PAYMENT_SWEEP_DEFAULT_LIMIT = 25;

function delayBeforeQueryMs(queryNumber: number): number {
  const index = Math.min(queryNumber - 1, UNCERTAIN_PAYMENT_BACKOFF_MS.length - 1);
  return UNCERTAIN_PAYMENT_BACKOFF_MS[index]!;
}

/** Fin de la ventana de resolución automática, en ISO-8601. */
export function uncertaintyWindowEndsAt(observedAt: string): string {
  return new Date(Date.parse(observedAt) + UNCERTAIN_PAYMENT_WINDOW_MS).toISOString();
}

/** `true` cuando en `now` ya no queda ventana para preguntar. */
export function uncertaintyWindowExpired(observedAt: string, now: Date): boolean {
  return now.getTime() >= Date.parse(observedAt) + UNCERTAIN_PAYMENT_WINDOW_MS;
}

/**
 * Momento de la **primera** consulta automática: el retardo inicial contado
 * desde que se observó la incertidumbre, que es el origen que `D-5` fija.
 */
export function firstQueryAt(observedAt: string): string {
  return new Date(Date.parse(observedAt) + delayBeforeQueryMs(1)).toISOString();
}

/**
 * Momento de la consulta siguiente tras haber hecho `completedQueries`, o
 * `null` cuando ya no habrá otra.
 *
 * Devuelve `null` en dos casos, y los dos significan lo mismo —se acabó la
 * resolución automática, que `D-6` resuelve como `REVIEW_REQUIRED`—: el
 * presupuesto de consultas está gastado, o la próxima caería fuera de la
 * ventana.
 *
 * Nunca programa más allá del fin de la ventana: una consulta ahí no podría
 * ejecutarse (`D-6` la prohíbe antes de llamar al proveedor), de modo que
 * programarla sería anotar una cita imposible. En su lugar la cita se recorta
 * al borde, que es justo cuando el abandono queda debido.
 */
export function nextQueryAt(
  observedAt: string,
  completedQueries: number,
  from: Date,
): string | null {
  if (completedQueries >= UNCERTAIN_PAYMENT_MAX_QUERIES) return null;

  const windowEnd = Date.parse(observedAt) + UNCERTAIN_PAYMENT_WINDOW_MS;
  const scheduled = from.getTime() + delayBeforeQueryMs(completedQueries + 1);

  if (scheduled >= windowEnd) return null;
  return new Date(scheduled).toISOString();
}
