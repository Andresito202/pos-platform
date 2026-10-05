import * as z from "zod";
import { StableCodeSchema, UtcDateTimeSchema, UuidSchema } from "./primitives.js";
import { SessionTrustCodeSchema } from "./session-trust.js";

/**
 * Contrato de la Signed Session Assertion (SSA), definida por `DEC-012`. Es la
 * frontera de validación de la identidad de sesión que la autoridad central
 * emite hacia el POS Local Service.
 *
 * El sobre `{ claims, signature }` replica deliberadamente
 * `SignedAuthorizationSnapshotSchema` y `SignedLicenseSchema`: los tres son
 * artefactos firmados con Ed25519 sobre `canonicalJson(claims)` y se verifican
 * con la misma maquinaria. No se introduce un tercer mecanismo criptográfico.
 *
 * **La SSA responde a "quién es el operador", nunca a "qué puede hacer".** La
 * autorización sigue siendo competencia exclusiva del Signed Authorization
 * Snapshot (`DEC-011`) y de `evaluatePermission()`. Por eso este contrato no
 * admite permisos, roles ni asignaciones: `strictObject` los rechaza como
 * campos inesperados, de modo que la separación no depende de una convención
 * sino de la forma del contrato.
 *
 * Una SSA que satisfaga este esquema **no acredita nada por ello**. Este
 * contrato valida forma; la autoridad la establecen la verificación de firma,
 * el binding y la vigencia, que pertenecen al verificador (SSA-002).
 */

/**
 * Identidad de sesión emitida centralmente.
 *
 * `tenant_membership_id` vive aquí y no en el snapshot de autorización porque
 * una membership vincula usuario con tenant y es, por tanto, identidad:
 * `DEC-011` separa estrictamente «`user_id` es identidad; `assignments` es
 * autorización», y `DEC-012` resuelve la ubicación en ese mismo eje.
 */
export const SessionAssertionClaimsSchema = z.strictObject({
  session_id: UuidSchema,
  user_id: UuidSchema,
  tenant_membership_id: UuidSchema,
  // Binding completo. El verificador lo usará para impedir que una SSA válida
  // sea aceptada en otra instalación o dispositivo; aquí solo se exige su
  // presencia y su forma.
  installation_id: UuidSchema,
  device_id: UuidSchema,
  issued_at: UtcDateTimeSchema,
  /**
   * Fin de la vigencia offline de la sesión. No admite null: `DEC-012` exige
   * vigencia acotada y no contempla una sesión local perpetua.
   *
   * El contrato no fija duración máxima alguna: el techo es política versionada
   * y su valor permanece pendiente de decisión. Tampoco se acopla a
   * `business_date`: esa correlación es política operativa, no forma del
   * contrato.
   */
  offline_valid_until: UtcDateTimeSchema,
  /**
   * La monotonía es responsabilidad del emisor. Aquí solo se valida la forma;
   * la regla «estrictamente mayor que la aceptada» pertenece al estado local
   * persistido, igual que en el snapshot de autorización. No existe
   * last-write-wins: una secuencia igual es un reenvío y una menor es un
   * replay, y ninguna desplaza a la sesión activa.
   */
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  key_id: SessionTrustCodeSchema,
}).superRefine((claims, context) => {
  // Vigencia semiabierta [issued_at, offline_valid_until), coherente con la del
  // snapshot de autorización. Sin gracia: en el instante exacto de expiración
  // la sesión ya no vale.
  if (Date.parse(claims.offline_valid_until) <= Date.parse(claims.issued_at)) {
    context.addIssue({
      code: "custom",
      path: ["offline_valid_until"],
      message: "offline_valid_until must be later than issued_at",
    });
  }
});

export const SignedSessionAssertionSchema = z.strictObject({
  claims: SessionAssertionClaimsSchema,
  signature: z.string().min(80).max(128).regex(/^[A-Za-z0-9_-]+$/),
});

export type SessionAssertionClaims = z.infer<typeof SessionAssertionClaimsSchema>;
export type SignedSessionAssertion = z.infer<typeof SignedSessionAssertionSchema>;
