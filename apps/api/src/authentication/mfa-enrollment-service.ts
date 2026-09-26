import { uuidV7 } from "@pos-platform/contracts";
import { evaluateLoginAttempt, recordLoginFailure, recordLoginSuccess } from "./login-throttle.js";
import { MfaSecretCipher } from "./mfa-secret-cipher.js";
import { burnEquivalentWork, verifyPassword, type PasswordVerification } from "./password-hasher.js";
import { normalizeLoginName } from "./tenant-login-service.js";
import { base32Encode, generateTotpSecret, totpProvisioningUri, verifyTotp } from "./totp.js";
import type { TenantLoginStore, TenantLoginTransaction } from "./tenant-login-store.js";

export interface MfaEnrollmentRequest {
  readonly tenantId: string;
  readonly loginName: string;
  readonly password: string;
}

export type BeginMfaEnrollmentOutcome =
  | { readonly kind: "ENROLLMENT_STARTED"; readonly factorId: string; readonly secretBase32: string; readonly otpauthUri: string }
  | { readonly kind: "REJECTED" }
  | { readonly kind: "THROTTLED"; readonly retryAt: Date };

export type ConfirmMfaEnrollmentOutcome =
  | { readonly kind: "ACTIVATED" }
  | { readonly kind: "REJECTED" }
  | { readonly kind: "THROTTLED"; readonly retryAt: Date }
  | { readonly kind: "NO_PENDING_FACTOR" }
  | { readonly kind: "CODE_INVALID" };

/**
 * Enrolamiento del segundo factor de administración (`A-4`).
 *
 * **Por qué reautentica con contraseña en vez de exigir una sesión previa:**
 * el primer administrador de un comercio no puede tener todavía una sesión
 * —el login mismo la rechaza con `MFA_NOT_ENROLLED` hasta que exista un
 * factor activo—, así que exigir sesión sería un candado sin llave. En
 * cambio, se exige lo mismo que demuestra identidad en el login: la
 * contraseña, con el mismo contador de intentos (`user_credentials`).
 *
 * **Por qué no reutiliza `TenantLoginService.login`:** ese método siempre
 * termina en abrir sesión o rechazar; aquí el éxito es «mostrar un secreto
 * nuevo», un resultado que no cabe en `TenantLoginOutcome`. Se acepta
 * repetir la orquestación de verificación de contraseña —las funciones
 * puras que hacen el trabajo de seguridad real (`evaluateLoginAttempt`,
 * `verifyPassword`, el throttle) no se duplican, se llaman igual aquí que
 * allá— en vez de forzar ambos flujos a compartir un método más grande y
 * más frágil de tocar.
 */
export class MfaEnrollmentService {
  constructor(
    private readonly store: TenantLoginStore,
    private readonly cipher: MfaSecretCipher,
    private readonly issuer: string,
    private readonly now: () => Date = () => new Date(),
    private readonly verify: (password: string, verifier: string) => Promise<PasswordVerification> = verifyPassword,
    private readonly burn: (password: string) => Promise<void> = burnEquivalentWork,
  ) {}

  beginEnrollment(request: MfaEnrollmentRequest): Promise<BeginMfaEnrollmentOutcome> {
    return this.store.inTenant(request.tenantId, async (transaction) => {
      const reauth = await this.reauthenticate(transaction, request);
      if (reauth.kind !== "OK") return reauth;

      const secret = generateTotpSecret();
      const factorId = uuidV7(this.now().getTime());
      await transaction.appendSecurityEvent({
        eventCode: "LOGIN_SUCCEEDED", result: "ACCEPTED", reasonCode: "MFA_ENROLLMENT_STARTED",
        userId: reauth.userId, session: null, ipAddress: null, correlationId: factorId, occurredAt: this.now(),
      });
      await this.insertPendingFactor(transaction, reauth.userId, factorId, this.cipher.encrypt(secret));
      return {
        kind: "ENROLLMENT_STARTED",
        factorId,
        secretBase32: base32Encode(secret),
        otpauthUri: totpProvisioningUri({ secret, accountName: request.loginName, issuer: this.issuer }),
      };
    });
  }

