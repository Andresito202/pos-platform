import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Cifra el secreto TOTP antes de guardarlo en `identity.mfa_factors.
 * secret_reference` (`text`, sin esquema de cifrado propio en la 001 — es la
 * brecha `G-6` de `DEC-026`: no existe todavía un almacén de secretos
 * central. Mientras no exista, se cifra aquí mismo con AES-256-GCM y una
 * clave simétrica del propio proceso, en vez de guardar el secreto en claro
 * — que es la única alternativa peor. Si `G-6` se resuelve con un almacén
 * central, esta clase se sustituye sin tocar el resto del flujo de MFA: la
 * columna sólo ve un `secret_reference` opaco.
 */
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const PREFIX = "aesgcm256";

export class MfaSecretCipher {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error("MFA secret encryption key must be 32 bytes");
  }

  encrypt(secret: Buffer): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
    return [PREFIX, iv.toString("base64url"), ciphertext.toString("base64url"), cipher.getAuthTag().toString("base64url")].join("$");
  }

  decrypt(reference: string): Buffer {
    const [prefix, ivText, ciphertextText, tagText] = reference.split("$");
    if (prefix !== PREFIX || ivText === undefined || ciphertextText === undefined || tagText === undefined) {
      throw new Error("malformed secret_reference");
    }
    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(ivText, "base64url"));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextText, "base64url")), decipher.final()]);
  }
}
