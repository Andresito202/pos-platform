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
 * Incorpora además la superficie de Payment V1 (`DEC-016`):
 * `payment.register.cash`, `payment.register.transfer`, `payment.register.qr`,
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
    /**
     * Adquiriente de la venta, cuando la operación lo nombra.
     *
     * Opcional a propósito: la venta de mostrador anónima es el caso normal en
     * una tienda de barrio y sigue siendo válida sin este campo.
     *
     * Nombrar al cliente **no** es aportar ámbito. La capa confiable comprueba
     * que el identificador exista bajo el `tenant` del contexto verificado —no
     * bajo el que diga el llamador— dentro de la misma transacción que crea la
     * venta, así que un cliente ajeno no resuelve y la venta no llega a
     * escribirse.
     *
     * Y **no expresa deuda**: decir quién compró no es decir que deba. El
     * crédito al cliente sigue diferido a `DEC-005` / `CUST-002`.
     */
    customer_id: UuidSchema.nullable().optional(),
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
  // El adquiriente nombrado no existe bajo este tenant. Se comprueba dentro de
  // la transacción de creación, así que el rechazo no deja venta a medias.
  "CUSTOMER_NOT_FOUND",
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

// ── payment.register.qr ─────────────────────────────────────────────────────

/**
 * QR dinámico respaldado por un proveedor. Registrar el intent no confirma el
 * dinero: crea un Payment PENDING y conserva la referencia del proveedor.
 */
export const PaymentRegisterQrRequestSchema = createRequestEnvelopeSchema(
  z.strictObject({
    sale_id: UuidSchema,
    amount: PositiveScale6Schema,
  }),
).safeExtend({ message_type: z.literal("payment.register.qr") })
  .superRefine((request, context) => {
    forbidCallerAssertedIdentity(request, context);
    requireIdempotentOperation(request, context);
  });

export const PaymentRegisterQrOutcomeSchema = z.enum([
  "PENDING",
  "IDEMPOTENT",
  "UNAUTHORIZED",
  "IDEMPOTENCY_CONFLICT",
  "SALE_NOT_FOUND",
  "SALE_NOT_PAYABLE",
  "SALE_ALREADY_COMPLETED",
  "CURRENCY_MISMATCH",
  "PROVIDER_REJECTED",
  "PROVIDER_REFERENCE_REQUIRED",
  "PROVIDER_NOT_CONFIGURED",
  "OVERPAYMENT_NOT_ALLOWED",
]);

export const PaymentRegisterQrResultSchema = z.strictObject({
  outcome: PaymentRegisterQrOutcomeSchema,
  payment_id: UuidSchema.nullable(),
  provider_reference: z.string().min(1).max(128).nullable(),
  /** URL de checkout generada por el proveedor; nunca es evidencia financiera. */
  checkout_url: z.string().url().nullable(),
});

export const PaymentRegisterQrResponseSchema = createResponseEnvelopeSchema(PaymentRegisterQrResultSchema);

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

// ── credit.account.open ──────────────────────────────────────────────────────

/**
 * Cuenta de crédito de un cliente — `DEC-005`, `CUST-002`.
 *
 * El cupo es **explícito y obligatorio**: no existe cupo por defecto del
 * comercio, y no tener cuenta es no tener crédito. Fiar a alguien es una
 * decisión deliberada por cliente, así que ninguna otra operación abre cuentas
 * de paso.
 *
 * `customer_id` no es ámbito: la capa confiable comprueba que exista bajo el
 * `tenant` del contexto verificado, nunca bajo el que diga el llamador.
 */
export const CreditAccountOpenRequestSchema = createRequestEnvelopeSchema(
  z.strictObject({
    customer_id: UuidSchema,
    credit_limit: NonNegativeScale6Schema,
    currency_code: CurrencyCodeSchema,
  }),
).safeExtend({ message_type: z.literal("credit.account.open") })
  .superRefine((request, context) => {
    forbidCallerAssertedIdentity(request, context);
    requireIdempotentOperation(request, context);
  });

export const CreditAccountOpenResultSchema = z.strictObject({
  outcome: z.enum([
    "OPENED",
    "IDEMPOTENT",
    "UNAUTHORIZED",
    "CUSTOMER_NOT_FOUND",
    "ACCOUNT_ALREADY_EXISTS",
    "CURRENCY_MISMATCH",
    "IDEMPOTENCY_CONFLICT",
  ]),
  account_id: UuidSchema.nullable(),
});

export const CreditAccountOpenResponseSchema = createResponseEnvelopeSchema(CreditAccountOpenResultSchema);

// ── credit.account.get ───────────────────────────────────────────────────────

/**
 * Cupo, saldo y disponible de un cliente.
 *
 * Los tres salen del libro: el saldo es `Σ(INCREASE) − Σ(DECREASE)` recomputado
 * al leer, no una columna. El llamador no puede aportarlos ni corregirlos.
 */
export const CreditAccountGetRequestSchema = createRequestEnvelopeSchema(
  z.strictObject({ customer_id: UuidSchema }),
).safeExtend({ message_type: z.literal("credit.account.get") })
  .superRefine(forbidCallerAssertedIdentity);

