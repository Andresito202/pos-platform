import * as z from "zod";

/**
 * Declaración tipada de credencial (`D-3` ratificada).
 *
 * El hallazgo de `fiscal-adapter-gate.md` §2 es que lo que cada proveedor
 * entrega al cliente es **estructuralmente distinto**: dos valores en SIIGO más
 * un `Partner-Id` que aporta la plataforma, cuatro en FACTUS con refresh token,
 * dos en ALEGRA sin refresh. Ningún puerto ni tabla puede asumir «usuario y
 * contraseña».
 *
 * Este módulo declara **la forma** del secreto, nunca su valor. Ver §12.5: el
 * núcleo guarda una referencia opaca y sólo el adapter conoce qué hay detrás.
 */

/** Quién aporta el valor: el cliente o la plataforma integradora. */
export const CREDENTIAL_FIELD_SOURCES = ["CUSTOMER", "PLATFORM"] as const;

export type CredentialFieldSource = (typeof CREDENTIAL_FIELD_SOURCES)[number];

export const CredentialFieldSourceSchema = z.enum(CREDENTIAL_FIELD_SOURCES);

/** Cómo viaja la autenticación por el cable. */
export const CREDENTIAL_TRANSPORTS = [
  "OAUTH2_PASSWORD_GRANT",
  "BEARER_TOKEN",
  "HTTP_BASIC",
] as const;

export type CredentialTransport = (typeof CREDENTIAL_TRANSPORTS)[number];

export const CredentialTransportSchema = z.enum(CREDENTIAL_TRANSPORTS);

/**
 * Ciclo de vida del token.
 *
 * La diferencia es operativa, no cosmética: con `ACCESS_AND_REFRESH_TOKEN` hay
 * un refresh que renovar; con `LONG_LIVED_UNTIL_ROTATION` no existe refresh y
 * la rotación es un acto manual del cliente.
 */
export const TOKEN_LIFECYCLES = [
  "SHORT_LIVED_REAUTHENTICATE",
  "ACCESS_AND_REFRESH_TOKEN",
  "LONG_LIVED_UNTIL_ROTATION",
] as const;

export type TokenLifecycle = (typeof TOKEN_LIFECYCLES)[number];

export const TokenLifecycleSchema = z.enum(TOKEN_LIFECYCLES);

const CREDENTIAL_FIELD_NAME_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

/**
 * Un campo de credencial: **su nombre**, quién lo aporta y si su valor es
 * secreto. No existe una propiedad que pueda contener el valor, y el esquema es
 * estricto, así que un objeto que traiga una clave `value` es rechazado en
 * tiempo de ejecución además de no compilar.
 */
export const CredentialFieldSchema = z.strictObject({
  name: z.string().min(1).max(64).regex(CREDENTIAL_FIELD_NAME_PATTERN),
  source: CredentialFieldSourceSchema,
  secret: z.boolean(),
});

export type CredentialField = z.infer<typeof CredentialFieldSchema>;

export const CredentialRequirementSchema = z.strictObject({
  transport: CredentialTransportSchema,
  tokenLifecycle: TokenLifecycleSchema,
  fields: z.array(CredentialFieldSchema).min(1).max(16),
  /**
   * SIIGO y ALEGRA documentan expresamente que la credencial de API **nunca**
   * es la contraseña de la cuenta. FACTUS sí usa un `password` de usuario de
   * API dentro de un OAuth2 password grant, que es otra cosa.
   */
  neverAccountPassword: z.boolean(),
});

export type CredentialRequirement = z.infer<typeof CredentialRequirementSchema>;

const SECRET_REFERENCE_PATTERN = /^[a-z][a-z0-9]*(?::[A-Za-z0-9._-]+){1,4}$/;

/**
 * Referencia opaca al secreto custodiado (`SEC-004`).
 *
 * Es lo único que cruza hacia el núcleo. No es el secreto, no lo contiene y no
 * permite derivarlo: identifica dónde está guardado y en qué versión.
 */
export const CredentialReferenceSchema = z.strictObject({
  secretRef: z.string().min(3).max(200).regex(SECRET_REFERENCE_PATTERN),
  version: z.string().min(1).max(64),
});

export type CredentialReference = z.infer<typeof CredentialReferenceSchema>;

/** Nombres de los campos que el adapter declara como secretos. */
export function secretFieldNames(requirement: CredentialRequirement): readonly string[] {
  return requirement.fields.filter((field) => field.secret).map((field) => field.name);
}

/** Campos que aporta la plataforma, no el cliente — el `Partner-Id` de SIIGO. */
export function platformSuppliedFieldNames(
  requirement: CredentialRequirement,
): readonly string[] {
  return requirement.fields
    .filter((field) => field.source === "PLATFORM")
    .map((field) => field.name);
}

/**
 * Redacción obligatoria (`fiscal-adapter-gate.md` §12.4).
 *
 * Un mensaje de error del adapter nunca incluye credencial, token ni cabecera
 * de autorización. Esta función no adivina: recibe los nombres declarados y
 * sustituye cualquier valor que los acompañe.
 */
const REDACTED = "[REDACTED]";

export function redactCredentialValues(
  text: string,
  requirement: CredentialRequirement,
): string {
  let output = text;
  for (const name of secretFieldNames(requirement)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    output = output.replace(
      new RegExp(`("?${escaped}"?\\s*[:=]\\s*)("[^"]*"|'[^']*'|[^\\s,;}]+)`, "gi"),
      `$1${REDACTED}`,
    );
  }
  return output.replace(/(authorization\s*:\s*)(\S+\s*\S*)/gi, `$1${REDACTED}`);
}
