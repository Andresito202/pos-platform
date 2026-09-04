import * as z from "zod";
import { StableCodeSchema, UtcDateTimeSchema, UuidSchema } from "./primitives.js";

/**
 * Contrato del snapshot firmado de datos maestros, definido por `DEC-013`.
 *
 * El sobre `{ claims, signature }` es el mismo de `SignedAuthorizationSnapshot`,
 * `SignedSessionAssertion` y `SignedLicense`: Ed25519 sobre
 * `canonicalJson(claims)`. No se introduce un cuarto mecanismo criptográfico.
 *
 * **Alcance materializado.** `DEC-013` §7 define cuatro `snapshot_type`, pero
 * `DEC-012` §32 autoriza materializar únicamente `CASH_REGISTER`. Por eso el
 * discriminador es un literal y no una unión: un snapshot de `CATALOG`,
 * `PRICING` o `TAX` es rechazado en la frontera del contrato, antes de tocar
 * verificador, persistencia o proyección. Ampliar el literal exige la
 * autorización correspondiente, no una edición de conveniencia.
 *
 * Un snapshot que satisfaga este esquema **no acredita nada por ello**: valida
 * forma. La autoridad la establecen la firma, el ámbito y la coordenada, que
 * pertenecen al verificador.
 */

/** Único tipo autorizado por `DEC-012` §32. */
export const MASTER_SNAPSHOT_TYPE_CASH_REGISTER = "CASH_REGISTER" as const;

export const MasterSnapshotTypeSchema = z.literal(MASTER_SNAPSHOT_TYPE_CASH_REGISTER);

/** Ambientes que el trust anchor separa; nunca comparten clave (`DEC-013` §4). */
export const MasterSnapshotEnvironmentSchema = z.enum(["PRODUCTION", "STAGING", "SANDBOX"]);

/**
 * Fila del maestro tal como la publica la autoridad central
 * (`cash-counting-schema.md:36`). No lleva metadata criptográfica: ésa vive en
 * el artefacto, no en la proyección (`DEC-012` §31.2).
 *
 * `version` se conserva porque es dato del maestro que el POS copia; no es la
 * coordenada de distribución (`DEC-013` §10).
 */
export const CashRegisterMasterRowSchema = z.strictObject({
  id: UuidSchema,
  tenant_id: UuidSchema,
  company_id: UuidSchema,
  branch_id: UuidSchema,
  code: z.string().min(1).max(64),
  code_normalized: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  currency_code: z.string().length(3).regex(/^[A-Z]{3}$/),
  status: z.enum(["ACTIVE", "RETIRED"]),
  created_at: UtcDateTimeSchema,
  retired_at: UtcDateTimeSchema.nullable(),
  version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).superRefine((row, context) => {
  // `retired_at` y `status` son el vector de baja del maestro (`DEC-012` §20.1).
  // Una fila `RETIRED` sin instante de baja, o al revés, es incoherente en
  // origen y no se corrige localmente: se rechaza.
  if ((row.status === "RETIRED") !== (row.retired_at !== null)) {
    context.addIssue({
      code: "custom",
      path: ["retired_at"],
      message: "retired_at must be present exactly when status is RETIRED",
    });
  }
});

/**
 * Claims del snapshot. Cada campo tiene justificación en `DEC-013` §11; no se
 * admite ninguno más, y `strictObject` lo hace estructural.
 *
 * Ausencias deliberadas: `snapshot_id` —el par binding + `sequence` ya
 * identifica el artefacto (`DEC-012` §27.4)—, `expires_at` y cualquier TTL —la
 * proyección no caduca por tiempo (`DEC-013` §18)—, y todo campo de transporte
 * —el canal no es autoridad—.
 */
export const MasterSnapshotClaimsSchema = z.strictObject({
  schema_version: z.number().int().positive().max(1000),
  snapshot_type: MasterSnapshotTypeSchema,
  key_id: StableCodeSchema,
  environment: MasterSnapshotEnvironmentSchema,
  tenant_id: UuidSchema,
  company_id: UuidSchema,
  /** Parte del binding sólo para `CASH_REGISTER` (`DEC-013` §8). */
  branch_id: UuidSchema,
  /**
   * Coordenada de distribución. La monotonía es responsabilidad del emisor;
   * aquí sólo se valida la forma. La regla «estrictamente mayor» pertenece al
   * estado local, y nunca hay last-write-wins.
   */
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  issued_at: UtcDateTimeSchema,
  /**
   * Reemplazo **completo** del ámbito, nunca un delta. Un ámbito sin cajas es
   * representable: significa que el maestro no publica ninguna, no que el
   * snapshot esté incompleto.
   */
  payload: z.array(CashRegisterMasterRowSchema).max(10_000),
}).superRefine((claims, context) => {
  // El ámbito del snapshot y el de cada fila deben coincidir. Una fila de otro
  // ámbito dentro de un snapshot legítimamente firmado sería una vía de cruce
  // que la firma no detecta por sí sola.
  claims.payload.forEach((row, index) => {
    if (
      row.tenant_id !== claims.tenant_id
      || row.company_id !== claims.company_id
      || row.branch_id !== claims.branch_id
    ) {
      context.addIssue({
        code: "custom",
        path: ["payload", index],
        message: "payload row scope must match the snapshot binding",
      });
    }
  });

  // Dos filas con la misma identidad harían indeterminado el reemplazo.
  const ids = new Set(claims.payload.map((row) => row.id));
  if (ids.size !== claims.payload.length) {
    context.addIssue({ code: "custom", path: ["payload"], message: "payload ids must be unique" });
  }
});

export const SignedMasterSnapshotSchema = z.strictObject({
  claims: MasterSnapshotClaimsSchema,
  signature: z.string().min(80).max(128).regex(/^[A-Za-z0-9_-]+$/),
});

/** Códigos de fallo de `DEC-013` §16 aplicables al consumidor local. */
export const MASTER_SNAPSHOT_FAILURE_CODES = [
  "INVALID_SIGNATURE",
  "UNKNOWN_KEY",
  "WRONG_KEY_PURPOSE",
  "REVOKED_KEY",
  "WRONG_ENVIRONMENT",
  "INVALID_CHECKSUM",
  "INVALID_SCHEMA",
  "INVALID_SNAPSHOT_TYPE",
  "WRONG_SCOPE",
  "INVALID_PAYLOAD",
  "OBSOLETE_SEQUENCE",
  "DUPLICATE_SEQUENCE",
  "REPLAY",
  "TRANSPORT_FAILURE",
  "SQLITE_FAILURE",
  "ACTIVATION_FAILURE",
] as const;

export type MasterSnapshotFailureCode = (typeof MASTER_SNAPSHOT_FAILURE_CODES)[number];

export type MasterSnapshotType = z.infer<typeof MasterSnapshotTypeSchema>;
export type MasterSnapshotEnvironment = z.infer<typeof MasterSnapshotEnvironmentSchema>;
export type CashRegisterMasterRow = z.infer<typeof CashRegisterMasterRowSchema>;
export type MasterSnapshotClaims = z.infer<typeof MasterSnapshotClaimsSchema>;
export type SignedMasterSnapshot = z.infer<typeof SignedMasterSnapshotSchema>;