  confirmEnrollment(request: MfaEnrollmentRequest & { readonly factorId: string; readonly code: string }): Promise<ConfirmMfaEnrollmentOutcome> {
    return this.store.inTenant(request.tenantId, async (transaction) => {
      const reauth = await this.reauthenticate(transaction, request);
      if (reauth.kind !== "OK") return reauth;

      const pending = await this.findPendingFactorForUpdate(transaction, reauth.userId, request.factorId);
      if (pending === null) return { kind: "NO_PENDING_FACTOR" };

      const secret = this.cipher.decrypt(pending.encryptedSecret);
      const verification = verifyTotp(secret, request.code, this.now().getTime() / 1000);
      if (!verification.valid) return { kind: "CODE_INVALID" };

      await this.activateFactor(transaction, pending.id, verification.step);
      return { kind: "ACTIVATED" };
    });
  }

  private async reauthenticate(
    transaction: TenantLoginTransaction,
    request: MfaEnrollmentRequest,
  ): Promise<{ readonly kind: "OK"; readonly userId: string } | { readonly kind: "REJECTED" } | { readonly kind: "THROTTLED"; readonly retryAt: Date }> {
    const now = this.now();
    const loginName = normalizeLoginName(request.loginName);
    const candidate = loginName === "" ? null : await transaction.findForUpdate(loginName);
    const credential = candidate?.credential ?? null;
    if (candidate === null || credential === null) {
      await this.burn(request.password);
      return { kind: "REJECTED" };
    }
    const throttle = evaluateLoginAttempt(credential.throttle, now);
    if (throttle.kind !== "ALLOWED") {
      return { kind: "THROTTLED", retryAt: throttle.kind === "WAIT" ? throttle.retryAt : throttle.until };
    }
    const verification = await this.verify(request.password, credential.verifier);
    if (!verification.matches) {
      await transaction.saveThrottle(credential.id, recordLoginFailure(credential.throttle, now));
      return { kind: "REJECTED" };
    }
    await transaction.saveThrottle(credential.id, recordLoginSuccess());
    if (!candidate.userActive || !candidate.membershipActive) return { kind: "REJECTED" };
    return { kind: "OK", userId: candidate.userId };
  }

  // Los tres métodos siguientes usan una faceta más amplia de la transacción
  // que `TenantLoginTransaction` no declara (enrolamiento no es login): se
  // comprueba con `in` en vez de ensanchar esa interfaz para un caso que
  // sólo usa este servicio.
  private async insertPendingFactor(transaction: TenantLoginTransaction, userId: string, factorId: string, encryptedSecret: string): Promise<void> {
    await requireMfaEnrollmentPort(transaction).insertPendingTotpFactor({ factorId, userId, encryptedSecret, enrolledAt: this.now() });
  }
  private async findPendingFactorForUpdate(transaction: TenantLoginTransaction, userId: string, factorId: string) {
    return requireMfaEnrollmentPort(transaction).findPendingTotpFactorForUpdate(userId, factorId);
  }
  private async activateFactor(transaction: TenantLoginTransaction, factorId: string, step: number): Promise<void> {
    await requireMfaEnrollmentPort(transaction).activateTotpFactor(factorId, step, this.now());
  }
}

export interface MfaEnrollmentPort {
  insertPendingTotpFactor(input: { readonly factorId: string; readonly userId: string; readonly encryptedSecret: string; readonly enrolledAt: Date }): Promise<void>;
  findPendingTotpFactorForUpdate(userId: string, factorId: string): Promise<{ readonly id: string; readonly encryptedSecret: string } | null>;
  activateTotpFactor(factorId: string, acceptedStep: number, verifiedAt: Date): Promise<void>;
}

function requireMfaEnrollmentPort(transaction: TenantLoginTransaction): MfaEnrollmentPort {
  if (!isMfaEnrollmentPort(transaction)) throw new Error("transaction does not implement MfaEnrollmentPort");
  return transaction;
}
function isMfaEnrollmentPort(value: unknown): value is MfaEnrollmentPort {
  return typeof value === "object" && value !== null
    && "insertPendingTotpFactor" in value && "findPendingTotpFactorForUpdate" in value && "activateTotpFactor" in value;
}
