import * as z from "zod";
import { createRequestEnvelopeSchema, createResponseEnvelopeSchema } from "./envelope.js";
import { SignedSessionAssertionSchema } from "./session-assertion.js";
import {
  ExpectedVersionSchema,
  StableCodeSchema,
  UtcDateTimeSchema,
  UuidSchema,
} from "./primitives.js";

/**
 * Contrato IPC de las operaciones comerciales V1 — `DEC-014`.
 *
 * Cubre `session.activate`, `session.recover`, `cash.shift.open`,
 * `cash.shift.close` y `sale.create`: la superficie que expone los casos de uso
 * ya materializados en `BLOQUE 4C` (`UC-SALES-001`) y `BLOQUE 4D`
 * (`UC-CASH-001`, `UC-CASH-002`).
 *
 * **Este módulo define forma, no habilita transporte.** Deliberadamente no se
 * añade a `IpcMessageTypeSchema` ni a las uniones `IpcRequestSchema` /
 * `IpcResponseSchema` de `ipc.ts`: incorporarlos allí activaría rutas que
 * ningún handler atiende todavía. La incorporación a la unión pertenece al
 * bloque de implementación, no a la ratificación del contrato.
 *
 * ## Frontera de confianza
 *
 * El renderer **no es autoridad de seguridad**. Transporta intención; nunca
 * identidad, ámbito ni autorización. Por eso los payloads de este módulo no
 * admiten `actor_type`, `user_id`, `tenant_id`, permisos ni asignaciones, y el
 * sobre de petición rechaza los campos de identidad que `RequestEnvelope`
 * declara opcionales para otros usos.
 *
 * La separación no queda confiada a una convención: `strictObject` rechaza el
 * campo inesperado y `forbidCallerAssertedIdentity` rechaza el campo de sobre
 * que suplantaría al contexto confiable. Un llamador no puede afirmar quién es.
 *
 * El precedente es `operation.confirm`, cuyo handler deriva
 * `tenant_id`/`company_id`/`branch_id`/`device_id`/`installation_id` de la
 * configuración local y nunca del sobre recibido.
 */

/** Importe a escala 6 no negativo, forma canónica de cable: `"50000.000000"`. */
const NonNegativeScale6Schema = z.string().regex(/^(?:0|[1-9]\d{0,14})\.\d{6}$/);

/** Cantidad a escala 6 estrictamente positiva: una línea de venta sin cantidad no existe. */
const PositiveScale6Schema = z.string()
  .regex(/^(?:0|[1-9]\d{0,14})\.\d{6}$/)
  .refine((value) => /[1-9]/.test(value), { message: "quantity must be greater than zero" });

/** Fecha de negocio `YYYY-MM-DD`. `local_database` la almacena con `length = 10`. */
const BusinessDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Identificador IANA de zona horaria. El almacenamiento exige `length > 0`. */
const TimezoneIdSchema = z.string().min(1).max(64).regex(/^[A-Za-z][A-Za-z0-9_+\-]*(?:\/[A-Za-z0-9_+\-]+)*$/);

/** Desplazamiento UTC en minutos. Rango idéntico al `CHECK` de `sales_sales`. */
const UtcOffsetMinutesSchema = z.number().int().min(-1440).max(1440);

/** ISO 4217. El almacenamiento exige exactamente 3 caracteres. */
const CurrencyCodeSchema = z.string().length(3).regex(/^[A-Z]{3}$/);

/** Serie documental. `sales_sales` admite de 1 a 20 caracteres. */
const DocumentSeriesSchema = z.string().min(1).max(20).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);

/** Canal de venta. El almacenamiento exige `length > 0`. */
const SaleChannelSchema = z.string().min(1).max(32).regex(/^[A-Z][A-Z0-9_]*$/);

/**
 * Campos de identidad que el sobre declara opcionales y que estas operaciones
 * rechazan: aceptarlos permitiría al llamador nombrar el ámbito o el actor bajo
 * el que se ejecuta la operación. La capa confiable los deriva de la
 * configuración local y de la sesión verificada.
 */
