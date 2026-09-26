/**
 * Política de autenticación ratificada en `DEC-026` (`SEC-G02`), versión 1.
 *
 * Las cifras viven aquí, en un único objeto versionado, porque
 * `security-gates.md` §SEC-G02 exige que sean configurables y versionadas:
 * cada decisión de acceso debe poder decir con qué versión se tomó.
 */
export const AUTHENTICATION_POLICY_VERSION = 1;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** `DEC-026` §5 (`A-4`, `A-4.1`). */
const MFA_REQUIRED_ROLES = new Set([
  "PLATFORM_OWNER",
  "OWNER",
  "GENERAL_ADMIN",
  "BILLING_ADMIN",
  "SECURITY_ADMIN",
]);

/** `DEC-026` §5: contraseña + equipo enrolado; PIN de presencia en turno. */
const OPERATOR_ROLES = new Set(["CASHIER", "SUPERVISOR"]);

/**
 * `OPERATOR` y `ADMINISTRATION` son las dos columnas de la tabla de `A-10`.
 * `UNDECIDED` es cualquier rol que la ratificación no nombró: `DEC-026` §5
 * prohíbe asignarlo por inferencia, así que quien lo reciba debe negarse a
 * autenticar en vez de elegir una columna.
 */
export type AuthenticationClass = "OPERATOR" | "ADMINISTRATION" | "UNDECIDED";

export function authenticationClassFor(roleCode: string): AuthenticationClass {
  if (MFA_REQUIRED_ROLES.has(roleCode)) return "ADMINISTRATION";
  if (OPERATOR_ROLES.has(roleCode)) return "OPERATOR";
  return "UNDECIDED";
}

export const AUTHENTICATION_POLICY = {
  version: AUTHENTICATION_POLICY_VERSION,
  password: {
    /** `A-5`: NIST SP 800-63B rev. 4 — contraseña como único factor. */
    minLengthSingleFactor: 15,
    /** `A-5`: NIST SP 800-63B rev. 4 — contraseña dentro de MFA. */
    minLengthWithMfa: 8,
    /**
     * `A-5` exige admitir al menos 64. El tope existe porque cada intento
     * cuesta 128 MiB de scrypt: sin él, una contraseña de megabytes sería una
     * forma barata de agotar memoria del servidor.
     */
    maxLength: 128,
  },
  throttle: {
    /** `A-8` = `DEC-012` §18.4–§18.6. Retardo tras el fallo n (índice n-1). */
    delayAfterFailureMs: [0, 0, 5_000, 15_000] as const,
    maxFailures: 5,
    lockoutMs: 15 * MINUTE_MS,
  },
  lifetimes: {
    /** `A-10`. */
    accessTokenMs: 10 * MINUTE_MS,
    OPERATOR: { sessionMs: 24 * HOUR_MS, refreshIdleMs: null, recentReauthMs: null },
    ADMINISTRATION: { sessionMs: 12 * HOUR_MS, refreshIdleMs: 30 * MINUTE_MS, recentReauthMs: 15 * MINUTE_MS },
  },
} as const;
