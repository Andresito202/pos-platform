import * as z from "zod";
import { createRequestEnvelopeSchema, createResponseEnvelopeSchema } from "./envelope.js";
import { SignedSessionAssertionSchema } from "./session-assertion.js";
import { PermissionCodeSchema } from "./authorization.js";
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
 * Incorpora además la superficie de Payment V1 (`DEC-016`):
 * `payment.register.cash`, `payment.register.transfer`,
 * `payment.transfer.confirm`, `payment.cancel` y `payment.get`.
 *
 * Estos esquemas **sí** están incorporados a `IpcMessageTypeSchema` y a las
 * uniones de `ipc.ts`: sus handlers existen. (La nota original decía lo
 * contrario porque el módulo nació antes que ellos.)
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

/**
 * Escala 6 **estrictamente positiva**.
 *
 * Gobierna dos cosas que comparten la misma razón: una línea de venta sin
 * cantidad no existe, y **un pago de cero no es un pago**. Aceptarlo asentaría
 * un movimiento de caja de importe cero —basura en el libro de caja— sin mover
 * la cobertura de la venta.
 *
 * No se aplica al importe de apertura ni al conteo de cierre: una caja **sí**
 * se puede abrir sin base y contar vacía, y ahí el cero es un dato legítimo.
 */
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

// ── authorization.capabilities.get ──────────────────────────────────────────

/**
 * Proyección mínima para navegación del renderer.
 *
 * No expone el snapshot firmado ni asignaciones/roles. La capa confiable evalúa
 * los permisos del usuario vinculado contra el ámbito local y devuelve sólo
 * códigos efectivos para adaptar la navegación. Las operaciones siguen
 * autorizándose independientemente en sus casos de uso.
 */
export const AuthorizationCapabilitiesGetRequestSchema = createRequestEnvelopeSchema(
  z.strictObject({}),
).safeExtend({ message_type: z.literal("authorization.capabilities.get") })
  .superRefine(forbidCallerAssertedIdentity);

export const AuthorizationCapabilitiesGetResultSchema = z.strictObject({
  outcome: z.enum(["AVAILABLE", "UNAUTHORIZED"]),
  permissions: z.array(PermissionCodeSchema).max(512),
});

export const AuthorizationCapabilitiesGetResponseSchema =
  createResponseEnvelopeSchema(AuthorizationCapabilitiesGetResultSchema);

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
  /**
   * Versión del turno, para que quien lo abrió pueda cerrarlo.
   *
   * `cash.shift.close` exige `expected_version` y **no existe operación de
   * lectura de turno** por el canal, de modo que sin este campo el llamador
   * tendría que suponer que un turno recién abierto está en la versión 1. Hoy
   * lo está —el `INSERT` la fija en 1 y nada más la incrementa antes del
   * cierre—, pero es un invariante del dominio: suponerlo desde la interfaz lo
   * rompe en silencio el día que otra operación toque la fila.
   *
   * Presente en `OPENED` e `IDEMPOTENT`; nulo en el resto.
   */
  version: z.number().int().positive().nullable(),
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
 * el catálogo, de modo que el llamador no puede fijar lo que se cobra. Es la
 * propiedad que impide la manipulación de precios desde el renderer.
 *
 * Desde `MIGRATION_014` ese catálogo es `catalog_product` /
 * `catalog_presentation` / `catalog_price` —el catálogo real—, no el fixture de
 * sandbox. Sigue sin ser una proyección `CATALOG` distribuida y no altera
 * `DEC-013`.
 */