const CALLER_ASSERTED_IDENTITY_FIELDS = [
  "tenant_id",
  "company_id",
  "branch_id",
  "device_id",
  "actor_id",
] as const;

function forbidCallerAssertedIdentity(
  request: Record<string, unknown>,
  context: z.RefinementCtx,
): void {
  for (const field of CALLER_ASSERTED_IDENTITY_FIELDS) {
    if (request[field] !== undefined) {
      context.addIssue({
        code: "custom",
        path: [field],
        message: `${field} must not be asserted by the caller; the trusted layer derives it`,
      });
    }
  }
}

/**
 * Operaciones mutantes: exigen `operation_id` + `idempotency_key`. Sin ellos no
 * existe reintento seguro, y los tres casos de uso ya materializados basan su
 * idempotencia en esa clave.
 */
function requireIdempotentOperation(
  request: { operation_id?: string | undefined; idempotency_key?: string | undefined },
  context: z.RefinementCtx,
): void {
  if (request.operation_id === undefined) {
    context.addIssue({ code: "custom", path: ["operation_id"], message: "operation_id is required" });
  }
  if (request.idempotency_key === undefined) {
    context.addIssue({ code: "custom", path: ["idempotency_key"], message: "idempotency_key is required" });
  }
}

// ── session.activate ─────────────────────────────────────────────────────────

/**
 * Activación de sesión local (SSA-003).
 *
 * El payload transporta **únicamente** el sobre SSA firmado. Que llegue por una
 * vía no confiable no lo convierte en autoridad: la SSA se autentica por su
 * propia firma Ed25519, y `user_id` se toma de los claims **verificados**,
 * nunca del llamador. `SqliteSessionAssertionStore.activate` vuelve a comparar
 * claims contra binding, de modo que una discrepancia es `BINDING_MISMATCH`.
 *
 * `installation_id` y `device_id` los aporta la configuración local.
 */
export const SessionActivateRequestSchema = createRequestEnvelopeSchema(
  z.strictObject({ session_assertion: SignedSessionAssertionSchema }),
).safeExtend({ message_type: z.literal("session.activate") })
  .superRefine(forbidCallerAssertedIdentity);

export const SessionActivateResultSchema = z.strictObject({
  outcome: z.enum(["ACTIVATED", "REJECTED", "STALE_SEQUENCE", "BINDING_MISMATCH"]),
  /** Secuencia aceptada; presente sólo en `ACTIVATED`. */
  sequence: z.number().int().positive().nullable(),
  /** Secuencia vigente que impidió la activación; presente sólo en `STALE_SEQUENCE`. */
  current_sequence: z.number().int().positive().nullable(),
  /** Motivo del verificador; presente sólo en `REJECTED`. */
  decision: StableCodeSchema.nullable(),
});

export const SessionActivateResponseSchema = createResponseEnvelopeSchema(SessionActivateResultSchema);

// ── session.recover ──────────────────────────────────────────────────────────

/**
 * Recuperación de la sesión persistida tras un reinicio. No es un login y no
 * autentica a nadie: determina si una SSA previamente aceptada sigue vigente.
 *
 * El payload es vacío por construcción. El binding —incluido `user_id`— debe
 * resolverlo la capa confiable; que hoy no exista esa resolución es
 * exactamente el bloqueo `PD-2` registrado en `DEC-014` §4.
 */
export const SessionRecoverRequestSchema = createRequestEnvelopeSchema(
  z.strictObject({}),
).safeExtend({ message_type: z.literal("session.recover") })
  .superRefine(forbidCallerAssertedIdentity);

export const SessionRecoverResultSchema = z.strictObject({
  outcome: z.enum(["ACTIVE", "NONE", "UNVERIFIABLE"]),
  session_id: UuidSchema.nullable(),
  offline_valid_until: UtcDateTimeSchema.nullable(),
  decision: StableCodeSchema.nullable(),
});

export const SessionRecoverResponseSchema = createResponseEnvelopeSchema(SessionRecoverResultSchema);

// ── cash.shift.open ──────────────────────────────────────────────────────────

