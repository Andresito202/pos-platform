import type { DeviceTrustClock } from "@pos-platform/device-trust";

/**
 * Guarda de reloj monótono, en memoria, para `DeviceTrustVerifier`.
 *
 * Misma limitación que `device-challenge-store.ts` y por la misma razón: un
 * reinicio del proceso olvida la última hora aceptada. Es defensa en
 * profundidad —la firma y la vigencia del desafío ya rechazan un intento
 * fuera de ventana—, no la barrera principal, así que la limitación es
 * aceptable mientras el servicio sea un solo proceso.
 */
/** Misma tolerancia que `TrustedClockGuard` local (`trusted-clock.ts`), por consistencia con `DEC-012` §19.4. */
const ROLLBACK_TOLERANCE_MS = 300_000;

export class InMemoryClockGuard implements DeviceTrustClock {
  private lastAccepted: number | null = null;

  now(): Date {
    return new Date();
  }

  accept(at: Date): void {
    const time = at.getTime();
    if (this.lastAccepted !== null && time + ROLLBACK_TOLERANCE_MS < this.lastAccepted) {
      throw new Error("clock rollback rejected");
    }
    if (this.lastAccepted === null || time > this.lastAccepted) this.lastAccepted = time;
  }
}
