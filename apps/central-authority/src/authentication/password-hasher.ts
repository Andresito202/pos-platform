import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * Parámetros de OWASP Password Storage Cheat Sheet para scrypt, consultada el
 * 2026-09-26: `N=2^17` (128 MiB), `r=8`, `p=1`. Se eligió scrypt porque viene
 * con Node; Argon2id, la primera opción de OWASP, exigiría una dependencia
 * nativa nueva.
 *
 * `maxmem` va explícito: Node rechaza estos parámetros si el margen sobre
 * `128·N·r` no alcanza (el mismo aviso que `DEC-012` §18.11 registró).
 *
 * El formato guardado lleva los parámetros, para que subirlos después obligue
 * a re-derivar en el siguiente login y no invalide verifiers existentes.
 */
const PARAMETERS = { N: 2 ** 17, r: 8, p: 1, maxmem: 192 * 1024 * 1024 } as const;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const PREFIX = "scrypt";

function derive(password: string, salt: Buffer, options: ScryptOptions, keyLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, keyLength, options, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt, PARAMETERS, KEY_LENGTH);
  return [PREFIX, PARAMETERS.N, PARAMETERS.r, PARAMETERS.p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export type PasswordVerification = { readonly matches: boolean; readonly needsRehash: boolean };

/**
 * Un verifier ilegible no lanza: responde `matches: false`, igual que una
 * contraseña equivocada, para que la respuesta no distinga los dos casos.
 */
export async function verifyPassword(password: string, stored: string): Promise<PasswordVerification> {
  const [prefix, n, r, p, saltText, keyText] = stored.split("$");
  const N = Number(n);
  const R = Number(r);
  const P = Number(p);
  if (prefix !== PREFIX || saltText === undefined || keyText === undefined
    || !Number.isSafeInteger(N) || !Number.isSafeInteger(R) || !Number.isSafeInteger(P)) {
    await burnEquivalentWork(password);
    return { matches: false, needsRehash: false };
  }
  const expected = Buffer.from(keyText, "base64url");
  let actual: Buffer;
  try {
    actual = await derive(password, Buffer.from(saltText, "base64url"), { N, r: R, p: P, maxmem: PARAMETERS.maxmem }, expected.length);
  } catch {
    // Parámetros fuera de lo que `maxmem` admite: misma respuesta que un fallo.
    return { matches: false, needsRehash: false };
  }
  const matches = expected.length > 0 && actual.length === expected.length && timingSafeEqual(actual, expected);
  const needsRehash = N !== PARAMETERS.N || R !== PARAMETERS.r || P !== PARAMETERS.p;
  return { matches, needsRehash };
}

/**
 * Para una cuenta inexistente se hace el mismo trabajo que para una real. Sin
 * esto, el tiempo de respuesta revelaría qué cuentas existen, que `A-8`
 * prohíbe.
 */
export async function burnEquivalentWork(password: string): Promise<void> {
  await derive(password, randomBytes(SALT_LENGTH), PARAMETERS, KEY_LENGTH);
}