export const CreditAccountGetResultSchema = z.strictObject({
  outcome: z.enum(["FOUND", "CREDIT_ACCOUNT_NOT_FOUND", "UNAUTHORIZED"]),
  account_id: UuidSchema.nullable(),
  customer_id: UuidSchema.nullable(),
  credit_limit: NonNegativeScale6Schema.nullable(),
  outstanding_balance: NonNegativeScale6Schema.nullable(),
  available_credit: NonNegativeScale6Schema.nullable(),
  currency_code: CurrencyCodeSchema.nullable(),
});

export const CreditAccountGetResponseSchema = createResponseEnvelopeSchema(CreditAccountGetResultSchema);

// ── payment.register.credit ──────────────────────────────────────────────────

/**
 * Venta a crédito — `DEC-005`.
 *
 * No es un cobro paralelo: recorre el mismo `Payment` que el efectivo, con su
 * misma imputación y su misma finalización de venta. Lo que cambia es que el
 * crédito **no es efectivo recibido**, así que no exige turno ni asienta en
 * caja, y que la obligación queda registrada en el libro del cliente.
 *
 * El importe viaja; el cupo **no**. Lo recomputa la capa confiable desde el
 * libro, dentro de la misma transacción que registra la deuda: un cupo enviado
 * por el llamador sería exactamente lo que el rechazo duro existe para impedir.
 */
export const PaymentRegisterCreditRequestSchema = createRequestEnvelopeSchema(
  z.strictObject({
    sale_id: UuidSchema,
    amount: PositiveScale6Schema,
  }),
).safeExtend({ message_type: z.literal("payment.register.credit") })
  .superRefine((request, context) => {
    forbidCallerAssertedIdentity(request, context);
    requireIdempotentOperation(request, context);
  });

export const PaymentRegisterCreditResultSchema = z.strictObject({
  outcome: z.enum([
    "CONFIRMED",
    "IDEMPOTENT",
    "UNAUTHORIZED",
    "SALE_NOT_FOUND",
    "SALE_NOT_PAYABLE",
    "SALE_ALREADY_COMPLETED",
    "CURRENCY_MISMATCH",
    "OVERPAYMENT_NOT_ALLOWED",
    "INSUFFICIENT_STOCK",
    /** La venta no nombra adquiriente: `DEC-002` §159 lo exige para fiar. */
    "CUSTOMER_REQUIRED",
    "CREDIT_ACCOUNT_NOT_FOUND",
    /** Rechazo duro: el saldo nunca puede superar el cupo. Sin override. */
    "CREDIT_LIMIT_EXCEEDED",
    /** El despliegue no tiene crédito cableado. */
    "CREDIT_NOT_AVAILABLE",
    "IDEMPOTENCY_CONFLICT",
  ]),
  payment_id: UuidSchema.nullable(),
  sale_completed: z.boolean().nullable(),
  confirmed_coverage: NonNegativeScale6Schema.nullable(),
  payable_amount: NonNegativeScale6Schema.nullable(),
  /** Sólo en `CREDIT_LIMIT_EXCEEDED`: cuánto quedaba de verdad. */
  available_credit: NonNegativeScale6Schema.nullable(),
});

export const PaymentRegisterCreditResponseSchema = createResponseEnvelopeSchema(PaymentRegisterCreditResultSchema);

// ── credit.payment.register ──────────────────────────────────────────────────

/**
 * Abono de un cliente contra su deuda.
 *
 * **No es el pago de una venta.** Las ventas que originaron la deuda ya se
 * completaron al fiarlas; esto reduce el saldo y libera cupo. Por eso no crea
 * `Payment` ni imputa cobertura.
 *
 * En efectivo entra al cajón como `CASH_PAYMENT` y exige turno abierto en la
 * caja que se nombre — el mismo selector de `DEC-012` §25.2 que usa la venta,
 * no uno nuevo por sucursal.
 */
export const CreditPaymentRegisterRequestSchema = createRequestEnvelopeSchema(
  z.strictObject({
    customer_id: UuidSchema,
    amount: PositiveScale6Schema,
    currency_code: CurrencyCodeSchema,
    method: z.enum(["CASH", "TRANSFER"]),
    cash_register_id: UuidSchema.nullable(),
    business_date: BusinessDateSchema,
  }),
).safeExtend({ message_type: z.literal("credit.payment.register") })
  .superRefine((request, context) => {
    forbidCallerAssertedIdentity(request, context);
    requireIdempotentOperation(request, context);
    if (request.payload.method === "CASH" && request.payload.cash_register_id === null) {
      context.addIssue({
        code: "custom",
        path: ["payload", "cash_register_id"],
        message: "a cash repayment must name the register where the money enters",
      });
    }
  });

export const CreditPaymentRegisterResultSchema = z.strictObject({
  outcome: z.enum([
    "RECORDED",
    "IDEMPOTENT",
    "UNAUTHORIZED",
    "CREDIT_ACCOUNT_NOT_FOUND",
    "CURRENCY_MISMATCH",
    /** Un abono mayor que la deuda crearía saldo a favor: fuera de alcance. */
    "REPAYMENT_EXCEEDS_BALANCE",
    "CASH_SHIFT_MISSING",
    "CASH_SHIFT_NOT_OPEN",
    "IDEMPOTENCY_CONFLICT",
  ]),
  transaction_id: UuidSchema.nullable(),
  outstanding_balance: NonNegativeScale6Schema.nullable(),
  available_credit: NonNegativeScale6Schema.nullable(),
});