export const SaleCreateRequestSchema = createRequestEnvelopeSchema(
  z.strictObject({
    /**
     * Caja seleccionada para esta venta, o `null` cuando la operación no pasa
     * por caja.
     *
     * **Es el único selector del turno.** `DEC-012` §25.2 garantiza como máximo
     * un `CashShift` en `OPEN` o `CLOSING` por `(tenant, sucursal, caja)`, de
     * modo que nombrar la caja determina el turno sin ambigüedad. La capa
     * confiable lo resuelve; el llamador **no** puede aportar `cash_shift_id`.
     *
     * No lo elige el dispositivo: `DEC-012` §25.3 fija que `origin_device_id`
     * es procedencia, idempotencia y trazabilidad, y **no** propiedad ni
     * exclusividad sobre la caja. Dos terminales pueden trabajar la misma caja
     * legítimamente, y un selector por dispositivo le rompería el cobro al
     * segundo.
     *
     * Nombrar la caja **no** es aportar ámbito: `tenant`, `company`, `branch`,
     * `device` y `actor` siguen prohibidos y los deriva la capa confiable. El
     * precedente es `cash.shift.open`, que ya recibe `cash_register_id` del
     * llamador. La consulta se acota por el `tenant` y la `branch` del contexto
     * verificado, así que una caja ajena simplemente no resuelve turno.
     */
    cash_register_id: UuidSchema.nullable(),
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
  // La cantidad no cabe en la precisión que declara la unidad: media botella no
  // es una venta, es un error de captura. La comprueba la capa confiable, que
  // es la única que ve el catálogo.
  "QUANTITY_PRECISION_EXCEEDED",
  // No hay existencia para lo pedido. Se rechaza **al crear**: negarse después
  // de que el cliente pagó no es una opción, y la salida real ocurre al
  // completar la venta.
  "INSUFFICIENT_STOCK",
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

// ── payment.register.cash ────────────────────────────────────────────────────

/**
 * `UC-PAY-001` efectivo — `DEC-016`.
 *
 * El llamador **no** aporta `confirmed_amount`, cobertura ni vuelto: la capa
 * confiable confirma el importe, calcula el vuelto y decide si la venta queda
 * completa. `tendered_amount` es opcional y sólo forense (`DEC-016` §10.5): no
 * produce un segundo movimiento de caja.
 */
export const PaymentRegisterCashRequestSchema = createRequestEnvelopeSchema(
  z.strictObject({
    sale_id: UuidSchema,
    amount: PositiveScale6Schema,
    tendered_amount: PositiveScale6Schema.nullable(),
  }),
).safeExtend({ message_type: z.literal("payment.register.cash") })
  .superRefine((request, context) => {
    forbidCallerAssertedIdentity(request, context);
    requireIdempotentOperation(request, context);
  });

export const PaymentRegisterCashOutcomeSchema = z.enum([
  "CONFIRMED",
  "IDEMPOTENT",
  "UNAUTHORIZED",
  "IDEMPOTENCY_CONFLICT",
  "SALE_NOT_FOUND",
  "SALE_NOT_PAYABLE",
  "SALE_ALREADY_COMPLETED",
  "CURRENCY_MISMATCH",
  "OVERPAYMENT_NOT_ALLOWED",
  "CASH_SHIFT_MISSING",
  "CASH_SHIFT_NOT_OPEN",
  "INSUFFICIENT_TENDER",
  // La venta quedaba cubierta pero no hay existencia que sacar. Todo el cobro
  // se revierte: el cajero lo ve antes de que el dinero quede tomado.
  "INSUFFICIENT_STOCK",
]);

/**
 * `sale_completed` es el único campo que autoriza la confirmación sonora
 * (`DEC-016` §13.2), y sólo cuando `outcome` es `CONFIRMED` — nunca en un
 * reintento `IDEMPOTENT`.
 */
export const PaymentRegisterCashResultSchema = z.strictObject({
  outcome: PaymentRegisterCashOutcomeSchema,
  payment_id: UuidSchema.nullable(),
  sale_completed: z.boolean(),
  confirmed_coverage: NonNegativeScale6Schema.nullable(),
  payable_amount: NonNegativeScale6Schema.nullable(),
  change_amount: NonNegativeScale6Schema.nullable(),
});

export const PaymentRegisterCashResponseSchema = createResponseEnvelopeSchema(PaymentRegisterCashResultSchema);

// ── payment.register.transfer ────────────────────────────────────────────────

/**
 * `UC-PAY-003` reporte. Deja el pago en `CREATED`: **no** imputa y **no** puede
 * completar la venta. `provider_code` y `provider_reference` son metadatos de
 * atestiguación, nunca autoridad financiera.
 */
export const PaymentRegisterTransferRequestSchema = createRequestEnvelopeSchema(
  z.strictObject({
    sale_id: UuidSchema,
    amount: PositiveScale6Schema,
    provider_code: z.string().min(1).max(32).regex(/^[A-Z][A-Z0-9_]*$/).nullable(),
    provider_reference: z.string().min(1).max(128).nullable(),
  }),
).safeExtend({ message_type: z.literal("payment.register.transfer") })
  .superRefine((request, context) => {
    forbidCallerAssertedIdentity(request, context);
    requireIdempotentOperation(request, context);
  });

export const PaymentRegisterTransferOutcomeSchema = z.enum([
  "REGISTERED",
  "IDEMPOTENT",
  "UNAUTHORIZED",
  "IDEMPOTENCY_CONFLICT",
  "SALE_NOT_FOUND",
  "SALE_NOT_PAYABLE",
  "SALE_ALREADY_COMPLETED",
  "CURRENCY_MISMATCH",
]);

export const PaymentRegisterTransferResultSchema = z.strictObject({
  outcome: PaymentRegisterTransferOutcomeSchema,
  payment_id: UuidSchema.nullable(),
});

export const PaymentRegisterTransferResponseSchema = createResponseEnvelopeSchema(PaymentRegisterTransferResultSchema);

// ── payment.transfer.confirm ─────────────────────────────────────────────────

/**
 * `UC-PAY-003` confirmación por atestiguación manual. Exige
 * `PAYMENTS_TRANSFER_CONFIRM`, permiso distinto del de reporte para que ambas
 * responsabilidades puedan separarse.
 *
 * Es el punto donde una transferencia produce cobertura y, si con ello la venta
 * queda cubierta, la completa en la misma transacción.
 */
export const PaymentTransferConfirmRequestSchema = createRequestEnvelopeSchema(
  z.strictObject({
    payment_id: UuidSchema,
    expected_version: ExpectedVersionSchema,
  }),
).safeExtend({ message_type: z.literal("payment.transfer.confirm") })
  .superRefine((request, context) => {
    forbidCallerAssertedIdentity(request, context);
    requireIdempotentOperation(request, context);
  });

export const PaymentTransferConfirmOutcomeSchema = z.enum([
  "CONFIRMED",
  "IDEMPOTENT",
  "UNAUTHORIZED",
  "IDEMPOTENCY_CONFLICT",
  "PAYMENT_NOT_FOUND",
  "PAYMENT_NOT_CONFIRMABLE",
  "VERSION_CONFLICT",
  "OVERPAYMENT_NOT_ALLOWED",
  "SALE_ALREADY_COMPLETED",
  "INSUFFICIENT_STOCK",
]);

export const PaymentTransferConfirmResultSchema = z.strictObject({
  outcome: PaymentTransferConfirmOutcomeSchema,
  payment_id: UuidSchema.nullable(),
  sale_completed: z.boolean(),
  confirmed_coverage: NonNegativeScale6Schema.nullable(),
  payable_amount: NonNegativeScale6Schema.nullable(),
});

export const PaymentTransferConfirmResponseSchema = createResponseEnvelopeSchema(PaymentTransferConfirmResultSchema);

// ── payment.cancel ───────────────────────────────────────────────────────────

/** Cancela un pago no confirmado. Un pago confirmado es inmutable (`DEC-002`). */
export const PaymentCancelRequestSchema = createRequestEnvelopeSchema(
  z.strictObject({
    payment_id: UuidSchema,
    expected_version: ExpectedVersionSchema,
  }),
).safeExtend({ message_type: z.literal("payment.cancel") })
  .superRefine((request, context) => {
    forbidCallerAssertedIdentity(request, context);
    requireIdempotentOperation(request, context);
  });

export const PaymentCancelOutcomeSchema = z.enum([
  "CANCELLED",
  "IDEMPOTENT",
  "UNAUTHORIZED",
  "IDEMPOTENCY_CONFLICT",
  "PAYMENT_NOT_FOUND",
  "PAYMENT_NOT_CANCELLABLE",
  "VERSION_CONFLICT",
]);

export const PaymentCancelResultSchema = z.strictObject({
  outcome: PaymentCancelOutcomeSchema,
  payment_id: UuidSchema.nullable(),
});

export const PaymentCancelResponseSchema = createResponseEnvelopeSchema(PaymentCancelResultSchema);

// ── payment.get ──────────────────────────────────────────────────────────────

export const PaymentGetRequestSchema = createRequestEnvelopeSchema(
  z.strictObject({ payment_id: UuidSchema }),
).safeExtend({ message_type: z.literal("payment.get") })
  .superRefine(forbidCallerAssertedIdentity);

export const PaymentGetResultSchema = z.strictObject({
  outcome: z.enum(["FOUND", "NOT_FOUND", "UNAUTHORIZED"]),
  payment_id: UuidSchema.nullable(),
  sale_id: UuidSchema.nullable(),
  method: StableCodeSchema.nullable(),
  status: StableCodeSchema.nullable(),
  expected_amount: NonNegativeScale6Schema.nullable(),
  confirmed_amount: NonNegativeScale6Schema.nullable(),
  currency_code: CurrencyCodeSchema.nullable(),
  version: ExpectedVersionSchema.nullable(),
});

export const PaymentGetResponseSchema = createResponseEnvelopeSchema(PaymentGetResultSchema);

// ── customer.register ────────────────────────────────────────────────────────

/**
 * Adquiriente — `D-9`.
 *
 * El payload es la forma canónica de `FiscalCustomer` en la nomenclatura del
 * cable. **`identification` viaja sin dígito de verificación**, que va en su
 * propio campo: la documentación de emisión es taxativa, y una identificación
 * con el DV pegado se emitiría tal cual.
 *
 * Aquí no se validan los códigos DIAN. Ese trabajo es de la capa confiable,
 * que devuelve **todos** los hallazgos con su código y su ruta: replicar las
 * reglas en el contrato crearía dos versiones de la misma regla, y la del
 * contrato quedaría desactualizada en cuanto se verifique un código nuevo.
 */
/**
 * Un código DIAN **no es un `StableCode`**.
 *
 * `StableCodeSchema` exige empezar por mayúscula —`PAYMENT_REGISTER`,
 * `CASH_SHIFT_OPEN`—, y el catálogo de la DIAN es mayoritariamente numérico:
 * `"01"` factura de venta, `"31"` NIT, `"13"` cédula, `"1"`/`"2"` naturaleza
 * jurídica, `"94"` unidad, junto a `"ZZ"` y `"R-99-PN"`. Reutilizar aquel
 * esquema habría rechazado en la frontera casi todos los códigos verificados,
 * y sólo se habría visto al llegar la primera petición real.
 *
 * Este esquema comprueba **forma, no pertenencia**: que un código exista en la
 * tabla verificada lo decide `packages/fiscal-adapters/src/dian/codes.ts`, y
 * duplicar esa decisión aquí crearía dos versiones de la misma regla.
 */
const DianCodeSchema = z.string().min(1).max(16).regex(/^[A-Z0-9][A-Z0-9-]*$/);

/** Identificación fiscal **sin** dígito de verificación: sólo dígitos. */
const FiscalIdentificationSchema = z.string().min(1).max(40).regex(/^[0-9]+$/);

export const CustomerRegisterRequestSchema = createRequestEnvelopeSchema(
  z.strictObject({
    identification_document_code: DianCodeSchema,
    identification: FiscalIdentificationSchema,
    verification_digit: z.string().regex(/^[0-9]$/).nullable(),
    legal_organization_code: DianCodeSchema,
    company: z.string().min(1).max(200).nullable(),
    names: z.string().min(1).max(200).nullable(),
    tribute_code: DianCodeSchema,
    fiscal_responsibility_codes: z.array(DianCodeSchema).max(32),
    email: z.string().min(1).max(200).nullable(),
    phone: z.string().min(1).max(200).nullable(),
    address: z.string().min(1).max(200).nullable(),
    country_code: z.string().min(1).max(200).nullable(),
    municipality_code: z.string().min(1).max(200).nullable(),
  }),
).safeExtend({ message_type: z.literal("customer.register") })
  .superRefine((request, context) => {
    forbidCallerAssertedIdentity(request, context);
    requireIdempotentOperation(request, context);
  });

export const CustomerRegisterOutcomeSchema = z.enum([
  "REGISTERED",
  "IDEMPOTENT",
  "UNAUTHORIZED",
  "INVALID",
  "IDEMPOTENCY_CONFLICT",
  "IDENTITY_ALREADY_REGISTERED",
]);

/**
 * Un hallazgo lleva **código y ruta, jamás el valor del campo**, igual que
 * `PayloadValidationFinding` en el puerto de emisión. Un adquiriente contiene
 * datos personales; devolverlos en el error los llevaría a los registros del
 * renderer.
 *
 * `customer_id` se puebla también en `IDENTITY_ALREADY_REGISTERED`: quien
 * captura necesita poder ir al registro que ya existe, no volver a intentarlo.
 */
export const CustomerFindingSchema = z.strictObject({
  code: StableCodeSchema,
  path: z.string().min(1).max(120),
  source: StableCodeSchema,
});

export const CustomerRegisterResultSchema = z.strictObject({
  outcome: CustomerRegisterOutcomeSchema,
  customer_id: UuidSchema.nullable(),
  version: ExpectedVersionSchema.nullable(),
  findings: z.array(CustomerFindingSchema).max(32),
});

export const CustomerRegisterResponseSchema = createResponseEnvelopeSchema(CustomerRegisterResultSchema);

// ── customer.get ─────────────────────────────────────────────────────────────

/**
 * Dos formas de preguntar, y son dos mensajes distintos a propósito.
 *
 * `customer.get` toma el identificador interno; `customer.find` toma la
 * identidad fiscal, que es como pregunta una caja —el cliente da su cédula, no
 * un UUID—. Un solo mensaje con ambos campos anulables obligaría a un refinamiento
 * que aceptara exactamente uno, y un contrato que admite formas inválidas por
 * construcción es peor que dos contratos que no las admiten.
 */
export const CustomerGetRequestSchema = createRequestEnvelopeSchema(
  z.strictObject({ customer_id: UuidSchema }),
).safeExtend({ message_type: z.literal("customer.get") })
  .superRefine(forbidCallerAssertedIdentity);

export const CustomerFindRequestSchema = createRequestEnvelopeSchema(
  z.strictObject({
    identification_document_code: DianCodeSchema,
    identification: FiscalIdentificationSchema,
  }),
).safeExtend({ message_type: z.literal("customer.find") })
  .superRefine(forbidCallerAssertedIdentity);

/**
 * Los cuatro códigos DIAN se validan aquí con `DianCodeSchema`, **el mismo
 * esquema que los admite en la petición**, y no con `StableCodeSchema`.
 *
 * No es una preferencia de estilo: `StableCodeSchema` exige que el código
 * empiece por letra mayúscula, y los códigos DIAN reales son numéricos —`13`
 * cédula de ciudadanía, `31` NIT, `1` y `2` de organización legal—. Con el
 * esquema anterior, un adquiriente colombiano corriente se registraba sin
 * problema y **su lectura mataba el socket**: la respuesta no validaba, el
 * servidor destruía la conexión y el llamador veía «socket closed before
 * response».
 *
 * La regla general que deja este defecto: **una respuesta nunca puede ser más
 * estricta que la petición que la originó.** Lo que el contrato dejó escribir,
 * el contrato tiene que dejar leer.
 */
export const CustomerReadResultSchema = z.strictObject({
  outcome: z.enum(["FOUND", "NOT_FOUND", "UNAUTHORIZED"]),
  customer_id: UuidSchema.nullable(),
  identification_document_code: DianCodeSchema.nullable(),
  identification: FiscalIdentificationSchema.nullable(),
  verification_digit: z.string().regex(/^[0-9]$/).nullable(),
  legal_organization_code: DianCodeSchema.nullable(),
  company: z.string().min(1).max(200).nullable(),
  names: z.string().min(1).max(200).nullable(),
  tribute_code: DianCodeSchema.nullable(),
  fiscal_responsibility_codes: z.array(DianCodeSchema).max(32),
  email: z.string().min(1).max(200).nullable(),
  phone: z.string().min(1).max(200).nullable(),
  address: z.string().min(1).max(200).nullable(),
  country_code: z.string().min(1).max(200).nullable(),
  municipality_code: z.string().min(1).max(200).nullable(),
  version: ExpectedVersionSchema.nullable(),
});

export const CustomerReadResponseSchema = createResponseEnvelopeSchema(CustomerReadResultSchema);


export const CustomerMarketingSubscribeRequestSchema = createRequestEnvelopeSchema(
  z.strictObject({ customer_id: UuidSchema }),
).safeExtend({ message_type: z.literal("customer.marketing.subscribe") })
  .superRefine((request, context) => {
    forbidCallerAssertedIdentity(request, context);
    requireIdempotentOperation(request, context);
  });

export const CustomerMarketingUnsubscribeRequestSchema = createRequestEnvelopeSchema(
  z.strictObject({ customer_id: UuidSchema }),
).safeExtend({ message_type: z.literal("customer.marketing.unsubscribe") })
  .superRefine((request, context) => {
    forbidCallerAssertedIdentity(request, context);
    requireIdempotentOperation(request, context);
  });

export const CustomerMarketingGetRequestSchema = createRequestEnvelopeSchema(
  z.strictObject({ customer_id: UuidSchema }),
).safeExtend({ message_type: z.literal("customer.marketing.get") })
  .superRefine(forbidCallerAssertedIdentity);

const CustomerMarketingSubscriptionResultSchema = z.strictObject({
  outcome: z.enum(["SUBSCRIBED", "UNSUBSCRIBED", "IDEMPOTENT", "UNAUTHORIZED", "CUSTOMER_NOT_FOUND", "EMAIL_REQUIRED", "IDEMPOTENCY_CONFLICT", "NOT_SUBSCRIBED", "FOUND"]),
  customer_id: UuidSchema.nullable(),
  channel: z.literal("EMAIL").nullable(),
  topic: z.literal("POS_NEWS").nullable(),
  status: z.enum(["SUBSCRIBED", "UNSUBSCRIBED"]).nullable(),
  consent_version: z.string().min(1).max(32).nullable(),
  consented_at: UtcDateTimeSchema.nullable(),
  unsubscribed_at: UtcDateTimeSchema.nullable(),
  source: z.literal("POS").nullable(),
  updated_at: UtcDateTimeSchema.nullable(),
});

export const CustomerMarketingSubscribeResponseSchema = createResponseEnvelopeSchema(CustomerMarketingSubscriptionResultSchema);
export const CustomerMarketingUnsubscribeResponseSchema = createResponseEnvelopeSchema(CustomerMarketingSubscriptionResultSchema);
export const CustomerMarketingGetResponseSchema = createResponseEnvelopeSchema(CustomerMarketingSubscriptionResultSchema);

// ── fiscal.document.issue ────────────────────────────────────────────────────

/**
 * Emisión de documento fiscal electrónico — `DEC-021` F5.
 *
 * El adquiriente viaja **por referencia**, no por valor: `customer_id` apunta a
 * un adquiriente ya registrado por `customer.register` (`D-9`), o la petición
 * declara explícitamente que la venta no tiene uno, con el mismo motivo que
 * `CustomerAbsenceReason` en la capa confiable. No hay una tercera forma —enviar
 * los campos del adquiriente sueltos en esta petición— porque eso duplicaría el
 * modelo canónico que ya vive en `customers_customers` y las dos copias podrían
 * discreparse.
 *
 * `document_type` no se valida aquí contra las tablas DIAN: `StableCodeSchema`
 * sólo comprueba forma. La traducción a código de proveedor y su verificación
 * son de `dian/codes.ts`, y un tipo sin código verificado bloquea en la capa
 * confiable con `DOCUMENT_TYPE_CODE_NOT_VERIFIED`, nunca aquí.
 */
const FiscalCustomerReferenceSchema = z.union([
  z.strictObject({ kind: z.literal("IDENTIFIED"), customer_id: UuidSchema }),
  z.strictObject({
    kind: z.literal("NOT_IDENTIFIED"),
    reason: z.enum(["ANONYMOUS_COUNTER_SALE", "IDENTIFICATION_PENDING"]),
  }),
]);

export const FiscalDocumentIssueRequestSchema = createRequestEnvelopeSchema(
  z.strictObject({
    sale_id: UuidSchema,
    document_type: StableCodeSchema,
    customer: FiscalCustomerReferenceSchema,
    observation: z.string().min(1).max(2000).nullable(),
  }),
).safeExtend({ message_type: z.literal("fiscal.document.issue") })
  .superRefine((request, context) => {
    forbidCallerAssertedIdentity(request, context);
    requireIdempotentOperation(request, context);
  });

export const FiscalDocumentIssueOutcomeSchema = z.enum([
  "UNAUTHORIZED",
  "ALREADY_ISSUED",
  "ISSUED",
  "REQUIRES_RECONCILIATION",
  "NOT_ELIGIBLE",
  "BLOCKED",
  "TRANSPORT_FAILED",
  "UNCERTAIN",
]);

/**
 * Motivo de bloqueo: código y ruta, igual que `CustomerFindingSchema` y
 * `PayloadValidationFinding` en el puerto de emisión. `detail` conserva los
 * hallazgos internos de una línea (p. ej. de `validateFiscalDocumentItem`)
 * cuando el bloqueo los trae; su ausencia no es un error, es que el bloqueo no
 * los tiene.
 */
export const FiscalDocumentIssueReasonSchema = z.strictObject({
  code: StableCodeSchema,
  path: z.string().min(1).max(120),
  detail: z.array(StableCodeSchema).max(32).optional(),
});

export const FiscalDocumentIssueResultSchema = z.strictObject({
  outcome: FiscalDocumentIssueOutcomeSchema,
  document_id: UuidSchema.nullable(),
  transport_status: StableCodeSchema.nullable(),
  normalized_result: StableCodeSchema.nullable(),
  cufe: z.string().min(1).max(200).nullable(),
  issued_prefix: z.string().min(1).max(40).nullable(),
  issued_number: z.string().min(1).max(40).nullable(),
  attempt_count: z.number().int().nonnegative().nullable(),
  block_code: StableCodeSchema.nullable(),
  reasons: z.array(FiscalDocumentIssueReasonSchema).max(64),
});

export const FiscalDocumentIssueResponseSchema = createResponseEnvelopeSchema(FiscalDocumentIssueResultSchema);

// ── catalog.product.register ─────────────────────────────────────────────────

/**
 * Catálogo real.
 *
 * Producto, presentación y precio entran **en la misma petición** porque una
 * caja no puede vender ninguno de los tres por separado: un producto sin
 * presentación vendible o sin precio no es un artículo, es media fila.
 *
 * `unit_precision` gobierna qué cantidad se puede vender de este artículo
 * —lo comprueba `quantityFitsUnitPrecision` en la capa confiable— y por eso es
 * obligatorio. Declarar una unidad de peso con precisión 2 es además la
 * mitigación de `D-18`: por encima de dos decimales la venta no se factura.
 */
const BarcodeSchema = z.string().min(4).max(64).regex(/^[0-9A-Za-z-]+$/);

export const CatalogProductRegisterRequestSchema = createRequestEnvelopeSchema(
  z.strictObject({
    code: z.string().min(1).max(64),
    name: z.string().min(1).max(200),
    stock_controlled: z.boolean(),
    presentation_name: z.string().min(1).max(200),
    unit_code: z.string().min(1).max(16),
    unit_precision: z.number().int().min(0).max(6),
    barcode: BarcodeSchema.nullable(),
    price_amount: PositiveScale6Schema,
    currency_code: CurrencyCodeSchema,
  }),
).safeExtend({ message_type: z.literal("catalog.product.register") })
  .superRefine((request, context) => {
    forbidCallerAssertedIdentity(request, context);
    requireIdempotentOperation(request, context);
  });

export const CatalogProductRegisterOutcomeSchema = z.enum([
  "REGISTERED",
  "IDEMPOTENT",
  "UNAUTHORIZED",
  "IDEMPOTENCY_CONFLICT",
  "CODE_ALREADY_REGISTERED",
  "BARCODE_ALREADY_REGISTERED",
]);

/**
 * En los dos resultados de duplicado se devuelve **cuál** es el registro que ya
 * existe: quien captura necesita ir a él, no reintentar a ciegas.
 */
export const CatalogProductRegisterResultSchema = z.strictObject({
  outcome: CatalogProductRegisterOutcomeSchema,
  product_id: UuidSchema.nullable(),
  presentation_id: UuidSchema.nullable(),
});

export const CatalogProductRegisterResponseSchema =
  createResponseEnvelopeSchema(CatalogProductRegisterResultSchema);

// ── catalog.item.find · catalog.item.get ─────────────────────────────────────

/**
 * `catalog.item.find` es el lector de código de barras; `catalog.item.get`
 * recupera una presentación ya conocida. Dos mensajes en vez de uno con campos
 * anulables, por la misma razón que en el adquiriente: un contrato que admite
 * formas inválidas por construcción es peor que dos que no las admiten.
 */
export const CatalogItemFindRequestSchema = createRequestEnvelopeSchema(
  z.strictObject({ barcode: BarcodeSchema }),
).safeExtend({ message_type: z.literal("catalog.item.find") })
  .superRefine(forbidCallerAssertedIdentity);

export const CatalogItemGetRequestSchema = createRequestEnvelopeSchema(
  z.strictObject({ presentation_id: UuidSchema }),
).safeExtend({ message_type: z.literal("catalog.item.get") })
  .superRefine(forbidCallerAssertedIdentity);

export const CatalogItemResultSchema = z.strictObject({
  outcome: z.enum(["FOUND", "NOT_FOUND", "UNAUTHORIZED"]),
  product_id: UuidSchema.nullable(),
  presentation_id: UuidSchema.nullable(),
  code: z.string().min(1).max(64).nullable(),
  name: z.string().min(1).max(200).nullable(),
  presentation_name: z.string().min(1).max(200).nullable(),
  unit_code: z.string().min(1).max(16).nullable(),
  unit_precision: z.number().int().min(0).max(6).nullable(),
  barcode: BarcodeSchema.nullable(),
  stock_controlled: z.boolean().nullable(),
  /**
   * `null` significa **sin precio activo**, no gratis. Una presentación sin
   * precio no se puede vender y la caja tiene que distinguir las dos cosas.
   */
  price_amount: PositiveScale6Schema.nullable(),
  currency_code: CurrencyCodeSchema.nullable(),
});

export const CatalogItemResponseSchema = createResponseEnvelopeSchema(CatalogItemResultSchema);

export const CatalogItemListRequestSchema = createRequestEnvelopeSchema(
  z.strictObject({
    query: z.string().max(200),
    limit: z.number().int().min(1).max(60),
    offset: z.number().int().min(0).max(100000),
  }),
).safeExtend({ message_type: z.literal("catalog.item.list") })
  .superRefine(forbidCallerAssertedIdentity);

export const CatalogItemListItemSchema = z.strictObject({
  product_id: UuidSchema,
  presentation_id: UuidSchema,
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  presentation_name: z.string().min(1).max(200),
  unit_code: z.string().min(1).max(16),
  unit_precision: z.number().int().min(0).max(6),
  barcode: BarcodeSchema.nullable(),
  stock_controlled: z.boolean(),
  price_amount: PositiveScale6Schema,
  currency_code: CurrencyCodeSchema,
});

export const CatalogItemListResultSchema = z.strictObject({
  outcome: z.enum(["FOUND", "UNAUTHORIZED"]),
  items: z.array(CatalogItemListItemSchema).max(60),
  has_more: z.boolean(),
});

export const CatalogItemListResponseSchema =
  createResponseEnvelopeSchema(CatalogItemListResultSchema);



// ── inventory.stock.receive · inventory.stock.adjust · inventory.stock.get ───

/**
 * Inventario — `MIGRATION_015`.
 *
 * **Recibir y ajustar son dos mensajes, no uno con un campo `tipo`.** Recibir
 * mercancía es rutina; ajustar es corregir la verdad, y es la vía por la que se
 * roba en un POS. Separarlos permite que el permiso los separe: el cajero que
 * recibe el pedido del proveedor no tiene por qué poder cuadrar el inventario a
 * mano.
 *
 * La cantidad es siempre **positiva**: el signo lo da el tipo de movimiento, no
 * el número. Un contrato que admitiera cantidades negativas dejaría que una
 * recepción restara existencia.
 */
export const InventoryStockReceiveRequestSchema = createRequestEnvelopeSchema(
  z.strictObject({
    presentation_id: UuidSchema,
    movement_type: z.enum(["OPENING_COUNT", "PURCHASE_RECEIPT", "TRANSFER_IN"]),
    quantity: PositiveScale6Schema,
    reason_code: z.string().min(1).max(64).regex(/^[A-Z][A-Z0-9_]*$/),
    business_date: BusinessDateSchema,
  }),
).safeExtend({ message_type: z.literal("inventory.stock.receive") })
  .superRefine((request, context) => {
    forbidCallerAssertedIdentity(request, context);
    requireIdempotentOperation(request, context);
  });

export const InventoryStockAdjustRequestSchema = createRequestEnvelopeSchema(
  z.strictObject({
    presentation_id: UuidSchema,
    movement_type: z.enum([
      "ADJUSTMENT_POSITIVE",
      "ADJUSTMENT_NEGATIVE",
      "SHRINKAGE",
      "TRANSFER_OUT",
    ]),
    quantity: PositiveScale6Schema,
    reason_code: z.string().min(1).max(64).regex(/^[A-Z][A-Z0-9_]*$/),
    business_date: BusinessDateSchema,
  }),
).safeExtend({ message_type: z.literal("inventory.stock.adjust") })
  .superRefine((request, context) => {
    forbidCallerAssertedIdentity(request, context);
    requireIdempotentOperation(request, context);
  });

export const InventoryMovementOutcomeSchema = z.enum([
  "POSTED",
  "IDEMPOTENT",
  "UNAUTHORIZED",
  "IDEMPOTENCY_CONFLICT",
  "PRESENTATION_NOT_FOUND",
  "INSUFFICIENT_STOCK",
]);

/**
 * `quantity_after` viaja en la respuesta porque es lo que la pantalla necesita
 * mostrar tras el movimiento, y `available` sólo se rellena en el rechazo por
 * falta de existencia: decir cuánto hay es lo que permite corregir la captura.
 */
export const InventoryMovementResultSchema = z.strictObject({
  outcome: InventoryMovementOutcomeSchema,
  stock_sequence: z.number().int().positive().nullable(),
  quantity_after: NonNegativeScale6Schema.nullable(),
  available: NonNegativeScale6Schema.nullable(),
});

export const InventoryMovementResponseSchema =
  createResponseEnvelopeSchema(InventoryMovementResultSchema);

export const InventoryStockGetRequestSchema = createRequestEnvelopeSchema(
  z.strictObject({ presentation_id: UuidSchema }),
).safeExtend({ message_type: z.literal("inventory.stock.get") })
  .superRefine(forbidCallerAssertedIdentity);

/**
 * `NOT_FOUND` y cero **no** son lo mismo y no se colapsan: una presentación que
 * nunca tuvo movimiento no es una que se agotó, y la diferencia distingue «no
 * lo manejamos» de «hay que reponer».
 */
export const InventoryStockGetResultSchema = z.strictObject({
  outcome: z.enum(["FOUND", "NOT_FOUND", "UNAUTHORIZED"]),
  presentation_id: UuidSchema.nullable(),
  quantity_on_hand: NonNegativeScale6Schema.nullable(),
  last_movement_sequence: z.number().int().nonnegative().nullable(),
});

export const InventoryStockGetResponseSchema =
  createResponseEnvelopeSchema(InventoryStockGetResultSchema);

// ── sales.receipt.get ────────────────────────────────────────────────────────

/**
 * El recibo de una venta cobrada — `DEC-019`.
 *
 * **Es una proyección, no un artefacto guardado.** Cada cifra de este resultado
 * sale ya congelada de `sales_sales` y `sales_sale_items`; el servicio no
 * recalcula ninguna. Reimprimir es determinista porque sus entradas lo son.
 *
 * `NOT_FOUND` y `NOT_COMPLETED` no se colapsan. «Esa venta no es de esta caja» y
 * «esa venta todavía no está cobrada» piden dos reacciones distintas del cajero,
 * y un único error le haría buscar un problema donde no lo hay.
 *
 * **No lleva cabecera fiscal, ni CUFE, ni QR.** No es un olvido: no existe
 * identidad de compañía en local y el adapter fiscal no tiene consumidor. El
 * contrato no admite esos campos precisamente para que nadie los rellene con un
 * valor inventado — un NIT fabricado en un documento que se entrega a un cliente
 * es un problema legal, no un hueco de interfaz.
 */
export const SalesReceiptGetRequestSchema = createRequestEnvelopeSchema(
  z.strictObject({ sale_id: UuidSchema }),
).safeExtend({ message_type: z.literal("sales.receipt.get") })
  .superRefine(forbidCallerAssertedIdentity);

/** El ajuste de redondeo comercial es el único importe del recibo que puede ser negativo. */
const SignedScale6Schema = z.string().regex(/^-?(?:0|[1-9]\d{0,14})\.\d{6}$/);

export const ReceiptLineSchema = z.strictObject({
  line_number: z.number().int().positive(),
  product_name: z.string().min(1),
  presentation_name: z.string().min(1),
  identifier: z.string().nullable(),
  unit_code: z.string().min(1),
  unit_precision: z.number().int().nonnegative(),
  quantity: NonNegativeScale6Schema,
  unit_price_amount: NonNegativeScale6Schema,
  gross_amount: NonNegativeScale6Schema,
  discount_amount: NonNegativeScale6Schema,
  taxable_amount: NonNegativeScale6Schema,
  tax_amount: NonNegativeScale6Schema,
  line_total_amount: NonNegativeScale6Schema,
});

/** `change_amount` sólo tiene sentido en efectivo: una transferencia no devuelve cambio. */
export const ReceiptPaymentSchema = z.strictObject({
  payment_method: z.string().min(1),
  confirmed_amount: NonNegativeScale6Schema,
  tendered_amount: NonNegativeScale6Schema.nullable(),
  change_amount: NonNegativeScale6Schema.nullable(),
  currency_code: z.string().length(3),
  confirmed_at: z.string().min(1),
});

export const SalesReceiptGetResultSchema = z.strictObject({
  outcome: z.enum(["FOUND", "NOT_FOUND", "NOT_COMPLETED", "UNAUTHORIZED"]),
  sale_id: UuidSchema.nullable(),
  document_series: z.string().min(1).nullable(),
  sale_number: z.number().int().positive().nullable(),
  currency_code: z.string().length(3).nullable(),
  business_date: z.string().nullable(),
  completed_at: z.string().nullable(),
  lines: z.array(ReceiptLineSchema).nullable(),
  subtotal_amount: NonNegativeScale6Schema.nullable(),
  discount_amount: NonNegativeScale6Schema.nullable(),
  tax_amount: NonNegativeScale6Schema.nullable(),
  fiscal_total_amount: NonNegativeScale6Schema.nullable(),
  commercial_rounding_adjustment: SignedScale6Schema.nullable(),
  payable_amount: NonNegativeScale6Schema.nullable(),
  payments: z.array(ReceiptPaymentSchema).nullable(),
  calculation_checksum: z.string().length(64).regex(/^[a-f0-9]{64}$/).nullable(),
});

export const SalesReceiptGetResponseSchema =
  createResponseEnvelopeSchema(SalesReceiptGetResultSchema);

// ── audit.event.list ──────────────────────────────────────────────────────────

/**
 * Read-only local audit projection. The renderer can filter evidence, but it
 * cannot assert tenant/company/branch identity. Sensitive JSON evidence is not
 * returned by this V1 contract.
 */
export const AuditEventListRequestSchema = createRequestEnvelopeSchema(
  z.strictObject({
    query: z.string().max(200),
    action_code: StableCodeSchema.nullable(),
    resource_type: StableCodeSchema.nullable(),
    actor_type: z.enum(["USER", "DEVICE", "SYSTEM"]).nullable(),
    from: UtcDateTimeSchema.nullable(),
    to: UtcDateTimeSchema.nullable(),
    limit: z.number().int().min(1).max(100),
    offset: z.number().int().min(0).max(100000),
  }),
).safeExtend({ message_type: z.literal("audit.event.list") })
  .superRefine((request, context) => {
    forbidCallerAssertedIdentity(request, context);
    if (request.payload.from !== null && request.payload.to !== null &&
        request.payload.from > request.payload.to) {
      context.addIssue({
        code: "custom",
        path: ["payload", "from"],
        message: "from must be earlier than or equal to to",
      });
    }
  });

export const AuditEventListItemSchema = z.strictObject({
  sequence: z.number().int().positive(),
  actor_type: z.enum(["USER", "DEVICE", "SYSTEM"]),
  actor_id: UuidSchema.nullable(),
  session_id: UuidSchema,
  action_code: StableCodeSchema,
  resource_type: StableCodeSchema,
  resource_id: UuidSchema.nullable(),
  correlation_id: UuidSchema,
  causation_id: UuidSchema.nullable(),
  reason_code: StableCodeSchema.nullable(),
  created_at: UtcDateTimeSchema,
});

export const AuditEventListResultSchema = z.strictObject({
  outcome: z.enum(["FOUND", "UNAUTHORIZED"]),
  events: z.array(AuditEventListItemSchema).max(100),
  has_more: z.boolean(),
});

export const AuditEventListResponseSchema =
  createResponseEnvelopeSchema(AuditEventListResultSchema);

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
  "authorization.capabilities.get",
  "session.activate",
  "session.recover",
  "cash.shift.open",
  "cash.shift.close",
  "sale.create",
  "payment.register.cash",
  "payment.register.transfer",
  "payment.transfer.confirm",
  "payment.cancel",
  "payment.get",
  "customer.register",
  "customer.get",
  "customer.find",
  "customer.marketing.subscribe",
  "customer.marketing.unsubscribe",
  "customer.marketing.get",
  "catalog.product.register",
  "catalog.item.find",
  "catalog.item.get",
  "inventory.stock.receive",
  "inventory.stock.adjust",
  "inventory.stock.get",
  "audit.event.list",
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
  "pos:payment.register.cash",
  "pos:payment.register.transfer",
  "pos:payment.transfer.confirm",
  "pos:payment.cancel",
  "pos:payment.get",
  "pos:customer.register",
  "pos:customer.get",
  "pos:customer.find",
  "pos:catalog.product.register",
  "pos:catalog.item.find",
  "pos:catalog.item.get",
  "pos:inventory.stock.receive",
  "pos:inventory.stock.adjust",
  "pos:inventory.stock.get",
] as const;

export type CommercialIpcMessageType = z.infer<typeof CommercialIpcMessageTypeSchema>;
export type AuthorizationCapabilitiesGetResult = z.infer<typeof AuthorizationCapabilitiesGetResultSchema>;
export type SessionActivateResult = z.infer<typeof SessionActivateResultSchema>;
export type SessionRecoverResult = z.infer<typeof SessionRecoverResultSchema>;
export type CashShiftOpenResult = z.infer<typeof CashShiftOpenResultSchema>;
export type CashShiftCloseResult = z.infer<typeof CashShiftCloseResultSchema>;
export type SaleCreateResult = z.infer<typeof SaleCreateResultSchema>;
export type PaymentRegisterCashResult = z.infer<typeof PaymentRegisterCashResultSchema>;
export type PaymentRegisterTransferResult = z.infer<typeof PaymentRegisterTransferResultSchema>;
export type PaymentTransferConfirmResult = z.infer<typeof PaymentTransferConfirmResultSchema>;
export type PaymentCancelResult = z.infer<typeof PaymentCancelResultSchema>;
export type PaymentGetResult = z.infer<typeof PaymentGetResultSchema>;
export type CustomerRegisterResult = z.infer<typeof CustomerRegisterResultSchema>;
export type CustomerReadResult = z.infer<typeof CustomerReadResultSchema>;
export type CustomerFinding = z.infer<typeof CustomerFindingSchema>;
export type CustomerMarketingSubscriptionResult = z.infer<typeof CustomerMarketingSubscriptionResultSchema>;
export type FiscalDocumentIssueResult = z.infer<typeof FiscalDocumentIssueResultSchema>;
export type FiscalDocumentIssueReason = z.infer<typeof FiscalDocumentIssueReasonSchema>;
export type CatalogProductRegisterResult = z.infer<typeof CatalogProductRegisterResultSchema>;
export type CatalogItemResult = z.infer<typeof CatalogItemResultSchema>;
export type SalesReceiptGetResult = z.infer<typeof SalesReceiptGetResultSchema>;
export type ReceiptLine = z.infer<typeof ReceiptLineSchema>;
export type ReceiptPayment = z.infer<typeof ReceiptPaymentSchema>;
export type InventoryMovementResult = z.infer<typeof InventoryMovementResultSchema>;
export type InventoryStockGetResult = z.infer<typeof InventoryStockGetResultSchema>;
export type AuditEventListResult = z.infer<typeof AuditEventListResultSchema>;