/**
 * `UC-CASH-001`. Refleja exactamente `OpenCashShiftRequest`, menos
 * `idempotencyKey`, `correlationId` y `causationId`, que viajan en el sobre.
 *
 * `opening_amount` no admite signo: `NEGATIVE_OPENING_AMOUNT` sigue siendo un
 * resultado del caso de uso, y el contrato rechaza además la forma negativa en
 * la frontera.
 */
export const CashShiftOpenRequestSchema = createRequestEnvelopeSchema(
  z.strictObject({
    cash_register_id: UuidSchema,
    opening_amount: NonNegativeScale6Schema,
    business_date: BusinessDateSchema,
    timezone_id: TimezoneIdSchema,
    utc_offset_minutes: UtcOffsetMinutesSchema,
  }),
).safeExtend({ message_type: z.literal("cash.shift.open") })
  .superRefine((request, context) => {
    forbidCallerAssertedIdentity(request, context);
    requireIdempotentOperation(request, context);
  });

export const CashShiftOpenOutcomeSchema = z.enum([
  "OPENED",
  "IDEMPOTENT",
  "UNAUTHORIZED",
  "REGISTER_NOT_FOUND",
  "REGISTER_INACTIVE",
  "NEGATIVE_OPENING_AMOUNT",
  "INCOMPATIBLE_SHIFT",
  "IDEMPOTENCY_CONFLICT",
]);

export const CashShiftOpenResultSchema = z.strictObject({
  outcome: CashShiftOpenOutcomeSchema,
  /** Presente en `OPENED` e `IDEMPOTENT`; nulo en todo resultado no exitoso. */
  shift_id: UuidSchema.nullable(),
});

export const CashShiftOpenResponseSchema = createResponseEnvelopeSchema(CashShiftOpenResultSchema);

// ── cash.shift.close ─────────────────────────────────────────────────────────

/**
 * `UC-CASH-002`. `expected_version` sostiene el bloqueo optimista; sin él el
 * cierre no puede detectar `VERSION_CONFLICT`.
 *
 * `counted_amount` es un conteo físico y por tanto no negativo. La diferencia
 * —que sí puede ser negativa— es un resultado calculado, nunca una entrada.
 */
export const CashShiftCloseRequestSchema = createRequestEnvelopeSchema(
  z.strictObject({
    shift_id: UuidSchema,
    counted_amount: NonNegativeScale6Schema,
    expected_version: ExpectedVersionSchema,
  }),
).safeExtend({ message_type: z.literal("cash.shift.close") })
  .superRefine((request, context) => {
    forbidCallerAssertedIdentity(request, context);
    requireIdempotentOperation(request, context);
  });

export const CashShiftCloseOutcomeSchema = z.enum([
  "CLOSED",
  "IDEMPOTENT",
  "UNAUTHORIZED",
  "NOT_FOUND",
  "ALREADY_CLOSED",
  "VERSION_CONFLICT",
  "IDEMPOTENCY_CONFLICT",
]);

/**
 * Los tres importes se pueblan sólo en `CLOSED`.
 *
 * En `IDEMPOTENT` son nulos: `BLOQUE 4D` no persiste `counted_amount` en la
 * fila del turno —no existe tabla de arqueo en `MIGRATION_009`— de modo que un
 * reintento no puede reconstruirlos. Es la decisión V1 registrada como `M3` en
 * el gate de `4D`, y el contrato la expresa en vez de fingir un dato ausente.
 */
export const CashShiftCloseResultSchema = z.strictObject({
  outcome: CashShiftCloseOutcomeSchema,
  shift_id: UuidSchema.nullable(),
  expected_cash: z.string().regex(/^-?(?:0|[1-9]\d{0,14})\.\d{6}$/).nullable(),
  counted_amount: NonNegativeScale6Schema.nullable(),
  difference_amount: z.string().regex(/^-?(?:0|[1-9]\d{0,14})\.\d{6}$/).nullable(),
});

export const CashShiftCloseResponseSchema = createResponseEnvelopeSchema(CashShiftCloseResultSchema);

