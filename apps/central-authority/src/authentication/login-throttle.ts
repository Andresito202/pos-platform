import { AUTHENTICATION_POLICY } from "./authentication-policy.js";

/**
 * Estado de intentos de una credencial. `failedAttemptCount` y `lockedUntil`
 * son columnas de `identity.user_credentials` (migración 001).
 * `lastFailedAt` **no** existe en esa tabla: el backoff de `A-8` la necesita y
 * su origen persistente está pendiente (ver `DEC-026`, brechas de esquema).
 */
export interface ThrottleState {
  readonly failedAttemptCount: number;
  readonly lastFailedAt: Date | null;
  readonly lockedUntil: Date | null;
}

export type ThrottleDecision =
  | { readonly kind: "ALLOWED" }
  | { readonly kind: "WAIT"; readonly retryAt: Date }
  | { readonly kind: "LOCKED"; readonly until: Date };

export const INITIAL_THROTTLE_STATE: ThrottleState = { failedAttemptCount: 0, lastFailedAt: null, lockedUntil: null };

/** Un lockout vencido se levanta solo (`DEC-012` §18.6): vuelve a cero. */
function effective(state: ThrottleState, now: Date): ThrottleState {
  if (state.lockedUntil !== null && state.lockedUntil.getTime() <= now.getTime()) return INITIAL_THROTTLE_STATE;
  return state;
}

/**
 * Se evalúa **antes** de verificar la contraseña: un intento rechazado aquí no
 * llega al KDF ni revela si la contraseña era correcta.
 */
export function evaluateLoginAttempt(state: ThrottleState, now: Date): ThrottleDecision {
  const current = effective(state, now);
  if (current.lockedUntil !== null) return { kind: "LOCKED", until: current.lockedUntil };
  if (current.failedAttemptCount === 0 || current.lastFailedAt === null) return { kind: "ALLOWED" };

  const delays = AUTHENTICATION_POLICY.throttle.delayAfterFailureMs;
  const delay = delays[Math.min(current.failedAttemptCount, delays.length) - 1] ?? 0;
  const retryAt = new Date(current.lastFailedAt.getTime() + delay);
  return retryAt.getTime() > now.getTime() ? { kind: "WAIT", retryAt } : { kind: "ALLOWED" };
}

export function recordLoginFailure(state: ThrottleState, now: Date): ThrottleState {
  const current = effective(state, now);
  const failedAttemptCount = current.failedAttemptCount + 1;
  const { maxFailures, lockoutMs } = AUTHENTICATION_POLICY.throttle;
  return {
    failedAttemptCount,
    lastFailedAt: now,
    lockedUntil: failedAttemptCount >= maxFailures ? new Date(now.getTime() + lockoutMs) : null,
  };
}

/**
 * Éxito y desbloqueo anticipado por administrador (`A-8`) dejan el mismo
 * estado. Son operaciones distintas para la auditoría, no para el contador.
 */
export function recordLoginSuccess(): ThrottleState {
  return INITIAL_THROTTLE_STATE;
}

export function unlockByAdministrator(): ThrottleState {
  return INITIAL_THROTTLE_STATE;
}
