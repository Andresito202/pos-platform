import { createHash, randomBytes } from "node:crypto";
import { uuidV7 } from "@pos-platform/contracts";
import { authenticationClassFor } from "./authentication-policy.js";
import { evaluateLoginAttempt, recordLoginFailure, recordLoginSuccess } from "./login-throttle.js";
import { burnEquivalentWork, verifyPassword, type PasswordVerification } from "./password-hasher.js";
import { refreshTokenExpiresAt, sessionExpiresAt } from "./session-lifetimes.js";
import type { SecurityEvent, TenantLoginStore, TenantLoginTransaction } from "./tenant-login-store.js";

export interface TenantLoginRequest {
  /**
   * Comercio **ya autenticado** por quien llama —hoy, nadie: lo derivará la
   * prueba de equipo—. Nunca un valor que el cliente escriba (`CLAUDE.md`,
   * principios no negociables).
   */
  readonly tenantId: string;
  readonly loginName: string;
  readonly password: string;
  readonly ipAddress: string | null;
}

/**
 * Qué se le dice al que intenta entrar. `REJECTED` es uno solo para cuenta
 * inexistente, inactiva o contraseña equivocada (`DEC-026` §9: no se
 * enumeran cuentas). Los desenlaces posteriores a una contraseña correcta sí
 * se distinguen: a esa altura quien pregunta ya probó que la conoce.
 */
export type TenantLoginOutcome =
  | {
    readonly kind: "AUTHENTICATED";
    readonly sessionId: string;
    readonly refreshToken: string;
    readonly sessionExpiresAt: Date;
    readonly refreshTokenExpiresAt: Date;
  }
  | { readonly kind: "REJECTED" }
  | { readonly kind: "THROTTLED"; readonly retryAt: Date }
  | { readonly kind: "PASSWORD_CHANGE_REQUIRED" }
  | { readonly kind: "MFA_REQUIRED" }
  | { readonly kind: "ROLE_UNDECIDED" }
  | { readonly kind: "NO_ACTIVE_ROLE" };

/** Misma normalización que exige `user_login_names_normalized_ck`. */
export function normalizeLoginName(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Login dentro de un comercio, por nombre de usuario (`DEC-026` `A-7`): el de
 * cajero y supervisor.
 *
 * Todo el intento ocurre en una transacción con la credencial bloqueada, así
 * que dos intentos simultáneos contra la misma cuenta se serializan y el
 * contador de `A-8` no se puede esquivar en paralelo.
 */
export class TenantLoginService {
  constructor(
    private readonly store: TenantLoginStore,
    private readonly now: () => Date = () => new Date(),
    private readonly verify: (password: string, verifier: string) => Promise<PasswordVerification> = verifyPassword,
    private readonly burn: (password: string) => Promise<void> = burnEquivalentWork,
  ) {}

  login(request: TenantLoginRequest): Promise<TenantLoginOutcome> {
    return this.store.inTenant(request.tenantId, (transaction) => this.attempt(transaction, request));
  }

  private async attempt(transaction: TenantLoginTransaction, request: TenantLoginRequest): Promise<TenantLoginOutcome> {
    const now = this.now();
    const correlationId = uuidV7(now.getTime());
    const event = (partial: Omit<SecurityEvent, "ipAddress" | "correlationId" | "occurredAt">): Promise<void> =>
      transaction.appendSecurityEvent({ ...partial, ipAddress: request.ipAddress, correlationId, occurredAt: now });

    const loginName = normalizeLoginName(request.loginName);
    const candidate = loginName === "" ? null : await transaction.findForUpdate(loginName);
    const credential = candidate?.credential ?? null;

    if (candidate === null || credential === null) {
      await this.burn(request.password);
      await event({ eventCode: "LOGIN_FAILED", result: "REJECTED", reasonCode: "UNKNOWN_IDENTIFIER", userId: candidate?.userId ?? null, session: null });
      return { kind: "REJECTED" };
    }

    const throttle = evaluateLoginAttempt(credential.throttle, now);
    if (throttle.kind !== "ALLOWED") {
      await event({ eventCode: "LOGIN_THROTTLED", result: "REJECTED", reasonCode: throttle.kind, userId: candidate.userId, session: null });
      return { kind: "THROTTLED", retryAt: throttle.kind === "WAIT" ? throttle.retryAt : throttle.until };
    }

    const verification = await this.verify(request.password, credential.verifier);
    if (!verification.matches) {
      await transaction.saveThrottle(credential.id, recordLoginFailure(credential.throttle, now));
      await event({ eventCode: "LOGIN_FAILED", result: "REJECTED", reasonCode: "BAD_PASSWORD", userId: candidate.userId, session: null });
      return { kind: "REJECTED" };
    }

    // La contraseña es correcta: el contador se reinicia aunque la cuenta no
    // pueda operar, porque los fallos contados eran intentos de adivinarla.
    await transaction.saveThrottle(credential.id, recordLoginSuccess());

    if (!candidate.userActive || !candidate.membershipActive) {
      await event({ eventCode: "LOGIN_FAILED", result: "REJECTED", reasonCode: "ACCOUNT_INACTIVE", userId: candidate.userId, session: null });
      return { kind: "REJECTED" };
    }

    // `A-6`: la cuenta no opera hasta cambiar la contraseña temporal. No se
    // abre sesión; el cambio volverá a pedir la temporal.
    if (credential.mustChangeAtNextLogin) {
      await event({ eventCode: "LOGIN_REFUSED", result: "REJECTED", reasonCode: "PASSWORD_CHANGE_REQUIRED", userId: candidate.userId, session: null });
      return { kind: "PASSWORD_CHANGE_REQUIRED" };
    }

    const classes = (await transaction.activeRoleCodes(candidate.membershipId, now)).map(authenticationClassFor);
    const refusal = classes.length === 0 ? "NO_ACTIVE_ROLE"
      : classes.includes("UNDECIDED") ? "ROLE_UNDECIDED"
        // `A-4`: los roles de administración exigen MFA; mientras el TOTP no
        // exista, no hay forma de satisfacerlo y no se abre sesión.
        : classes.includes("ADMINISTRATION") ? "MFA_REQUIRED"
          : null;
    if (refusal !== null) {
      await event({ eventCode: "LOGIN_REFUSED", result: "REJECTED", reasonCode: refusal, userId: candidate.userId, session: null });
      return { kind: refusal };
    }

    const sessionId = uuidV7(now.getTime());
    const expiresAt = sessionExpiresAt(now, "OPERATOR");
    const refreshToken = randomBytes(32).toString("base64url");
    const refreshExpiresAt = refreshTokenExpiresAt(now, expiresAt, "OPERATOR");
    await transaction.openSession({
      sessionId,
      userId: candidate.userId,
      membershipId: candidate.membershipId,
      authenticatedAt: now,
      expiresAt,
      refreshTokenId: uuidV7(now.getTime()),
      refreshTokenFamilyId: uuidV7(now.getTime()),
      refreshTokenHash: sha256Hex(refreshToken),
      refreshTokenExpiresAt: refreshExpiresAt,
    });
    await event({ eventCode: "LOGIN_SUCCEEDED", result: "ACCEPTED", reasonCode: null, userId: candidate.userId, session: { tenantId: request.tenantId, sessionId } });
    return { kind: "AUTHENTICATED", sessionId, refreshToken, sessionExpiresAt: expiresAt, refreshTokenExpiresAt: refreshExpiresAt };
  }
}