export const CreditPaymentRegisterResponseSchema = createResponseEnvelopeSchema(CreditPaymentRegisterResultSchema);

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

// ── catalog.fiscal.attribute.set ─────────────────────────────────────────────

/**
 * Atributo fiscal de una presentación (`catalog_fiscal_attribute`, `MIGRATION_013`).
 *
 * **Por qué existe esta operación.** La tabla tenía un lector en producción y
 * **cero escritores** —la deuda `D-19`—: ninguna pantalla, ningún caso de uso y
 * ninguna operación del canal podían darle a una presentación su
 * `unit_measure_code`, `standard_code`, `tax_code` y `tax_rate`. Sin ellos
 * ninguna línea de venta se declara ante la DIAN, así que **ningún producto
 * dado de alta por el POS se podía facturar electrónicamente**.
 *
 * **Por qué es una operación aparte y no un campo más del alta.** Un código
 * fiscal equivocado se corrige; el alta ocurre una sola vez. Atarlo a
 * `catalog.product.register` dejaría el error sin vía de arreglo salvo
 * reescribir el producto. Además añadir una operación es menos invasivo sobre
 * una superficie cerrada que modificar una ya ratificada.
 *
 * **La forma no es la pertenencia.** La tabla comprueba con `GLOB` que los
 * códigos *tengan forma* de código DIAN; no comprueba que *existan* en las
 * tablas verificadas. Por eso la capa confiable valida con
 * `validateFiscalDocumentItem` **antes** de guardar: un `unit_measure_code`
 * inventado con forma válida se guardaría y sólo fallaría al emitir, con la
 * venta ya cobrada y el cliente delante.
 */
export const CatalogFiscalAttributeSetRequestSchema = createRequestEnvelopeSchema(
  z.strictObject({
    presentation_id: UuidSchema,
    /** Código del artículo en el catálogo del comerciante. */
    code_reference: z.string().min(1).max(80),
    unit_measure_code: z.string().min(1).max(8),
    standard_code: z.string().min(1).max(8),
    tax_code: z.string().min(1).max(8),
    tax_rate: NonNegativeScale6Schema,
    status: z.enum(["ACTIVE", "INACTIVE"]),
  }),
).safeExtend({ message_type: z.literal("catalog.fiscal.attribute.set") })
  .superRefine((request, context) => {
    forbidCallerAssertedIdentity(request, context);
    requireIdempotentOperation(request, context);
  });

export const CatalogFiscalAttributeSetOutcomeSchema = z.enum([
  "SET",
  "IDEMPOTENT",
  "UNAUTHORIZED",
  "IDEMPOTENCY_CONFLICT",
  "PRESENTATION_NOT_FOUND",
  /** Uno o más códigos no pertenecen a las tablas DIAN verificadas. */
  "FISCAL_CODES_NOT_VERIFIED",
]);

/**
 * `findings` nombra **qué** código no se verificó y **dónde**, nunca su valor:
 * misma regla que `FiscalItemFinding`. Sin ellos el operador tendría que
 * adivinar cuál de los cuatro códigos está mal.
 */
export const CatalogFiscalAttributeSetResultSchema = z.strictObject({
  outcome: CatalogFiscalAttributeSetOutcomeSchema,
  presentation_id: UuidSchema.nullable(),
  findings: z.array(z.strictObject({
    code: StableCodeSchema,
    path: z.string().min(1).max(64),
  })).max(16),
});

export const CatalogFiscalAttributeSetResponseSchema =
  createResponseEnvelopeSchema(CatalogFiscalAttributeSetResultSchema);

// ── catalog.presentation.add ─────────────────────────────────────────────────

/**
 * Añade una presentación **a un producto que ya existe**.
 *
 * `DEC-004` fija `Product 1 ─── 1..N ProductPresentation` y el esquema lo
 * admite —`catalog_presentation` cuelga de `catalog_product` con índice por
 * producto—, pero **no había forma de llegar a la segunda**:
 * `catalog.product.register` crea producto, presentación y precio en una sola
 * transacción y era la única escritura de catálogo. Una tienda de barrio que
 * vende la unidad y el paquete del mismo artículo, o una licorera con la
 * botella y la caja, no podía representarlos.
 *
 * **Qué NO hace, y hay que leerlo antes de usarla.** No declara conversión
 * entre presentaciones. `DEC-004` §747 especifica `contained_quantity` y
 * `conversion_factor` como atributos de la presentación, y `MIGRATION_014`
 * **no los materializó**. En consecuencia cada presentación lleva su propia
 * existencia —que es exactamente lo que `DEC-004` §1129 manda: «el inventario
 * operativo pertenece a `ProductPresentation`»— y **vender una paca de 12 no
 * descuenta 12 unidades de la presentación «unidad»**. Son dos saldos
 * independientes. Abrir una paca y convertirla en unidades exige esa columna y
 * una migración, y es una capacidad aparte.
 *
 * El precio entra aquí por la misma razón que en el alta: una presentación sin
 * precio no es vendible, y dejarla a medias sería un estado que ninguna
 * pantalla puede resolver.
 */
