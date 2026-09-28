import { BadRequestException, Body, Controller, Header, HttpCode, Inject, Ip, Post } from "@nestjs/common";
import { DeviceChallengeRequestSchema, LoginRequestSchema, MfaConfirmRequestSchema, MfaEnrollmentRequestSchema } from "./auth.dto.js";
import { DeviceLoginVerification } from "./device-login-verification.js";
import { MfaEnrollmentService } from "./mfa-enrollment-service.js";
import { TenantLoginService } from "./tenant-login-service.js";
import { DEVICE_LOGIN_VERIFICATION, MFA_ENROLLMENT_SERVICE, TENANT_LOGIN_SERVICE } from "./tokens.js";

/**
 * `POST /v1/auth/*` — primer tramo alcanzable de `SEC-G02` (`DEC-026` §13.7,
 * §13.8, §13.9).
 *
 * El `tenant_id` de un login sale de `DeviceLoginVerification`, que lo
 * deriva del registro central de equipos — nunca de un campo que el cliente
 * pudiera escribir en el cuerpo de la petición. El enrolamiento de MFA es la
 * única excepción declarada y explicada en `auth.dto.ts`.
 */
@Controller("v1/auth")
export class AuthController {
  constructor(
    @Inject(DEVICE_LOGIN_VERIFICATION) private readonly deviceLogin: DeviceLoginVerification,
    @Inject(TENANT_LOGIN_SERVICE) private readonly tenantLogin: TenantLoginService,
    @Inject(MFA_ENROLLMENT_SERVICE) private readonly mfaEnrollment: MfaEnrollmentService,
  ) {}

  @Post("device/challenge")
  @HttpCode(200)
  @Header("cache-control", "no-store")
  async issueDeviceChallenge(@Body() body: unknown) {
    const parsed = DeviceChallengeRequestSchema.safeParse(body);
    // El detalle de qué campo venía mal formado se queda fuera de la
    // respuesta: un código estable, no el volcado del error de Zod.
    if (!parsed.success) throw new BadRequestException({ result_code: "MALFORMED_REQUEST" });
    const outcome = await this.deviceLogin.issueChallenge({ deviceId: parsed.data.device_id });
    if (outcome.kind === "UNKNOWN_DEVICE") return { result_code: "UNKNOWN_DEVICE", result: null };
    return { result_code: "ISSUED", result: outcome.challenge };
  }

  @Post("login")
  @HttpCode(200)
  @Header("cache-control", "no-store")
  async login(@Body() body: unknown, @Ip() ipAddress: string) {
    const parsed = LoginRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException({ result_code: "MALFORMED_REQUEST" });
    const request = parsed.data;

    const device = await this.deviceLogin.verifyProof({
      deviceCredential: request.device_credential,
      challengeId: request.challenge_id,
      proof: request.proof,
    });
    if (device.kind !== "VERIFIED") {
      return { result_code: `DEVICE_${device.kind}`, result: null };
    }

    const outcome = await this.tenantLogin.login({
      tenantId: device.binding.tenantId,
      loginName: request.login_name,
      password: request.password,
      totpCode: request.totp_code ?? null,
      ipAddress,
      device: { installationId: device.binding.installationId, deviceId: device.binding.deviceId },
    });
    if (outcome.kind !== "AUTHENTICATED") return { result_code: outcome.kind, result: null };
    return {
      result_code: "AUTHENTICATED",
      result: {
        session_id: outcome.sessionId,
        refresh_token: outcome.refreshToken,
        session_expires_at: outcome.sessionExpiresAt.toISOString(),
        refresh_token_expires_at: outcome.refreshTokenExpiresAt.toISOString(),
        // SSA + SAS para el equipo que hizo la prueba (`DEC-026` §13.10).
        operator_session: outcome.operatorSession,
      },
    };
  }

  @Post("mfa/enroll")
  @HttpCode(200)
  @Header("cache-control", "no-store")
  async beginMfaEnrollment(@Body() body: unknown) {
    const parsed = MfaEnrollmentRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException({ result_code: "MALFORMED_REQUEST" });
    const outcome = await this.mfaEnrollment.beginEnrollment({
      tenantId: parsed.data.tenant_id, loginName: parsed.data.login_name, password: parsed.data.password,
    });
    if (outcome.kind !== "ENROLLMENT_STARTED") return { result_code: outcome.kind, result: null };
    return {
      result_code: "ENROLLMENT_STARTED",
      result: { factor_id: outcome.factorId, secret_base32: outcome.secretBase32, otpauth_uri: outcome.otpauthUri },
    };
  }

  @Post("mfa/confirm")
  @HttpCode(200)
  @Header("cache-control", "no-store")
  async confirmMfaEnrollment(@Body() body: unknown) {
    const parsed = MfaConfirmRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException({ result_code: "MALFORMED_REQUEST" });
    const outcome = await this.mfaEnrollment.confirmEnrollment({
      tenantId: parsed.data.tenant_id, loginName: parsed.data.login_name, password: parsed.data.password,
      factorId: parsed.data.factor_id, code: parsed.data.code,
    });
    return { result_code: outcome.kind, result: null };
  }
}
