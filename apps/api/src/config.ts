import * as z from "zod";
import { StableCodeSchema } from "@pos-platform/contracts";

const CONFIG_ENVIRONMENT_KEYS = new Set([
  "API_PORT",
  "CENTRAL_DATABASE_URL",
  "DEVICE_TRUST_ROOT_PUBLIC_KEY_PEM",
  "DEVICE_TRUST_OPERATIONAL_KEY_ID",
  "DEVICE_TRUST_OPERATIONAL_PUBLIC_KEY_PEM",
  "MFA_SECRET_ENCRYPTION_KEY_BASE64URL",
  "MFA_TOTP_ISSUER",
]);

const PublicKeyPemSchema = z.string().min(80).max(4096);

const ApiConfigSchema = z.strictObject({
  port: z.number().int().min(1).max(65_535),
  central_database_url: z.url(),
  /**
   * Sólo claves **públicas**: este proceso verifica pruebas de equipo, nunca
   * las emite (`central-authority` sigue siendo el único emisor, `DEC-022`).
   * Sin `rootPublicKey` no puede construirse `DeviceTrustVerifier` — su
   * constructor lo exige aunque este flujo no llame a
   * `verifyOperationalKey`— así que se valida aquí y no se difiere al primer
   * intento de login.
   */
  device_trust_root_public_key_pem: PublicKeyPemSchema,
  device_trust_operational_key_id: StableCodeSchema.max(128),
  device_trust_operational_public_key_pem: PublicKeyPemSchema,
  /**
   * Cifra el secreto TOTP antes de guardarlo (`MfaSecretCipher`, `DEC-026`
   * brecha `G-6`: no hay almacén de secretos central todavía). 32 bytes
   * exactos en base64url — AES-256-GCM no admite otra longitud de clave.
   */
  mfa_secret_encryption_key: z.string().base64url().transform((value, context) => {
    const bytes = Buffer.from(value, "base64url");
    if (bytes.length !== 32) {
      context.addIssue({ code: "custom", message: "mfa_secret_encryption_key must decode to exactly 32 bytes" });
      return z.NEVER;
    }
    return bytes;
  }),
  /** Nombre del emisor que la app autenticadora muestra junto al código. */
  mfa_totp_issuer: z.string().min(1).max(64),
});
export type ApiConfig = z.infer<typeof ApiConfigSchema>;

export function parseApiConfig(environment: NodeJS.ProcessEnv): ApiConfig {
  const unknownKeys = Object.keys(environment).filter((key) => key.startsWith("API_") && !CONFIG_ENVIRONMENT_KEYS.has(key)).sort();
  if (unknownKeys.length > 0) throw new Error(`unknown API service configuration: ${unknownKeys.join(", ")}`);

  return ApiConfigSchema.parse({
    port: environment.API_PORT === undefined ? 8080 : Number(environment.API_PORT),
    central_database_url: environment.CENTRAL_DATABASE_URL,
    device_trust_root_public_key_pem: environment.DEVICE_TRUST_ROOT_PUBLIC_KEY_PEM,
    device_trust_operational_key_id: environment.DEVICE_TRUST_OPERATIONAL_KEY_ID,
    device_trust_operational_public_key_pem: environment.DEVICE_TRUST_OPERATIONAL_PUBLIC_KEY_PEM,
    mfa_secret_encryption_key: environment.MFA_SECRET_ENCRYPTION_KEY_BASE64URL,
    mfa_totp_issuer: environment.MFA_TOTP_ISSUER ?? "Camacho POS Colombia",
  });
}