export const CatalogPresentationAddRequestSchema = createRequestEnvelopeSchema(
  z.strictObject({
    product_id: UuidSchema,
    name: z.string().min(1).max(200),
    unit_code: z.string().min(1).max(16),
    unit_precision: z.number().int().min(0).max(6),
    barcode: BarcodeSchema.nullable(),
    price_amount: PositiveScale6Schema,
    currency_code: CurrencyCodeSchema,
  }),
).safeExtend({ message_type: z.literal("catalog.presentation.add") })
  .superRefine((request, context) => {
    forbidCallerAssertedIdentity(request, context);
    requireIdempotentOperation(request, context);
  });

export const CatalogPresentationAddOutcomeSchema = z.enum([
  "ADDED",
  "IDEMPOTENT",
  "UNAUTHORIZED",
  "IDEMPOTENCY_CONFLICT",
  /** El producto no existe bajo el tenant del contexto verificado. */
  "PRODUCT_NOT_FOUND",
  "BARCODE_ALREADY_REGISTERED",
]);

/**
 * `presentation_id` viaja también en `BARCODE_ALREADY_REGISTERED`: devuelve
 * **cuál** es la presentación que ya usa ese código, porque quien lo captura
 * necesita ir a ella, no reintentar a ciegas. Misma regla que el alta.
 */
export const CatalogPresentationAddResultSchema = z.strictObject({
  outcome: CatalogPresentationAddOutcomeSchema,
  product_id: UuidSchema.nullable(),
  presentation_id: UuidSchema.nullable(),
});

export type CatalogPresentationAddResult = z.infer<typeof CatalogPresentationAddResultSchema>;

export const CatalogPresentationAddResponseSchema =
  createResponseEnvelopeSchema(CatalogPresentationAddResultSchema);

// ── catalog.conversion.declare · inventory.conversion.apply ──────────────────

/**
 * Declara `1 origen = factor destino` entre dos presentaciones del mismo
 * producto (`DEC-004` §1579).
 *
 * Declarar no convierte nada: deja escrito el factor con el que se podrá
 * convertir. Son dos operaciones porque son dos decisiones distintas —la de
 * quien configura el catálogo y la de quien abre una paca en el mostrador—,
 * con permisos y momentos distintos.
 *
 * `reversible` se declara y se guarda, pero **hoy no habilita la vuelta**:
 * `DEC-004` §1658 advierte que ser matemáticamente reversible no implica
 * serlo operativamente —empaque abierto, lote, vencimiento, merma—, y ninguna
 * de esas piezas existe. Se registra para no perder la intención del
 * comerciante, no para actuar sobre ella.
 */
export const CatalogConversionDeclareRequestSchema = createRequestEnvelopeSchema(
  z.strictObject({
    product_id: UuidSchema,
    source_presentation_id: UuidSchema,
    target_presentation_id: UuidSchema,
    /** Cuántas unidades de destino produce una de origen. Escala 6, > 0. */
    factor: PositiveScale6Schema,
    reversible: z.boolean(),
  }),
).safeExtend({ message_type: z.literal("catalog.conversion.declare") })
  .superRefine((request, context) => {
    forbidCallerAssertedIdentity(request, context);
    requireIdempotentOperation(request, context);
  });

export const CatalogConversionDeclareOutcomeSchema = z.enum([
  "DECLARED",
  "IDEMPOTENT",
  "UNAUTHORIZED",
  "IDEMPOTENCY_CONFLICT",
  "PRESENTATION_NOT_FOUND",
  /** `DEC-004` §1602: origen y destino tienen que ser del producto declarado. */
  "PRESENTATIONS_NOT_SAME_PRODUCT",
  /** Ya hay una vigente para el par: dos factores serían ambiguos (§1631). */
  "CONVERSION_ALREADY_DECLARED",
]);

export const CatalogConversionDeclareResultSchema = z.strictObject({
  outcome: CatalogConversionDeclareOutcomeSchema,
  conversion_id: UuidSchema.nullable(),
});

export type CatalogConversionDeclareResult =
  z.infer<typeof CatalogConversionDeclareResultSchema>;

export const CatalogConversionDeclareResponseSchema =
  createResponseEnvelopeSchema(CatalogConversionDeclareResultSchema);

/**
 * Aplica la conversión: abre la paca y la convierte en unidades.
 *
 * **Conversión atómica** (`DEC-004` §1736): salida en origen y entrada en
 * destino se confirman juntas, y la invariante «no puede quedar salida sin
 * entrada» la da la transacción, no una comprobación posterior.
 *
 * **El factor no viaja en la petición.** Lo pone el catálogo. Dejar que el
 * mostrador lo aportara convertiría esto en un ajuste de existencia con otro
 * nombre — y un ajuste ya existe, con su propio permiso y su propia auditoría.
 *
 * **No se redondea.** `cantidad × factor` sólo se acepta si da una cantidad
 * exacta que además cabe en la precisión de la unidad destino. Media unidad de
 * un artículo que se vende entero no es una conversión: es un error de captura.
 */
