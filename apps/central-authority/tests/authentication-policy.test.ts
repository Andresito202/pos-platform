import { describe, expect, it } from "vitest";
import { authenticationClassFor } from "../src/authentication/authentication-policy.js";
import { evaluatePassword, type CompromisedPasswordList } from "../src/authentication/password-policy.js";
import {
  INITIAL_THROTTLE_STATE,
  evaluateLoginAttempt,
  recordLoginFailure,
  recordLoginSuccess,
  type ThrottleState,
} from "../src/authentication/login-throttle.js";
import {
  accessTokenExpiresAt,
  hasRecentReauthentication,
  offlineValidUntil,
  refreshTokenExpiresAt,
  sessionExpiresAt,
} from "../src/authentication/session-lifetimes.js";
import { burnEquivalentWork, hashPassword, verifyPassword } from "../src/authentication/password-hasher.js";
import { generateTemporaryPassword } from "../src/authentication/temporary-password.js";

/**
 * `DEC-026` (`SEC-G02`) — la política ratificada, fijada como comportamiento.
 * Cada caso cita la decisión que lo exige; si una cifra cambia, cambia aquí y
 * en el ADR a la vez.
 */

const NONE_COMPROMISED: CompromisedPasswordList = { contains: async () => false };
const at = (iso: string) => new Date(iso);
const T0 = at("2026-09-26T12:00:00.000Z");
const plus = (ms: number) => new Date(T0.getTime() + ms);
const MIN = 60_000;
const HOUR = 60 * MIN;

describe("A-4 — clase de autenticación por rol", () => {
  it.each(["PLATFORM_OWNER", "OWNER", "GENERAL_ADMIN", "BILLING_ADMIN", "SECURITY_ADMIN"])(
    "%s exige MFA", (role) => expect(authenticationClassFor(role)).toBe("ADMINISTRATION"),
  );
  it.each(["CASHIER", "SUPERVISOR"])("%s es operador", (role) => expect(authenticationClassFor(role)).toBe("OPERATOR"));

  /** `DEC-026` §5: un rol no nombrado no se asigna por inferencia. */
  it("un rol no ratificado queda UNDECIDED y la contraseña se rechaza", async () => {
    expect(authenticationClassFor("SUPPORT_AGENT")).toBe("UNDECIDED");
    expect(await evaluatePassword("x".repeat(40), "UNDECIDED", NONE_COMPROMISED))
      .toEqual({ accepted: false, reason: "ROLE_UNDECIDED" });
  });
});

describe("A-5 — longitud de contraseña (NIST SP 800-63B rev. 4)", () => {
  it("operador: 14 no, 15 sí", async () => {
    expect(await evaluatePassword("a".repeat(14), "OPERATOR", NONE_COMPROMISED)).toEqual({ accepted: false, reason: "TOO_SHORT" });
    expect(await evaluatePassword("a".repeat(15), "OPERATOR", NONE_COMPROMISED)).toEqual({ accepted: true });
  });

  it("administración con MFA: 7 no, 8 sí", async () => {
    expect(await evaluatePassword("a".repeat(7), "ADMINISTRATION", NONE_COMPROMISED)).toEqual({ accepted: false, reason: "TOO_SHORT" });
    expect(await evaluatePassword("a".repeat(8), "ADMINISTRATION", NONE_COMPROMISED)).toEqual({ accepted: true });
  });

  it("admite al menos 64 caracteres y rechaza lo desmesurado", async () => {
    expect(await evaluatePassword("a".repeat(64), "OPERATOR", NONE_COMPROMISED)).toEqual({ accepted: true });
    expect(await evaluatePassword("a".repeat(129), "OPERATOR", NONE_COMPROMISED)).toEqual({ accepted: false, reason: "TOO_LONG" });
  });

  it("sin reglas de composición: sólo minúsculas y espacios es válido", async () => {
    expect(await evaluatePassword("caballo correcto grapa", "OPERATOR", NONE_COMPROMISED)).toEqual({ accepted: true });
  });

  it("cuenta puntos de código, no unidades UTF-16", async () => {
    // 15 emojis = 30 unidades UTF-16 pero 15 caracteres; 14 no debe pasar por contar doble.
    expect(await evaluatePassword("🔒".repeat(14), "OPERATOR", NONE_COMPROMISED)).toEqual({ accepted: false, reason: "TOO_SHORT" });
    expect(await evaluatePassword("🔒".repeat(15), "OPERATOR", NONE_COMPROMISED)).toEqual({ accepted: true });
  });

  it("rechaza una contraseña de la lista de filtradas", async () => {
    const list: CompromisedPasswordList = { contains: async (value) => value === "contrasena123456" };
    expect(await evaluatePassword("contrasena123456", "OPERATOR", list)).toEqual({ accepted: false, reason: "COMPROMISED" });
  });
});