// ── sale.create ──────────────────────────────────────────────────────────────

export const SaleCreateLineSchema = z.strictObject({
  product_id: UuidSchema,
  presentation_id: UuidSchema,
  quantity: PositiveScale6Schema,
});

/**
 * `UC-SALES-001`. La venta termina en `READY_FOR_PAYMENT`: este contrato no
 * introduce cobro, confirmación ni cierre de venta.
 *
 * El precio **no** viaja en la petición. Lo resuelve la capa confiable contra
 * el catálogo, de modo que el llamador no puede fijar lo que se cobra. En V1 ese
 * catálogo es `SandboxCatalogStore`, autorizado exclusivamente para el entorno
 * sandbox por `DEC-014` §5; no es una proyección `CATALOG` y no altera
 * `DEC-013`.
 */
export const SaleCreateRequestSchema = createRequestEnvelopeSchema(
  z.strictObject({
    channel: SaleChannelSchema,
    business_date: BusinessDateSchema,
    timezone_id: TimezoneIdSchema,
    utc_offset_minutes: UtcOffsetMinutesSchema,
    document_series: DocumentSeriesSchema,
    currency_code: CurrencyCodeSchema,
    lines: z.array(SaleCreateLineSchema).min(1).max(500),
  }),
).safeExtend({ message_type: z.literal("sale.create") })
  .superRefine((request, context) => {
    forbidCallerAssertedIdentity(request, context);
    requireIdempotentOperation(request, context);
  });

export const SaleCreateOutcomeSchema = z.enum([
  "CREATED",
  "IDEMPOTENT",
  "UNAUTHORIZED",
  "CATALOG_NOT_FOUND",
  "PRICE_NOT_FOUND",
  "CURRENCY_MISMATCH",
  "IDEMPOTENCY_CONFLICT",
]);

export const SaleCreateResultSchema = z.strictObject({
  outcome: SaleCreateOutcomeSchema,
  sale_id: UuidSchema.nullable(),
  sale_number: z.number().int().positive().nullable(),
  payable_amount: NonNegativeScale6Schema.nullable(),
  calculation_checksum: z.string().length(64).regex(/^[a-f0-9]{64}$/).nullable(),
});

export const SaleCreateResponseSchema = createResponseEnvelopeSchema(SaleCreateResultSchema);

// ── Registro canónico de métodos ─────────────────────────────────────────────

/**
 * `message_type` de la capa POS Local Service. Sin prefijo, igual que
 * `runtime.handshake` y `operation.confirm`.
 *
 * El prefijo `pos:` pertenece a la otra frontera —los canales Electron del
 * allowlist de `RT-007`— y las dos nomenclaturas no deben mezclarse. La
 * correspondencia está tabulada en `DEC-014` §3.2.
 */
export const CommercialIpcMessageTypeSchema = z.enum([
  "session.activate",
  "session.recover",
  "cash.shift.open",
  "cash.shift.close",
  "sale.create",
]);

/**
 * Canales Electron equivalentes. Se declaran aquí para que la correspondencia
 * viva junto al contrato, pero incorporarlos a `IPC_ALLOWED_CHANNELS` es acto
 * del bloque de implementación: publicar un canal que ningún handler atiende
 * ampliaría la superficie del renderer sin contrapartida.
 */
export const COMMERCIAL_IPC_ELECTRON_CHANNELS = [
  "pos:session.activate",
  "pos:session.recover",
  "pos:cash.shift.open",
  "pos:cash.shift.close",
  "pos:sale.create",
] as const;

export type CommercialIpcMessageType = z.infer<typeof CommercialIpcMessageTypeSchema>;
export type SessionActivateResult = z.infer<typeof SessionActivateResultSchema>;
export type SessionRecoverResult = z.infer<typeof SessionRecoverResultSchema>;
export type CashShiftOpenResult = z.infer<typeof CashShiftOpenResultSchema>;
export type CashShiftCloseResult = z.infer<typeof CashShiftCloseResultSchema>;
export type SaleCreateResult = z.infer<typeof SaleCreateResultSchema>;
