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
  "SESSION_ASSERTION_SIGNING_KEY_ID",
  "SESSION_ASSERTION_SIGNING_KEY_FILE",
  "AUTHORIZATION_SNAPSHOT_SIGNING_KEY_ID",
  "AUTHORIZATION_SNAPSHOT_SIGNING_KEY_FILE",
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
  /**
   * Claves privadas con que se firman la SSA y el SAS del login (`DEC-026`
   * §13.10). Se leen de **fichero**, nunca de una variable: una clave privada
   * en el entorno acaba en volcados de proceso y registros. Van las cuatro
   * juntas o ninguna; sin ellas el login central funciona, pero no entrega
   * sesión local que el POS pueda activar.
   */
  session_trust_signing: z.strictObject({
    session_assertion_key_id: StableCodeSchema.max(128),
    session_assertion_key_file: z.string().min(1).max(4096),
    authorization_snapshot_key_id: StableCodeSchema.max(128),
    authorization_snapshot_key_file: z.string().min(1).max(4096),
  }).refine((value) => value.session_assertion_key_id !== value.authorization_snapshot_key_id, {
    message: "session assertion and authorization snapshot need distinct key ids",
  }).nullable(),
});
export type ApiConfig = z.infer<typeof ApiConfigSchema>;

const SESSION_TRUST_SIGNING_KEYS = [
  "SESSION_ASSERTION_SIGNING_KEY_ID",
  "SESSION_ASSERTION_SIGNING_KEY_FILE",
  "AUTHORIZATION_SNAPSHOT_SIGNING_KEY_ID",
  "AUTHORIZATION_SNAPSHOT_SIGNING_KEY_FILE",
] as const;

function sessionTrustSigning(environment: NodeJS.ProcessEnv): Record<string, string | undefined> | null {
  const present = SESSION_TRUST_SIGNING_KEYS.filter((key) => environment[key] !== undefined);
  if (present.length === 0) return null;
  if (present.length !== SESSION_TRUST_SIGNING_KEYS.length) {
    throw new Error(`session trust signing requires all of ${SESSION_TRUST_SIGNING_KEYS.join(", ")}`);
  }
  return {
    session_assertion_key_id: environment.SESSION_ASSERTION_SIGNING_KEY_ID,
    session_assertion_key_file: environment.SESSION_ASSERTION_SIGNING_KEY_FILE,
    authorization_snapshot_key_id: environment.AUTHORIZATION_SNAPSHOT_SIGNING_KEY_ID,
    authorization_snapshot_key_file: environment.AUTHORIZATION_SNAPSHOT_SIGNING_KEY_FILE,
  };
}

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
    session_trust_signing: sessionTrustSigning(environment),
  });
}