describe("A-8 — intentos fallidos (mismos números que DEC-012 §18)", () => {
  function failTimes(count: number, at: Date = T0): ThrottleState {
    let state = INITIAL_THROTTLE_STATE;
    for (let index = 0; index < count; index += 1) state = recordLoginFailure(state, at);
    return state;
  }

  it("fallos 1 y 2 no imponen espera", () => {
    expect(evaluateLoginAttempt(failTimes(1), T0)).toEqual({ kind: "ALLOWED" });
    expect(evaluateLoginAttempt(failTimes(2), T0)).toEqual({ kind: "ALLOWED" });
  });

  it("tras el 3.º, 5 s; tras el 4.º, 15 s", () => {
    expect(evaluateLoginAttempt(failTimes(3), plus(4_999))).toEqual({ kind: "WAIT", retryAt: plus(5_000) });
    expect(evaluateLoginAttempt(failTimes(3), plus(5_000))).toEqual({ kind: "ALLOWED" });
    expect(evaluateLoginAttempt(failTimes(4), plus(14_999))).toEqual({ kind: "WAIT", retryAt: plus(15_000) });
  });

  it("el 5.º bloquea 15 minutos y el bloqueo se levanta solo", () => {
    const locked = failTimes(5);
    expect(evaluateLoginAttempt(locked, plus(15 * MIN - 1))).toEqual({ kind: "LOCKED", until: plus(15 * MIN) });
    expect(evaluateLoginAttempt(locked, plus(15 * MIN))).toEqual({ kind: "ALLOWED" });
    // Tras vencer, el contador vuelve a empezar: un fallo más no re-bloquea.
    expect(recordLoginFailure(locked, plus(15 * MIN)).lockedUntil).toBeNull();
  });

  it("un éxito reinicia el contador", () => {
    expect(recordLoginSuccess()).toEqual(INITIAL_THROTTLE_STATE);
  });
});

describe("A-10 — duración de tokens y sesión", () => {
  it("operador: sesión de 24 h y refresh sin caducidad propia", () => {
    const session = sessionExpiresAt(T0, "OPERATOR");
    expect(session).toEqual(plus(24 * HOUR));
    expect(refreshTokenExpiresAt(plus(HOUR), session, "OPERATOR")).toEqual(session);
  });

  it("administración: sesión de 12 h y refresh de 30 min, nunca más allá de la sesión", () => {
    const session = sessionExpiresAt(T0, "ADMINISTRATION");
    expect(session).toEqual(plus(12 * HOUR));
    expect(refreshTokenExpiresAt(plus(HOUR), session, "ADMINISTRATION")).toEqual(plus(HOUR + 30 * MIN));
    expect(refreshTokenExpiresAt(plus(12 * HOUR - 10 * MIN), session, "ADMINISTRATION")).toEqual(session);
  });

  it("el access token dura 10 min y no sobrevive a la sesión", () => {
    const session = sessionExpiresAt(T0, "OPERATOR");
    expect(accessTokenExpiresAt(T0, session)).toEqual(plus(10 * MIN));
    expect(accessTokenExpiresAt(plus(24 * HOUR - MIN), session)).toEqual(session);
  });

  it("la SSA offline nunca supera ni la sesión ni el SAS", () => {
    expect(offlineValidUntil(plus(24 * HOUR), plus(20 * HOUR))).toEqual(plus(20 * HOUR));
    expect(offlineValidUntil(plus(12 * HOUR), plus(24 * HOUR))).toEqual(plus(12 * HOUR));
  });

  it("reautenticación reciente: 15 min para administración, nunca para operador", () => {
    expect(hasRecentReauthentication(T0, plus(15 * MIN), "ADMINISTRATION")).toBe(true);
    expect(hasRecentReauthentication(T0, plus(15 * MIN + 1), "ADMINISTRATION")).toBe(false);
    expect(hasRecentReauthentication(T0, plus(MIN), "OPERATOR")).toBe(false);
    expect(hasRecentReauthentication(null, T0, "ADMINISTRATION")).toBe(false);
  });
});

describe("A-6 / A-9 — contraseña temporal", () => {
  it("cumple el mínimo más exigente y no se repite", async () => {
    const first = generateTemporaryPassword();
    const second = generateTemporaryPassword();
    expect(first).not.toEqual(second);
    expect(await evaluatePassword(first, "OPERATOR", NONE_COMPROMISED)).toEqual({ accepted: true });
    expect(first).toMatch(/^[A-HJ-NP-Za-km-np-z2-9]+$/);
  });
});

describe("hash de contraseña — scrypt con parámetros OWASP", () => {
  it("verifica la correcta, rechaza la incorrecta y no guarda la contraseña", async () => {
    const stored = await hashPassword("una frase de paso larga");
    expect(stored.startsWith("scrypt$131072$8$1$")).toBe(true);
    expect(stored).not.toContain("una frase");
    expect(await verifyPassword("una frase de paso larga", stored)).toEqual({ matches: true, needsRehash: false });
    expect(await verifyPassword("una frase de paso larg", stored)).toEqual({ matches: false, needsRehash: false });
  });

  it("dos hashes de la misma contraseña difieren (sal aleatoria)", async () => {
    expect(await hashPassword("otra frase de paso")).not.toEqual(await hashPassword("otra frase de paso"));
  });

  it("marca para re-derivar un verifier con parámetros viejos", async () => {
    const stored = await hashPassword("frase de paso vieja");
    const [prefix, , r, p, salt] = stored.split("$");
    // Mismo formato con N menor: la clave no casará, pero lo que se mide es la marca.
    const legacy = [prefix, 2 ** 14, r, p, salt, "AAAA"].join("$");
    expect((await verifyPassword("frase de paso vieja", legacy)).needsRehash).toBe(true);
  });

  it("un verifier ilegible o con parámetros imposibles responde como un fallo, sin lanzar", async () => {
    expect(await verifyPassword("lo que sea", "basura")).toEqual({ matches: false, needsRehash: false });
    expect(await verifyPassword("lo que sea", "scrypt$1099511627776$8$1$AAAA$AAAA")).toEqual({ matches: false, needsRehash: false });
    await expect(burnEquivalentWork("lo que sea")).resolves.toBeUndefined();
  });
});