export const InventoryConversionApplyRequestSchema = createRequestEnvelopeSchema(
  z.strictObject({
    source_presentation_id: UuidSchema,
    target_presentation_id: UuidSchema,
    source_quantity: PositiveScale6Schema,
    reason_code: z.string().min(1).max(64),
    business_date: BusinessDateSchema,
  }),
).safeExtend({ message_type: z.literal("inventory.conversion.apply") })
  .superRefine((request, context) => {
    forbidCallerAssertedIdentity(request, context);
    requireIdempotentOperation(request, context);
  });

export const InventoryConversionApplyOutcomeSchema = z.enum([
  "CONVERTED",
  "IDEMPOTENT",
  "UNAUTHORIZED",
  "IDEMPOTENCY_CONFLICT",
  "PRESENTATION_NOT_FOUND",
  /** No hay factor vigente para el par: hay que declararlo antes. */
  "CONVERSION_NOT_DECLARED",
  "INSUFFICIENT_STOCK",
  /** El producto sería fraccionario para la unidad destino. No se redondea. */
  "TARGET_PRECISION_EXCEEDED",
]);

/**
 * Los dos saldos posteriores viajan juntos porque la conversión los mueve a la
 * vez: devolver sólo uno dejaría al operador comprobando el otro a mano.
 */
export const InventoryConversionApplyResultSchema = z.strictObject({
  outcome: InventoryConversionApplyOutcomeSchema,
  source_quantity_after: NonNegativeScale6Schema.nullable(),
  target_quantity_after: NonNegativeScale6Schema.nullable(),
  /** Presente en `INSUFFICIENT_STOCK` y en `TARGET_PRECISION_EXCEEDED`. */
  detail_quantity: NonNegativeScale6Schema.nullable(),
});

export type InventoryConversionApplyResult =
  z.infer<typeof InventoryConversionApplyResultSchema>;

export const InventoryConversionApplyResponseSchema =
  createResponseEnvelopeSchema(InventoryConversionApplyResultSchema);

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
    /**
     * Lote del que sale — `UC-INVENTORY-002` §Salidas paso 4, «selección
     * autorizada». Ausente, la salida resuelve por FEFO sobre lotes vigentes.
     * Es la única vía por la que sale un lote **vencido**, y la merma con
     * motivo `EXPIRED` lo exige (§Mermas regla 3).
     */
    lot_code: z.string().min(1).max(64).nullable().optional(),
  }),
).safeExtend({ message_type: z.literal("inventory.stock.adjust") })
  .superRefine((request, context) => {
    forbidCallerAssertedIdentity(request, context);
    requireIdempotentOperation(request, context);
    // Un lote en una entrada no dice nada que el ajuste sepa hacer: sumar a
    // una tanda es recibirla (`inventory.lot.receive`), con sus fechas.
    if (request.payload.movement_type === "ADJUSTMENT_POSITIVE"
      && request.payload.lot_code !== undefined && request.payload.lot_code !== null) {
      context.addIssue({
        code: "custom",
        path: ["payload", "lot_code"],
        message: "lot_code sólo aplica a salidas",
      });
    }
  });

