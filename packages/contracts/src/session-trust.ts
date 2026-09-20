import * as z from "zod";
import { StableCodeSchema, UtcDateTimeSchema } from "./primitives.js";

/**
 * Propósitos que el bundle de confianza puede publicar — `D-31`.
 *
 * **Era `z.literal("SESSION_ASSERTION")`, y por eso `DEC-025` no podía
 * completarse.** Medido el 2026-09-20 arrancando el servicio: el ancla
 * `local_trust_anchor` modela tres propósitos desde `MIGRATION_022`, el
 * aprovisionamiento de operador verifica su segundo sobre contra
 * `keysFor("AUTHORIZATION_SNAPSHOT")`, y **ninguna ruta podía poblarlo**
 * porque el único canal que llega al ancla —este bundle— no admitía
 * declararlo. El arranque registraba `authorization_snapshot=0` y
 * `SNAPSHOT_REJECTED / VERIFICATION_FAILED` en todo arranque, con material
 * impecable.
 *
 * **Una clave por propósito, no una compartida.** El propósito viaja *dentro*
 * de los claims firmados por la raíz, así que decide a qué ancla entra la
 * clave y no lo elige quien instala el fichero. Compartir una clave entre
 * firmar identidad y firmar permisos anularía esa separación: quien pudiera
 * emitir una haría la otra, y revocar una obligaría a revocar ambas.
 *
 * `LICENSE` queda fuera **a propósito**: su cadena tiene su propio
 * verificador y nadie ha demostrado que deba distribuirse por aquí. Se añade
 * cuando exista esa evidencia, no por simetría.
 */
export const SessionTrustKeyPurposeSchema = z.enum(["SESSION_ASSERTION", "AUTHORIZATION_SNAPSHOT"]);
export type SessionTrustKeyPurpose = z.infer<typeof SessionTrustKeyPurposeSchema>;

export const SessionAssertionKeyStatusSchema = z.enum(["ACTIVE", "VERIFY_ONLY", "REVOKED"]);
export type SessionAssertionKeyStatus = z.infer<typeof SessionAssertionKeyStatusSchema>;

export const SessionAssertionOperationalKeyClaimsSchema = z.strictObject({
  key_id: StableCodeSchema,
  key_purpose: SessionTrustKeyPurposeSchema,
  environment: StableCodeSchema,
  public_key_pem: z.string().min(80).max(4096),
  status: SessionAssertionKeyStatusSchema,
  valid_from: UtcDateTimeSchema,
  valid_until: UtcDateTimeSchema.nullable(),
  version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).superRefine((claims, context) => {
  if (claims.valid_until !== null && Date.parse(claims.valid_until) <= Date.parse(claims.valid_from)) {
    context.addIssue({ code: "custom", path: ["valid_until"], message: "valid_until must be later than valid_from" });
  }
});

export const SignedSessionAssertionOperationalKeySchema = z.strictObject({
  claims: SessionAssertionOperationalKeyClaimsSchema,
  signature: z.string().min(80).max(128).regex(/^[A-Za-z0-9_-]+$/),
});

export const SessionAssertionTrustBundleSchema = z.strictObject({
  version: z.number().int().positive(),
  keys: z.array(SignedSessionAssertionOperationalKeySchema).min(1).max(16),
}).superRefine((bundle, context) => {
  // Unicidad **global**, no por propósito, aunque el ancla tenga clave
  // primaria `(purpose, key_id)`. Un `key_id` identifica una clave publicada,
  // no una clave dentro de un propósito: repetirlo dejaría un rastro ambiguo
  // —`SIGNATURE_INVALID` con ese id no diría cuál de las dos falló— y
  // obligaría a mirar el propósito para saber de qué clave se habla. Si
  // alguien quisiera la MISMA clave para los dos propósitos tendría que
  // publicarla dos veces con ids distintos, que es un acto explícito y
  // auditable en vez de un descuido.
  const ids = bundle.keys.map((key) => key.claims.key_id);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", path: ["keys"], message: "trust bundle contains duplicate key_id values" });
  }
});

export type SessionAssertionOperationalKeyClaims = z.infer<typeof SessionAssertionOperationalKeyClaimsSchema>;
export type SignedSessionAssertionOperationalKey = z.infer<typeof SignedSessionAssertionOperationalKeySchema>;
export type SessionAssertionTrustBundle = z.infer<typeof SessionAssertionTrustBundleSchema>;

export function unsignedSessionAssertionOperationalKeyBytes(
  claims: SessionAssertionOperationalKeyClaims,
): Buffer {
  return Buffer.from(canonicalSessionTrustJson(SessionAssertionOperationalKeyClaimsSchema.parse(claims)));
}

export function canonicalSessionTrustJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite numbers are not valid session trust payloads");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalSessionTrustJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalSessionTrustJson(item)}`).join(",")}}`;
  }
  throw new Error("unsupported session trust payload value");
}
