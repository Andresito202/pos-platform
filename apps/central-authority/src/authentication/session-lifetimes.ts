import { AUTHENTICATION_POLICY } from "./authentication-policy.js";

type DecidedClass = "OPERATOR" | "ADMINISTRATION";

function earliest(...dates: Date[]): Date {
  return new Date(Math.min(...dates.map((date) => date.getTime())));
}

/** `A-10`: `Session.expires_at`. Absoluta: renovar no la extiende. */
export function sessionExpiresAt(authenticatedAt: Date, authenticationClass: DecidedClass): Date {
  return new Date(authenticatedAt.getTime() + AUTHENTICATION_POLICY.lifetimes[authenticationClass].sessionMs);
}

/** Un access token nunca sobrevive a su sesión. */
export function accessTokenExpiresAt(now: Date, sessionExpires: Date): Date {
  return earliest(new Date(now.getTime() + AUTHENTICATION_POLICY.lifetimes.accessTokenMs), sessionExpires);
}

/**
 * `A-10`: operadores sin caducidad propia por inactividad —la gobierna el PIN
 * local— y administración con 30 min. En ambos casos, tope en la sesión.
 */
export function refreshTokenExpiresAt(now: Date, sessionExpires: Date, authenticationClass: DecidedClass): Date {
  const idle = AUTHENTICATION_POLICY.lifetimes[authenticationClass].refreshIdleMs;
  return idle === null ? sessionExpires : earliest(new Date(now.getTime() + idle), sessionExpires);
}

/**
 * `SSA.offline_valid_until <= Session.expires_at` (`A-10`, ya impuesto por
 * `sessions_offline_expiry_ck`) y `<= SAS.expires_at` (`DEC-012` §19).
 */
export function offlineValidUntil(sessionExpires: Date, snapshotExpires: Date): Date {
  return earliest(sessionExpires, snapshotExpires);
}

/** `A-10`: reautenticación reciente para operaciones críticas de administración. */
export function hasRecentReauthentication(
  lastReauthenticatedAt: Date | null,
  now: Date,
  authenticationClass: DecidedClass,
): boolean {
  const window = AUTHENTICATION_POLICY.lifetimes[authenticationClass].recentReauthMs;
  if (window === null || lastReauthenticatedAt === null) return false;
  const elapsed = now.getTime() - lastReauthenticatedAt.getTime();
  return elapsed >= 0 && elapsed <= window;
}
