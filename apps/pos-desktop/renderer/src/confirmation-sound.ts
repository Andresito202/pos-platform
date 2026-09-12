/**
 * La confirmación sonora de `DEC-016` §13.
 *
 * **Una sola señal, y sólo la venta completada la produce** (§13.2): el
 * «cha-ching» significa «cobertura suficiente, confirmada y persistida». Un
 * `PAYMENT_CONFIRMED` sobre un pago parcial **no** suena.
 *
 * No hay sistema de audio, ni bus de eventos, ni biblioteca: dos osciladores
 * sobre el `AudioContext` del navegador. La regla vive en `shouldPlayChime`,
 * que es puro y por tanto comprobable sin sonido.
 */

/**
 * El único predicado que autoriza el sonido.
 *
 * `sale_completed` es el campo que `DEC-016` §13.2 designa, y `outcome` debe ser
 * `CONFIRMED`: en un reintento el resultado llega como `IDEMPOTENT` y **no
 * vuelve a sonar** (§13.3). Por eso no basta con mirar `sale_completed`: un
 * reintento de un cobro que completó la venta la sigue declarando completada.
 */
export function shouldPlayChime(result: {
  readonly outcome: string;
  readonly sale_completed: boolean;
} | null): boolean {
  if (result === null) return false;
  return result.outcome === "CONFIRMED" && result.sale_completed;
}

type AudioContextConstructor = new () => AudioContext;

function resolveAudioContext(): AudioContextConstructor | undefined {
  const candidate = (globalThis as { AudioContext?: AudioContextConstructor }).AudioContext;
  return candidate;
}

/**
 * Reproduce la señal una vez. Si el entorno no tiene `AudioContext` —jsdom, o
 * una ventana sin permiso de audio— **no lanza**: un POS no se cae porque el
 * altavoz falle, y la confirmación visual ya informó al cajero.
 */
export function playConfirmationChime(): void {
  const Ctor = resolveAudioContext();
  if (Ctor === undefined) return;
  try {
    const context = new Ctor();
    const now = context.currentTime;
    // Dos notas ascendentes: la segunda entra cuando la primera se apaga.
    for (const [index, frequency] of [988, 1319].entries()) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      const start = now + index * 0.09;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.2);
    }
  } catch {
    // Un fallo de audio no es un fallo de cobro.
  }
}
