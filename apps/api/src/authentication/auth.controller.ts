import { BadRequestException, Body, Controller, Header, HttpCode, Inject, Ip, Post } from "@nestjs/common";
import { DeviceChallengeRequestSchema, LoginRequestSchema } from "./auth.dto.js";
import { DeviceLoginVerification } from "./device-login-verification.js";
import { TenantLoginService } from "./tenant-login-service.js";
import { DEVICE_LOGIN_VERIFICATION, TENANT_LOGIN_SERVICE } from "./tokens.js";

/**
 * `POST /v1/auth/*` — primer tramo alcanzable de `SEC-G02` (`DEC-026` §13.7).
 *
 * El `tenant_id` de cada login sale de `DeviceLoginVerification`, que lo
 * deriva del registro central de equipos — nunca de un campo que el cliente
 * pudiera escribir en el cuerpo de la petición.
 */
@Controller("v1/auth")
export class AuthController {
  constructor(
    @Inject(DEVICE_LOGIN_VERIFICATION) private readonly deviceLogin: DeviceLoginVerification,
    @Inject(TENANT_LOGIN_SERVICE) private readonly tenantLogin: TenantLoginService,
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
      ipAddress,
    });
    if (outcome.kind !== "AUTHENTICATED") return { result_code: outcome.kind, result: null };
    return {
      result_code: "AUTHENTICATED",
      result: {
        session_id: outcome.sessionId,
        refresh_token: outcome.refreshToken,
        session_expires_at: outcome.sessionExpiresAt.toISOString(),
        refresh_token_expires_at: outcome.refreshTokenExpiresAt.toISOString(),
      },
    };
  }
}
