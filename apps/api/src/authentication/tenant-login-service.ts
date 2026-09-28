import { createHash, randomBytes } from "node:crypto";
import { uuidV7 } from "@pos-platform/contracts";
import { authenticationClassFor, type AuthenticationClass } from "./authentication-policy.js";
import { evaluateLoginAttempt, recordLoginFailure, recordLoginSuccess, type ThrottleState } from "./login-throttle.js";
import type { MfaSecretCipher } from "./mfa-secret-cipher.js";
import { burnEquivalentWork, verifyPassword, type PasswordVerification } from "./password-hasher.js";
import { refreshTokenExpiresAt, sessionExpiresAt } from "./session-lifetimes.js";
import { verifyTotp } from "./totp.js";
import type { OperatorSessionIssuer } from "./operator-session-issuer.js";
import type { OperatorSessionProvisioningArtifact } from "@pos-platform/contracts";
import type { SecurityEvent, TenantLoginStore, TenantLoginTransaction } from "./tenant-login-store.js";

export interface TenantLoginRequest {
  /**
   * Comercio **ya autenticado** por quien llama —la prueba de equipo, en
   * `DeviceLoginVerification`—. Nunca un valor que el cliente escriba
   * (`CLAUDE.md`, principios no negociables).
   */
  readonly tenantId: string;
  readonly loginName: string;
  readonly password: string;
  /** Exigido sólo para roles de administración (`A-4`); ignorado para el resto. */
  readonly totpCode: string | null;
  readonly ipAddress: string | null;
  /**
   * Instalación y equipo **ya verificados** por la prueba de dispositivo, igual
   * que `tenantId`. Sólo con ellos se emite sesión local: la SSA y el SAS van
   * ligados a un equipo concreto (`DEC-011`, `DEC-012`).
   */
  readonly device?: { readonly installationId: string; readonly deviceId: string } | null;
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
    /**
     * SSA + SAS firmados para el equipo (`DEC-026` §13.10). `null` si no hubo
     * equipo verificado o si este servidor no tiene claves de emisión: la
     * sesión central existe igual, pero el POS no tiene nada que activar.
     */
    readonly operatorSession: OperatorSessionProvisioningArtifact | null;
  }
  | { readonly kind: "REJECTED" }
  | { readonly kind: "THROTTLED"; readonly retryAt: Date }
  | { readonly kind: "PASSWORD_CHANGE_REQUIRED" }
  | { readonly kind: "MFA_NOT_ENROLLED" }
  | { readonly kind: "MFA_REQUIRED" }
  | { readonly kind: "MFA_INVALID" }
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
 * cajero, supervisor y —con TOTP— administración.
 *
 * Todo el intento ocurre en una transacción con la credencial (y, si aplica,
 * el factor MFA) bloqueados, así que dos intentos simultáneos contra la
 * misma cuenta se serializan y el contador de `A-8` no se puede esquivar en
 * paralelo.
 */
