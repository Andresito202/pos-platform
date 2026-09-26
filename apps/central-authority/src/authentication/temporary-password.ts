import { randomInt } from "node:crypto";
import { AUTHENTICATION_POLICY } from "./authentication-policy.js";

/**
 * Sin `0/O`, `1/l/I`: se dicta o se copia a mano en caja, y una confusión de
 * carácter convertiría un alta en un bloqueo.
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

/**
 * `A-6` / `A-9`: contraseña temporal de un solo uso generada por el sistema.
 * Cumple el mínimo más exigente de `A-5` para que ningún rol la rechace; el
 * usuario la cambia en su primer ingreso.
 */
export function generateTemporaryPassword(): string {
  const length = AUTHENTICATION_POLICY.password.minLengthSingleFactor + 1;
  let value = "";
  for (let index = 0; index < length; index += 1) value += ALPHABET[randomInt(ALPHABET.length)];
  return value;
}
