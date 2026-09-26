import { AUTHENTICATION_POLICY, type AuthenticationClass } from "./authentication-policy.js";

/**
 * Lista de contraseñas filtradas que `A-5` exige consultar. Es un puerto: la
 * fuente concreta (lista local o servicio externo) no está decidida, y un
 * servicio externo sería un tercero que `docs/legal/` tendría que declarar.
 */
export interface CompromisedPasswordList {
  contains(password: string): Promise<boolean>;
}

export type PasswordEvaluation =
  | { readonly accepted: true }
  | { readonly accepted: false; readonly reason: "TOO_SHORT" | "TOO_LONG" | "COMPROMISED" | "ROLE_UNDECIDED" };

/**
 * NIST cuenta cada punto de código Unicode como un carácter; `length` de JS
 * cuenta unidades UTF-16 y haría que un emoji valiera dos.
 */
function codePointLength(value: string): number {
  return [...value].length;
}

/**
 * `A-5`: sólo longitud y lista de filtradas. Sin reglas de composición: NIST
 * las desaconseja y `DEC-026` §6 las excluye expresamente.
 */
export async function evaluatePassword(
  candidate: string,
  authenticationClass: AuthenticationClass,
  compromised: CompromisedPasswordList,
): Promise<PasswordEvaluation> {
  if (authenticationClass === "UNDECIDED") return { accepted: false, reason: "ROLE_UNDECIDED" };

  const policy = AUTHENTICATION_POLICY.password;
  const normalized = candidate.normalize("NFKC");
  const length = codePointLength(normalized);
  const minimum = authenticationClass === "ADMINISTRATION" ? policy.minLengthWithMfa : policy.minLengthSingleFactor;

  if (length < minimum) return { accepted: false, reason: "TOO_SHORT" };
  if (length > policy.maxLength) return { accepted: false, reason: "TOO_LONG" };
  if (await compromised.contains(normalized)) return { accepted: false, reason: "COMPROMISED" };
  return { accepted: true };
}