export class TenantLoginService {
  constructor(
    private readonly store: TenantLoginStore,
    private readonly now: () => Date = () => new Date(),
    private readonly verify: (password: string, verifier: string) => Promise<PasswordVerification> = verifyPassword,
    private readonly burn: (password: string) => Promise<void> = burnEquivalentWork,
    /**
     * Opcional a propósito: un cajero/supervisor nunca llega a necesitarlo.
     * Si un rol de administración lo necesita y no está configurado, se
     * rechaza con `MFA_NOT_ENROLLED` en vez de lanzar — un servidor sin
     * cifrador configurado no debe abrir sesiones de administración, pero
     * tampoco debe caerse por ello.
     */
    private readonly mfaCipher: MfaSecretCipher | null = null,
    /**
     * Opcional por la misma razón que `mfaCipher`: sin claves de emisión el
     * login central sigue funcionando, sólo que sin sesión local que entregar.
     */
    private readonly operatorSessionIssuer: OperatorSessionIssuer | null = null,
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

    if (!candidate.userActive || !candidate.membershipActive) {
      // El contador se reinicia aunque la cuenta no pueda operar: los fallos
      // contados eran intentos de adivinar ESTA contraseña, y ya se probó
      // que era la correcta.
      await transaction.saveThrottle(credential.id, recordLoginSuccess());
      await event({ eventCode: "LOGIN_FAILED", result: "REJECTED", reasonCode: "ACCOUNT_INACTIVE", userId: candidate.userId, session: null });
      return { kind: "REJECTED" };
    }

    // `A-6`: la cuenta no opera hasta cambiar la contraseña temporal. No se
    // abre sesión; el cambio volverá a pedir la temporal.
    if (credential.mustChangeAtNextLogin) {
      await transaction.saveThrottle(credential.id, recordLoginSuccess());
      await event({ eventCode: "LOGIN_REFUSED", result: "REJECTED", reasonCode: "PASSWORD_CHANGE_REQUIRED", userId: candidate.userId, session: null });
      return { kind: "PASSWORD_CHANGE_REQUIRED" };
    }

    const classes = (await transaction.activeRoleCodes(candidate.membershipId, now)).map(authenticationClassFor);
    if (classes.length === 0 || classes.includes("UNDECIDED")) {
      await transaction.saveThrottle(credential.id, recordLoginSuccess());
      const reason = classes.length === 0 ? "NO_ACTIVE_ROLE" : "ROLE_UNDECIDED";
      await event({ eventCode: "LOGIN_REFUSED", result: "REJECTED", reasonCode: reason, userId: candidate.userId, session: null });
      return { kind: reason };
    }
    // Roles mixtos (operador y administración a la vez) se tratan como
    // administración: es la clase más estricta, y aplicar la más laxa sería
    // rebajar la seguridad de alguien que también tiene ese privilegio.
    const authenticationClass: AuthenticationClass = classes.includes("ADMINISTRATION") ? "ADMINISTRATION" : "OPERATOR";

    if (authenticationClass === "ADMINISTRATION") {
      const mfaOutcome = await this.verifyAdministrationMfa(transaction, candidate.userId, credential.id, credential.throttle, request.totpCode, now);
      if (mfaOutcome !== null) {
        await event({ eventCode: mfaOutcome.eventCode, result: "REJECTED", reasonCode: mfaOutcome.reasonCode, userId: candidate.userId, session: null });
        return mfaOutcome.outcome;
      }
    }
    // Contraseña (y, si aplicaba, TOTP) correctos: el contador de intentos
    // se reinicia sólo ahora, con el intento ya demostrado legítimo entero.
    await transaction.saveThrottle(credential.id, recordLoginSuccess());

    const sessionId = uuidV7(now.getTime());
    const expiresAt = sessionExpiresAt(now, authenticationClass);
    const refreshToken = randomBytes(32).toString("base64url");
    const refreshExpiresAt = refreshTokenExpiresAt(now, expiresAt, authenticationClass);
    const device = request.device ?? null;
    // Dentro de la transacción del login: la proyección se lee del mismo
    // estado que autenticó, y la secuencia se consume sólo si el login
    // termina de verdad (un rollback no la devuelve, pero tampoco la emite).
    const operatorSession = device === null || this.operatorSessionIssuer === null
      ? null
      : this.operatorSessionIssuer.issue({
        tenantId: request.tenantId,
        userId: candidate.userId,
        membershipId: candidate.membershipId,
        sessionId,
        installationId: device.installationId,
        deviceId: device.deviceId,
        issuedAt: now,
        sessionExpiresAt: expiresAt,
        sequence: await transaction.nextSessionTrustSequence(),
        projection: await transaction.authorizationProjection(candidate.membershipId, now),
      });
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
      mfaStatus: authenticationClass === "ADMINISTRATION" ? "SATISFIED" : "NOT_REQUIRED",
      deviceId: device?.deviceId ?? null,
      offlineValidUntil: operatorSession === null ? null : new Date(operatorSession.session_assertion.claims.offline_valid_until),
    });
    await event({ eventCode: "LOGIN_SUCCEEDED", result: "ACCEPTED", reasonCode: null, userId: candidate.userId, session: { tenantId: request.tenantId, sessionId } });
    return { kind: "AUTHENTICATED", sessionId, refreshToken, sessionExpiresAt: expiresAt, refreshTokenExpiresAt: refreshExpiresAt, operatorSession };
  }

  /**
   * `null` significa «MFA satisfecho, continúa». Cualquier otro valor es la
   * razón exacta por la que el intento se detiene aquí, con el contador de
   * intentos de la contraseña actualizado como corresponda —un código TOTP
   * equivocado cuenta como el mismo tipo de fallo que una contraseña
   * equivocada, `A-8`, contra el mismo contador: no hay columna de
   * intentos propia en `identity.mfa_factors`, y crear una exigiría otra
   * migración para una segunda barrera que ya cubre la primera.
   */
  private async verifyAdministrationMfa(
    transaction: TenantLoginTransaction,
    userId: string,
    credentialId: string,
    credentialThrottle: ThrottleState,
    totpCode: string | null,
    now: Date,
  ): Promise<{ readonly outcome: TenantLoginOutcome; readonly eventCode: "LOGIN_REFUSED" | "MFA_FAILED"; readonly reasonCode: string } | null> {
    if (this.mfaCipher === null) {
      return { outcome: { kind: "MFA_NOT_ENROLLED" }, eventCode: "LOGIN_REFUSED", reasonCode: "MFA_NOT_ENROLLED" };
    }
    const factor = await transaction.findActiveTotpFactorForUpdate(userId);
    if (factor === null) {
      return { outcome: { kind: "MFA_NOT_ENROLLED" }, eventCode: "LOGIN_REFUSED", reasonCode: "MFA_NOT_ENROLLED" };
    }
    if (totpCode === null) {
      return { outcome: { kind: "MFA_REQUIRED" }, eventCode: "LOGIN_REFUSED", reasonCode: "MFA_REQUIRED" };
    }
    const secret = this.mfaCipher.decrypt(factor.encryptedSecret);
    const verification = verifyTotp(secret, totpCode, now.getTime() / 1000, { lastAcceptedStep: factor.lastAcceptedStep });
    if (!verification.valid) {
      // El mismo contador que la contraseña (`A-8`): incrementa desde su
      // valor real, no desde cero — un código TOTP equivocado es tan
      // fallo de autenticación como una contraseña equivocada.
      await transaction.saveThrottle(credentialId, recordLoginFailure(credentialThrottle, now));
      return { outcome: { kind: "MFA_INVALID" }, eventCode: "MFA_FAILED", reasonCode: "MFA_INVALID" };
    }
    await transaction.recordTotpAcceptedStep(factor.id, verification.step);
    return null;
  }
}
