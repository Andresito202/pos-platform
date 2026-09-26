import { createHmac, randomBytes } from "node:crypto";

/**
 * TOTP — RFC 6238 sobre HOTP (RFC 4226), HMAC-SHA1, paso de 30 s.
 *
 * Verificado contra los vectores oficiales del Apéndice B de RFC 6238 en
 * `totp.test.ts` (secreto ASCII `"12345678901234567890"`, modo de 8 dígitos):
 * si esta aritmética se desvía del estándar, cualquier app autenticadora
 * real (Google Authenticator, Authy, 1Password…) generaría códigos que este
 * verificador rechazaría.
 */
const STEP_SECONDS = 30;
const DIGITS = 6;
const SECRET_BYTES = 20; // igual a la salida de SHA-1: RFC 6238 §5.1 lo recomienda.

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateTotpSecret(): Buffer {
  return randomBytes(SECRET_BYTES);
}

/** RFC 4648 §6, sin relleno: es la forma que esperan las apps autenticadoras en un `otpauth://` URI. */
export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  return output;
}

function counterBytes(counter: number): Buffer {
  const buffer = Buffer.alloc(8);
  // El contador cabe en 32 bits durante milenios a 30 s/paso; se escribe en
  // los 4 bytes altos y bajos por separado porque `writeBigUInt64BE` exigiría
  // un `bigint` en todo el resto de esta función sin necesidad real.
  buffer.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buffer.writeUInt32BE(counter >>> 0, 4);
  return buffer;
}

/** HOTP (RFC 4226 §5.3): HMAC-SHA1 + truncamiento dinámico. */
function hotp(secret: Buffer, counter: number, digits: number): string {
  const hmac = createHmac("sha1", secret).update(counterBytes(counter)).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary = ((hmac[offset]! & 0x7f) << 24) | ((hmac[offset + 1]! & 0xff) << 16)
    | ((hmac[offset + 2]! & 0xff) << 8) | (hmac[offset + 3]! & 0xff);
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export function totpStep(atSeconds: number, step: number = STEP_SECONDS): number {
  return Math.floor(atSeconds / step);
}

export function totpCode(secret: Buffer, step: number, digits: number = DIGITS): string {
  return hotp(secret, step, digits);
}

export type TotpVerification =
  | { readonly valid: true; readonly step: number }
  | { readonly valid: false };

/**
 * Verifica un código de 6 dígitos contra la ventana `±window` pasos (por
 * defecto ±1 = ±30 s, la tolerancia usual de reloj de un teléfono). Si
 * `lastAcceptedStep` no es `null`, cualquier paso que no sea estrictamente
 * posterior se rechaza: es la barrera contra repetir el mismo código dos
 * veces, incluida la reutilización exacta dentro de la misma ventana.
 */
export function verifyTotp(
  secret: Buffer,
  candidate: string,
  atSeconds: number,
  options: { readonly window?: number; readonly lastAcceptedStep?: number | null } = {},
): TotpVerification {
  if (!/^\d{6}$/.test(candidate)) return { valid: false };
  const window = options.window ?? 1;
  const lastAcceptedStep = options.lastAcceptedStep ?? null;
  const currentStep = totpStep(atSeconds);
  for (let delta = -window; delta <= window; delta += 1) {
    const step = currentStep + delta;
    if (lastAcceptedStep !== null && step <= lastAcceptedStep) continue;
    if (totpCode(secret, step) === candidate) return { valid: true, step };
  }
  return { valid: false };
}

/** `otpauth://` — lo que una app autenticadora escanea o importa al enrolar. */
export function totpProvisioningUri(params: { readonly secret: Buffer; readonly accountName: string; readonly issuer: string }): string {
  const label = encodeURIComponent(`${params.issuer}:${params.accountName}`);
  const query = new URLSearchParams({
    secret: base32Encode(params.secret),
    issuer: params.issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}
