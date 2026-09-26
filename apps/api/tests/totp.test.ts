import { describe, expect, it } from "vitest";
import { base32Encode, generateTotpSecret, totpCode, totpProvisioningUri, totpStep, verifyTotp } from "../src/authentication/totp.js";

/**
 * Vectores oficiales de RFC 6238, Apéndice B, modo SHA1/8 dígitos: si esta
 * aritmética se desviara del estándar, ninguna app autenticadora real
 * generaría códigos que este verificador acepte.
 */
const RFC_SECRET = Buffer.from("12345678901234567890", "ascii");
const RFC_VECTORS: ReadonlyArray<readonly [number, string]> = [
  [59, "94287082"],
  [1_111_111_109, "07081804"],
  [1_111_111_111, "14050471"],
  [1_234_567_890, "89005924"],
  [2_000_000_000, "69279037"],
  [20_000_000_000, "65353130"],
];

describe("TOTP — vectores oficiales de RFC 6238 (SHA1, 8 dígitos)", () => {
  it.each(RFC_VECTORS)("t=%i -> %s", (seconds, expected) => {
    expect(totpCode(RFC_SECRET, totpStep(seconds), 8)).toBe(expected);
  });

  it("el paso es exactamente el de la Tabla 1 del RFC: 59 s -> paso 1, 1234567890 s -> 0x273EF07", () => {
    expect(totpStep(59)).toBe(1);
    expect(totpStep(1_234_567_890)).toBe(0x273ef07);
  });
});

describe("verifyTotp — ventana, formato y anti-repetición", () => {
  const secret = RFC_SECRET;
  const step = totpStep(1_234_567_890);
  const code = totpCode(secret, step, 6);

  it("acepta el código exacto del paso actual", () => {
    expect(verifyTotp(secret, code, 1_234_567_890)).toEqual({ valid: true, step });
  });

  it("acepta un código de un paso antes o después (reloj del teléfono desincronizado)", () => {
    const before = totpCode(secret, step - 1, 6);
    const after = totpCode(secret, step + 1, 6);
    expect(verifyTotp(secret, before, 1_234_567_890)).toEqual({ valid: true, step: step - 1 });
    expect(verifyTotp(secret, after, 1_234_567_890)).toEqual({ valid: true, step: step + 1 });
  });

  it("rechaza un código de dos pasos de distancia", () => {
    const tooFar = totpCode(secret, step + 2, 6);
    expect(verifyTotp(secret, tooFar, 1_234_567_890).valid).toBe(false);
  });

  it("rechaza cinco letras, siete dígitos o una cadena vacía sin acercarse siquiera a calcular un HMAC", () => {
    expect(verifyTotp(secret, "abcdef", 1_234_567_890)).toEqual({ valid: false });
    expect(verifyTotp(secret, "1234567", 1_234_567_890)).toEqual({ valid: false });
    expect(verifyTotp(secret, "", 1_234_567_890)).toEqual({ valid: false });
  });

  it("un código ya aceptado no vuelve a ser válido, ni siquiera repetido en el mismo paso", () => {
    expect(verifyTotp(secret, code, 1_234_567_890, { lastAcceptedStep: step }).valid).toBe(false);
    expect(verifyTotp(secret, code, 1_234_567_890, { lastAcceptedStep: step - 1 }).valid).toBe(true);
  });
});

describe("base32Encode — sin relleno, RFC 4648 §6", () => {
  it("codifica \"12345678901234567890\" como lo hace cualquier codificador estándar", () => {
    expect(base32Encode(RFC_SECRET)).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  });
});

describe("generateTotpSecret / totpProvisioningUri", () => {
  it("genera 20 bytes distintos en cada llamada", () => {
    const a = generateTotpSecret();
    const b = generateTotpSecret();
    expect(a).toHaveLength(20);
    expect(a.equals(b)).toBe(false);
  });

  it("el URI de aprovisionamiento lleva el secreto en base32, el emisor y el algoritmo", () => {
    const uri = totpProvisioningUri({ secret: RFC_SECRET, accountName: "gerente@comercio", issuer: "Camacho POS" });
    expect(uri).toContain("otpauth://totp/");
    expect(uri).toContain(`secret=${base32Encode(RFC_SECRET)}`);
    expect(uri).toContain("issuer=Camacho");
    expect(uri).toContain("algorithm=SHA1");
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
  });
});