export const InventoryMovementOutcomeSchema = z.enum([
  "POSTED",
  "IDEMPOTENT",
  "UNAUTHORIZED",
  "IDEMPOTENCY_CONFLICT",
  "PRESENTATION_NOT_FOUND",
  "INSUFFICIENT_STOCK",
  // Sólo el ajuste: el lote nombrado no existe en esta sucursal, no alcanza,
  // o la merma por vencimiento llegó sin lote.
  "LOT_NOT_FOUND",
  "LOT_INSUFFICIENT",
  "LOT_REQUIRED",
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

// ── catalog.item.import ──────────────────────────────────────────────────────

/**
 * Carga inicial del catálogo — la única forma real de alimentar un POS.
 *
 * ## Por qué existe
 *
 * Medido el 2026-09-22: poner **un** artículo vendible y facturable cuesta hoy
 * tres operaciones —`catalog.product.register`, `catalog.fiscal.attribute.set`
 * e `inventory.stock.receive`—, todas de una en una. Un minimercado tiene
 * entre dos y cinco mil referencias. Eso son diez o quince mil capturas a mano
 * antes de vender la primera gaseosa, y es el motivo real por el que un POS no
 * se estrena: no le falta motor, le falta **por dónde meter la mercancía**.
 *
 * Ninguna doctrina del repositorio lo cubría. `UC-ONB-001` inicializa el
 * tenant —licencia y dispositivos—, no el catálogo.
 *
 * ## Por qué no es «todo o nada»
 *
 * Tres mil filas y la 1.742 trae un código de barras repetido. Descartar las
 * 2.999 buenas por una mala obligaría a corregir a ciegas y reintentar entero.
 * Cada fila es **atómica en sí misma** y devuelve su propio desenlace con su
 * índice: el operador corrige exactamente lo que falló y reimporta.
 *
 * Es deliberadamente lo contrario de la conversión atómica, y por la razón
 * opuesta: allí las dos mitades carecen de sentido por separado; aquí cada
 * fila es un artículo independiente.
 *
 * ## Por qué reutiliza los casos de uso existentes
 *
 * Cada fila pasa por `RegisterProductUseCase`, `SetFiscalAttributeUseCase` y
 * `ReceiveStockUseCase`. **No hay un segundo escritor de catálogo**: una ruta
 * de importación con sus propias validaciones acabaría admitiendo lo que la
 * ruta normal rechaza, y esa divergencia no la vería nadie hasta que un
 * artículo importado se comportara distinto a uno capturado.
 */
export const CatalogImportItemSchema = z.strictObject({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  stock_controlled: z.boolean(),
  presentation_name: z.string().min(1).max(120),
  unit_code: z.string().min(1).max(16),
  unit_precision: z.number().int().min(0).max(6),
  barcode: z.string().min(4).max(64).regex(/^[0-9A-Za-z-]+$/).nullable(),
  price_amount: PositiveScale6Schema,
  currency_code: z.literal("COP"),
  /**
   * Existencia inicial. **Opcional**: una ficha de catálogo sin existencia es
   * un estado legítimo —el artículo existe y todavía no llegó—, y obligar a
   * declarar cero haría indistinguible «no llegó» de «se agotó».
   */
  initial_quantity: PositiveScale6Schema.nullable(),
  /**
   * Atributos fiscales. **Opcional**, porque un comercio que aún no factura
   * electrónicamente no tiene por qué inventarse códigos DIAN para poder
   * cargar su catálogo. Sin ellos el artículo se vende y **no se factura**:
   * la emisión lo rechaza, que es fail-closed correcto.
   */
  fiscal: z.strictObject({
    code_reference: z.string().min(1).max(64),
    unit_measure_code: z.string().min(1).max(8),
    standard_code: z.string().min(1).max(8),
    tax_code: z.string().min(1).max(8),
    tax_rate: NonNegativeScale6Schema,
  }).nullable(),
});

/**
 * Tope por llamada.
 *
 * La trama del canal admite 1 MiB (`DEFAULT_MAX_FRAME_BYTES`) y una fila ronda
 * los 300 bytes, así que 500 caben con holgura. El tope no es una limitación
 * del importador sino **la forma de que el fallo sea legible**: un lote que no
 * cabe en una trama se rechaza entero por tamaño y el operador no sabría por
 * qué. Cargar cinco mil referencias son diez llamadas.
 */
export const CATALOG_IMPORT_MAX_ITEMS = 500;

export const CatalogItemImportRequestSchema = createRequestEnvelopeSchema(
  z.strictObject({
    items: z.array(CatalogImportItemSchema).min(1).max(CATALOG_IMPORT_MAX_ITEMS),
    business_date: BusinessDateSchema,
    /** Motivo del movimiento de entrada de la existencia inicial. */
    reason_code: z.string().min(1).max(64).regex(/^[A-Z][A-Z0-9_]*$/),
  }),
).safeExtend({ message_type: z.literal("catalog.item.import") })
  .superRefine((request, context) => {
    forbidCallerAssertedIdentity(request, context);
    requireIdempotentOperation(request, context);
    // Dos filas con el mismo código en el mismo lote son un error de origen,
    // no una segunda remesa: la segunda chocaría contra la primera y el
    // operador vería un conflicto sin entender que se lo hizo él.
    const codes = request.payload.items.map((item) => item.code);
    if (new Set(codes).size !== codes.length) {
      context.addIssue({
        code: "custom", path: ["payload", "items"],
        message: "the batch repeats a product code",
      });
    }
    const barcodes = request.payload.items
      .map((item) => item.barcode).filter((value): value is string => value !== null);
    if (new Set(barcodes).size !== barcodes.length) {
      context.addIssue({
        code: "custom", path: ["payload", "items"],
        message: "the batch repeats a barcode",
      });
    }
  });

/**
 * Desenlace **por fila**. `IMPORTED` cubre la fila completa; los demás dicen
 * exactamente dónde se detuvo, porque una fila puede crear el artículo y
 * fallar al declarar sus códigos fiscales.
 */
export const CatalogImportRowOutcomeSchema = z.enum([
  "IMPORTED",
  /** Ya existía con ese código: la fila no se toca. No es un error de carga. */
  "CODE_ALREADY_REGISTERED",
  "BARCODE_ALREADY_REGISTERED",
  /** El artículo quedó creado y sus códigos fiscales no: no se puede facturar. */
  "FISCAL_CODES_NOT_VERIFIED",
  /** El artículo quedó creado y su existencia inicial no. */
  "STOCK_NOT_APPLIED",
]);

export const CatalogItemImportResultSchema = z.strictObject({
  outcome: z.enum(["COMPLETED", "UNAUTHORIZED", "IDEMPOTENCY_CONFLICT"]),
  imported: z.number().int().nonnegative(),
  /**
   * Sólo las filas que **no** quedaron `IMPORTED`. Devolver las quinientas
   * haría ilegible el resultado justo cuando hay un problema que leer.
   */
  rejected: z.array(z.strictObject({
    index: z.number().int().nonnegative(),
    code: z.string().min(1).max(64),
    outcome: CatalogImportRowOutcomeSchema,
  })).max(CATALOG_IMPORT_MAX_ITEMS),
});

export const CatalogItemImportResponseSchema =
  createResponseEnvelopeSchema(CatalogItemImportResultSchema);

// ── inventory.lot.receive · inventory.lot.list ───────────────────────────────

/**
 * Lotes y vencimiento — `MIGRATION_026`, `UC-INVENTORY-002` §Lotes.
 *
 * **Recibir por lote es una operación aparte de `inventory.stock.receive`, no
 * un campo opcional.** Un `lot_code` opcional en la recepción ordinaria dejaría
 * que la misma operación produjera a veces trazabilidad y a veces no, según se
 * acordara el cajero de escribirlo. Para carnes y embutidos la trazabilidad no
 * es un extra: es el requisito sanitario, y un rastro que existe «cuando
 * alguien se acuerda» no sirve para acotar un retiro.
 *
 * El tipo de movimiento no viaja: recibir un lote **es** una recepción. Dejarlo
 * elegir permitiría declarar una salida con forma de entrada.
 */
export const InventoryLotReceiveRequestSchema = createRequestEnvelopeSchema(
  z.strictObject({
    presentation_id: UuidSchema,
    /** Identifica la tanda dentro de su presentación. Lo pone el proveedor o el comercio. */
    lot_code: z.string().min(1).max(64),
    quantity: PositiveScale6Schema,
    /**
     * Ambas opcionales y ambas comprobadas contra `received_date` por el
     * esquema: un vencimiento anterior a la recepción envenenaría FEFO.
     */
    manufactured_date: BusinessDateSchema.nullable(),
    expiry_date: BusinessDateSchema.nullable(),
    reason_code: z.string().min(1).max(64).regex(/^[A-Z][A-Z0-9_]*$/),
    business_date: BusinessDateSchema,
  }),
).safeExtend({ message_type: z.literal("inventory.lot.receive") })
  .superRefine((request, context) => {
    forbidCallerAssertedIdentity(request, context);
    requireIdempotentOperation(request, context);
  });

export const InventoryLotReceiveOutcomeSchema = z.enum([
  "RECEIVED",
  "UNAUTHORIZED",
  "IDEMPOTENCY_CONFLICT",
  "PRESENTATION_NOT_FOUND",
  /** Fechas incoherentes entre sí: vencimiento antes de recibir, o fabricación después. */
  "LOT_DATES_INVALID",
  /**
   * El mismo `lot_code` ya existe con otras fechas. **No se fusiona.** Dos
   * tandas distintas bajo un mismo código harían ambiguo un retiro sanitario,
   * y elegir en silencio cuál de las dos fechas vale sería inventar un dato.
   */
  "LOT_CODE_CONFLICT",
]);

export const InventoryLotReceiveResultSchema = z.strictObject({
  outcome: InventoryLotReceiveOutcomeSchema,
  lot_id: UuidSchema.nullable(),
  /** Existencia total de la presentación tras el movimiento. */
  quantity_after: NonNegativeScale6Schema.nullable(),
  /** Existencia **de este lote**, que es lo que se consume por FEFO. */
  lot_quantity_on_hand: NonNegativeScale6Schema.nullable(),
});

export const InventoryLotReceiveResponseSchema =
  createResponseEnvelopeSchema(InventoryLotReceiveResultSchema);

/**
 * Estado de vencimiento **derivado**, nunca almacenado (`UC-INVENTORY-002`
 * §Vencimientos, regla 4: el vencimiento no elimina el lote).
 *
 * **`NEAR_EXPIRY` no está aquí, y su ausencia es deliberada.** El caso de uso
 * lo lista como estado conceptual, pero «próximo a vencer» exige un umbral
 * —¿tres días, siete, treinta?— que es **política versionada y nadie la ha
 * decidido**. Elegir un número aquí sería inventar la política en el contrato,
 * que es donde más cuesta corregirla. `VALID` y `EXPIRED` se derivan de la
 * fecha del negocio sin decidir nada.
 */
export const LotExpiryStateSchema = z.enum(["NO_EXPIRY", "VALID", "EXPIRED"]);

export const InventoryLotListRequestSchema = createRequestEnvelopeSchema(
  z.strictObject({
    presentation_id: UuidSchema,
    business_date: BusinessDateSchema,
  }),
).safeExtend({ message_type: z.literal("inventory.lot.list") })
  .superRefine(forbidCallerAssertedIdentity);

export const InventoryLotListResultSchema = z.strictObject({
  outcome: z.enum(["LISTED", "UNAUTHORIZED", "PRESENTATION_NOT_FOUND"]),
  /**
   * En **orden FEFO**: primero lo que vence antes. Los lotes sin vencimiento
   * van al final, porque no compiten por salir primero. El orden lo decide el
   * servicio y no la pantalla: si cada llamador ordenara a su gusto, dos
   * pantallas mostrarían dos «siguiente lote» distintos.
   */
  lots: z.array(z.strictObject({
    lot_id: UuidSchema,
    lot_code: z.string().min(1).max(64),
    received_date: BusinessDateSchema,
    expiry_date: BusinessDateSchema.nullable(),
    quantity_on_hand: NonNegativeScale6Schema,
    status: z.enum(["ACTIVE", "BLOCKED", "CONSUMED"]),
    expiry_state: LotExpiryStateSchema,
  })).max(500),
});

export const InventoryLotListResponseSchema =
  createResponseEnvelopeSchema(InventoryLotListResultSchema);

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
  "payment.register.cash",
  "payment.register.transfer",
  "payment.register.qr",
  "payment.transfer.confirm",
  "payment.cancel",
  "payment.get",
  "customer.register",
  "customer.get",
  "customer.find",
  "catalog.product.register",
  "catalog.fiscal.attribute.set",
  "catalog.presentation.add",
  "catalog.conversion.declare",
  "inventory.conversion.apply",
  "catalog.item.find",
  "catalog.item.get",
  "catalog.item.import",
  "inventory.stock.receive",
  "inventory.stock.adjust",
  "inventory.stock.get",
  "inventory.lot.receive",
  "inventory.lot.list",
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
  "pos:payment.register.qr",
  "pos:payment.transfer.confirm",
  "pos:payment.cancel",
  "pos:payment.get",
  "pos:customer.register",
  "pos:customer.get",
  "pos:customer.find",
  "pos:catalog.product.register",
  "pos:catalog.fiscal.attribute.set",
  "pos:catalog.presentation.add",
  "pos:catalog.conversion.declare",
  "pos:inventory.conversion.apply",
  "pos:catalog.item.find",
  "pos:catalog.item.get",
  "pos:catalog.item.import",
  "pos:inventory.stock.receive",
  "pos:inventory.stock.adjust",
  "pos:inventory.stock.get",
  "pos:inventory.lot.receive",
  "pos:inventory.lot.list",
] as const;

export type CommercialIpcMessageType = z.infer<typeof CommercialIpcMessageTypeSchema>;
export type SessionActivateResult = z.infer<typeof SessionActivateResultSchema>;
export type SessionRecoverResult = z.infer<typeof SessionRecoverResultSchema>;
export type CashShiftOpenResult = z.infer<typeof CashShiftOpenResultSchema>;
export type CashShiftCloseResult = z.infer<typeof CashShiftCloseResultSchema>;
export type SaleCreateResult = z.infer<typeof SaleCreateResultSchema>;
export type PaymentRegisterCashResult = z.infer<typeof PaymentRegisterCashResultSchema>;
export type PaymentRegisterTransferResult = z.infer<typeof PaymentRegisterTransferResultSchema>;
export type PaymentRegisterQrResult = z.infer<typeof PaymentRegisterQrResultSchema>;
export type PaymentTransferConfirmResult = z.infer<typeof PaymentTransferConfirmResultSchema>;
export type PaymentCancelResult = z.infer<typeof PaymentCancelResultSchema>;
export type PaymentGetResult = z.infer<typeof PaymentGetResultSchema>;
// Crédito de cliente (`DEC-005`). Los esquemas existían desde `CUST-002`; los
// tipos inferidos faltaban, y sin ellos el renderer no podía leer un resultado
// de crédito sin declararlo a mano.
export type CreditAccountOpenResult = z.infer<typeof CreditAccountOpenResultSchema>;
export type CreditAccountGetResult = z.infer<typeof CreditAccountGetResultSchema>;
export type PaymentRegisterCreditResult = z.infer<typeof PaymentRegisterCreditResultSchema>;
export type CreditPaymentRegisterResult = z.infer<typeof CreditPaymentRegisterResultSchema>;
export type CatalogFiscalAttributeSetResult = z.infer<typeof CatalogFiscalAttributeSetResultSchema>;
export type CustomerRegisterResult = z.infer<typeof CustomerRegisterResultSchema>;
export type CustomerReadResult = z.infer<typeof CustomerReadResultSchema>;
export type CustomerFinding = z.infer<typeof CustomerFindingSchema>;
export type FiscalDocumentIssueResult = z.infer<typeof FiscalDocumentIssueResultSchema>;
export type FiscalDocumentIssueReason = z.infer<typeof FiscalDocumentIssueReasonSchema>;
export type CatalogProductRegisterResult = z.infer<typeof CatalogProductRegisterResultSchema>;
export type CatalogItemResult = z.infer<typeof CatalogItemResultSchema>;
export type SalesReceiptGetResult = z.infer<typeof SalesReceiptGetResultSchema>;
export type ReceiptLine = z.infer<typeof ReceiptLineSchema>;
export type ReceiptPayment = z.infer<typeof ReceiptPaymentSchema>;
export type InventoryMovementResult = z.infer<typeof InventoryMovementResultSchema>;
export type CatalogImportItem = z.infer<typeof CatalogImportItemSchema>;
export type CatalogItemImportResult = z.infer<typeof CatalogItemImportResultSchema>;
export type InventoryLotReceiveResult = z.infer<typeof InventoryLotReceiveResultSchema>;
export type InventoryLotListResult = z.infer<typeof InventoryLotListResultSchema>;
export type LotExpiryState = z.infer<typeof LotExpiryStateSchema>;
export type InventoryStockGetResult = z.infer<typeof InventoryStockGetResultSchema>;
