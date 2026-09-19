import type { LocalDatabase } from "@pos-platform/database-sqlite";
import { canonicalJson } from "../channel/canonical-json.js";
import type { DurableSyncStore, SyncScope } from "../sync/durable-sync-store.js";
import type { CashPort } from "./cash-port.js";
import type { InventoryPort } from "./inventory-port.js";
import type { CreditPort } from "./credit-port.js";
import { bigIntToScale6, scale6ToBigInt } from "../money.js";
import { firstQueryAt } from "./uncertain-payment-sweep-policy.js";

/**
 * Persistencia de Payment V1 — `DEC-016`.
 *
 * Este almacén sostiene la decisión central del bloque: **la venta se completa
 * dentro de la misma transacción que confirma el pago que hace suficiente la
 * cobertura** (`DEC-016` §5.2). No existe una operación de completion separada,
 * de modo que el estado «pago confirmado, venta sin completar» es inexpresable.
 *
 * Dos invariantes gobiernan todo lo demás:
 *
 * 1. **La cobertura se recomputa desde `payments_payment_allocations` dentro de
 *    la transacción** (§5.5). Nunca se toma de la petición, de una caché ni de
 *    una proyección leída fuera.
 * 2. **Payments no escribe caja.** El asiento va por `CashPort` (§10), que es
 *    quien asigna `shift_sequence`.
 */

const PAYMENT_PAYLOAD_SCHEMA_VERSION = "1.0.0";

/** Estados de venta desde los que V1 admite recibir pago. */
const PAYABLE_SALE_STATUSES = new Set(["READY_FOR_PAYMENT", "PAYMENT_IN_PROGRESS"]);

export type PaymentMethod = "CASH" | "TRANSFER" | "QR" | "CUSTOMER_CREDIT";

interface SaleRow {
  status: string;
  currency_code: string;
  payable_amount: string;
  cash_shift_id: string | null;
  customer_id: string | null;
  version: number;
}

interface PaymentRow {
  id: string;
  payment_group_id: string;
  payment_method: string;
  status: string;
  expected_amount: string;
  confirmed_amount: string;
  currency_code: string;
  collection_subject_id: string;
  version: number;
  request_checksum: string;
}

interface NextSequenceRow { next_sequence: number }

/**
 * Rechazo que ocurre **después** de haber escrito dentro de la transacción.
 *
 * `better-sqlite3` confirma la transacción cuando la función retorna y sólo la
 * revierte cuando lanza. Un `return` de rechazo posterior a un `INSERT` dejaría
 * el pago persistido pese a haberse rechazado — exactamente el defecto que la
 * prueba «un turno cerrado rechaza el pago y no deja rastro» detecta.
 *
 * Regla para futuras ediciones: **valida antes de escribir; si un rechazo sólo
 * puede conocerse después de escribir, lánzalo por aquí, nunca lo retornes.**
 */
class PaymentRollback<T> extends Error {
  constructor(readonly outcome: T) {
    super("payment rejected after write; transaction rolled back");
  }
}

function runWithRollback<T>(transaction: () => T): T {
  try {
    return transaction();
  } catch (error) {
    if (error instanceof PaymentRollback) return error.outcome as T;
    throw error;
  }
}

// ── Entradas ──────────────────────────────────────────────────────────────────

interface CommonInput {
  readonly scope: SyncScope;
  readonly sessionId: string;
  readonly operatorUserId: string;
  readonly auditActorType?: "USER" | "SYSTEM";
  readonly auditActorId?: string | null;
  readonly idempotencyKey: string;
  readonly requestChecksum: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

export interface RegisterPaymentInput extends CommonInput {
  readonly saleId: string;
  /** Identidad del movimiento del libro de crédito. Sólo `CUSTOMER_CREDIT`. */
  readonly creditTransactionId?: string;
  readonly amount: string;
  readonly method: PaymentMethod;
  /** Sólo efectivo, forense (`DEC-016` §10.5). */
  readonly tenderedAmount: string | null;
  readonly changeAmount: string | null;
  /** Sólo transferencia: metadato de atestiguación, nunca autoridad. */
  readonly providerCode: string | null;
  readonly providerReference: string | null;
  readonly groupId: string;
  readonly paymentId: string;
  readonly attemptId: string;
  readonly allocationId: string;
  readonly movementId: string;
  readonly operationId: string;
  readonly saleCompletionOperationId: string;
}

export interface ConfirmTransferInput extends CommonInput {
  readonly paymentId: string;
  readonly expectedVersion: number;
  readonly allocationId: string;
  readonly attemptId: string;
  readonly operationId: string;
  readonly saleCompletionOperationId: string;
}

export interface ConfirmProviderPaymentInput extends CommonInput {
  readonly paymentId: string;
  readonly expectedVersion: number;
  readonly providerCode: string;
  readonly providerReference: string;
  readonly providerTransactionId: string;
  readonly amount: string;
  readonly currencyCode: "COP";
  readonly receivedAt: string;
  readonly payerReference: string | null;
  readonly allocationId: string;
  readonly operationId: string;
  readonly saleCompletionOperationId: string;
}

export interface CancelPaymentInput extends CommonInput {
  readonly paymentId: string;
  readonly expectedVersion: number;
  readonly operationId: string;
}

/**
 * Razones por las que una consulta al proveedor no pudo determinar el
 * resultado. Es el mismo conjunto cerrado que `PaymentProviderUncertainty`
 * declara en el puerto; la columna lo repite como `CHECK` para que la fila
 * tampoco pueda guardar una que el contrato no conozca.
 */
export type ProviderUncertaintyReason =
  | "TIMEOUT"
  | "NETWORK"
  | "PROVIDER_UNAVAILABLE"
  | "MALFORMED_RESPONSE"
  | "PROVIDER_ERROR";

export interface RecordProviderUncertaintyInput extends CommonInput {
  readonly paymentId: string;
  readonly reason: ProviderUncertaintyReason;
  readonly observedAt: string;
  readonly operationId: string;
}

export type RecordProviderUncertaintyOutcome =
  | { readonly kind: "RECORDED"; readonly paymentId: string; readonly attemptId: string }
  | { readonly kind: "IDEMPOTENT"; readonly paymentId: string }
  | { readonly kind: "IDEMPOTENCY_CONFLICT" }
  | { readonly kind: "PAYMENT_NOT_FOUND" }
  | { readonly kind: "ATTEMPT_NOT_UNCERTAINABLE" };

export interface DeclineUncertainPaymentInput extends CommonInput {
  readonly paymentId: string;
  readonly providerCode: string;
  readonly providerTransactionId: string;
  readonly receivedAt: string;
  readonly operationId: string;
}

export type DeclineUncertainPaymentOutcome =
  | { readonly kind: "DECLINED"; readonly paymentId: string; readonly attemptId: string }
  | { readonly kind: "IDEMPOTENT"; readonly paymentId: string }
  | { readonly kind: "IDEMPOTENCY_CONFLICT" }
  | { readonly kind: "PAYMENT_NOT_FOUND" }
  | { readonly kind: "ATTEMPT_NOT_RESOLVABLE" }
  | { readonly kind: "PROVIDER_MISMATCH" }
  | { readonly kind: "PROVIDER_TRANSACTION_CONFLICT" };

export interface PaymentView {
  readonly paymentId: string;
  readonly saleId: string;
  readonly method: string;
  readonly status: string;
  readonly expectedAmount: string;
  readonly confirmedAmount: string;
  readonly currencyCode: string;
  readonly version: number;
}

// ── Resultados ────────────────────────────────────────────────────────────────

/**
 * La venta no se puede completar porque no hay existencia que sacar.
 *
 * Es un rechazo **posterior a escribir**: se conoce al descontar, dentro de la
 * misma transacción que ya imputó el pago, así que viaja por `PaymentRollback`
 * y deja la transacción revertida. El cajero ve el rechazo **antes** de que el
 * dinero quede tomado, que es la única forma honesta de fallar aquí.
 */
export interface InsufficientStockOutcome {
  readonly kind: "INSUFFICIENT_STOCK";
  readonly presentationId: string;
  readonly available: string;
}

export type RegisterPaymentOutcome =
  | {
      readonly kind: "CONFIRMED";
      readonly paymentId: string;
      readonly saleCompleted: boolean;
      readonly confirmedCoverage: string;
      readonly payableAmount: string;
    }
  | { readonly kind: "REGISTERED"; readonly paymentId: string }
  | { readonly kind: "IDEMPOTENT"; readonly paymentId: string }
  | { readonly kind: "IDEMPOTENCY_CONFLICT" }
  | { readonly kind: "SALE_NOT_FOUND" }
  | { readonly kind: "SALE_NOT_PAYABLE" }
  | { readonly kind: "SALE_ALREADY_COMPLETED" }
  | { readonly kind: "CURRENCY_MISMATCH" }
  | { readonly kind: "OVERPAYMENT_NOT_ALLOWED" }
  | { readonly kind: "CASH_SHIFT_MISSING" }
  | { readonly kind: "CASH_SHIFT_NOT_OPEN" }
  | { readonly kind: "PROVIDER_REFERENCE_REQUIRED" }
  /** La venta no nombra adquiriente: `DEC-002` §159 lo exige para fiar. */
  | { readonly kind: "CUSTOMER_REQUIRED" }
  | { readonly kind: "CREDIT_ACCOUNT_NOT_FOUND" }
  | { readonly kind: "CREDIT_LIMIT_EXCEEDED"; readonly availableCredit: string }
  /** El despliegue no tiene crédito cableado. */
  | { readonly kind: "CREDIT_NOT_AVAILABLE" }
  | InsufficientStockOutcome;

export type ConfirmTransferOutcome =
  | {
      readonly kind: "CONFIRMED";
      readonly paymentId: string;
      readonly saleCompleted: boolean;
      readonly confirmedCoverage: string;
      readonly payableAmount: string;
    }
  | { readonly kind: "IDEMPOTENT"; readonly paymentId: string }
  | { readonly kind: "IDEMPOTENCY_CONFLICT" }
  | { readonly kind: "PAYMENT_NOT_FOUND" }
  | { readonly kind: "PAYMENT_NOT_CONFIRMABLE" }
  | { readonly kind: "VERSION_CONFLICT" }
  | { readonly kind: "OVERPAYMENT_NOT_ALLOWED" }
  | { readonly kind: "SALE_ALREADY_COMPLETED" }
  | InsufficientStockOutcome;

export type ConfirmProviderPaymentOutcome = ConfirmTransferOutcome
  | { readonly kind: "PROVIDER_MISMATCH" }
  | { readonly kind: "PROVIDER_TRANSACTION_CONFLICT" }
  | { readonly kind: "AMOUNT_MISMATCH" }
  | { readonly kind: "CURRENCY_MISMATCH" }
  | { readonly kind: "EVIDENCE_NOT_AUTHORIZED" };

export type CancelPaymentOutcome =
  | { readonly kind: "CANCELLED"; readonly paymentId: string }
  | { readonly kind: "IDEMPOTENT"; readonly paymentId: string }
  | { readonly kind: "IDEMPOTENCY_CONFLICT" }
  | { readonly kind: "PAYMENT_NOT_FOUND" }
  | { readonly kind: "PAYMENT_NOT_CANCELLABLE" }
  | { readonly kind: "VERSION_CONFLICT" };

/**
 * Lo que hace falta para volver a preguntarle al proveedor por un intento
 * incierto: su identidad ante el proveedor y la versión del pago que la
 * resolución tendrá que afirmar.
 */
export interface UncertainProviderAttemptView {
  readonly paymentId: string;
  readonly paymentVersion: number;
  readonly attemptId: string;
  readonly providerCode: string | null;
  /** `null` mientras el proveedor no haya entregado ninguno. */
  readonly providerTransactionId: string | null;
  readonly uncertaintyReason: string | null;
}

export type UncertainProviderAttemptOutcome =
  | { readonly kind: "FOUND"; readonly attempt: UncertainProviderAttemptView }
  | { readonly kind: "PAYMENT_NOT_FOUND" }
  | { readonly kind: "ATTEMPT_NOT_UNCERTAIN" };

/**
 * Un intento `UNKNOWN` que el barrido puede consultar ahora.
 *
 * Trae todo lo que hace falta para preguntar y para resolver sin volver a
 * leer: la identidad ante el proveedor, la versión del intento —que es con lo
 * que se reclama— y la del pago —que es lo que la resolución tendrá que
 * afirmar—.
 */
export interface UncertainProviderSweepCandidate {
  readonly attemptId: string;
  readonly attemptVersion: number;
  readonly attemptCount: number;
  readonly paymentId: string;
  readonly paymentVersion: number;
  readonly providerCode: string;
  readonly providerTransactionId: string;
  /** `provider_uncertainty_observed_at`: origen de la ventana (`D-5`). */
  readonly observedAt: string;
  readonly nextAttemptAt: string;
}

/** Lo que el proveedor contestó a una consulta del barrido. */
export type UncertainProviderQueryResult =
  | "APPROVED"
  | "REJECTED"
  | "PENDING"
  | "UNKNOWN";

export interface RecordUncertainProviderQueryInput extends CommonInput {
  readonly paymentId: string;
  readonly attemptId: string;
  /** Número de esta consulta: `attempt_count` tras reclamarla. */
  readonly attemptNumber: number;
  readonly result: UncertainProviderQueryResult;
  /** Sólo cuando `result` es `UNKNOWN`. */
  readonly uncertaintyReason: ProviderUncertaintyReason | null;
  /** `null` cuando no habrá otra consulta automática. */
  readonly nextAttemptAt: string | null;
  readonly operationId: string;
}

export type RecordUncertainProviderQueryOutcome =
  | { readonly kind: "RECORDED"; readonly paymentId: string; readonly attemptId: string }
  | { readonly kind: "IDEMPOTENT"; readonly paymentId: string }
  | { readonly kind: "IDEMPOTENCY_CONFLICT" }
  | { readonly kind: "PAYMENT_NOT_FOUND" }
  | { readonly kind: "ATTEMPT_NOT_UNCERTAIN" };

/** Por qué terminó la resolución automática (`D-6`). */
export type UncertainResolutionAbandonReason =
  /** Se agotaron los ocho minutos contados desde la incertidumbre. */
  | "WINDOW_EXHAUSTED"
  /** Se gastaron las seis consultas que `D-5` autoriza. */
  | "QUERY_BUDGET_EXHAUSTED";

export interface AbandonUncertainResolutionInput extends CommonInput {
  readonly paymentId: string;
  readonly attemptId: string;
  readonly reason: UncertainResolutionAbandonReason;
  readonly operationId: string;
}

export type AbandonUncertainResolutionOutcome =
  | { readonly kind: "REVIEW_REQUIRED"; readonly paymentId: string; readonly attemptId: string }
  | { readonly kind: "IDEMPOTENT"; readonly paymentId: string }
  | { readonly kind: "IDEMPOTENCY_CONFLICT" }
  | { readonly kind: "PAYMENT_NOT_FOUND" }
  | { readonly kind: "ATTEMPT_NOT_UNCERTAIN" };

export type GetPaymentOutcome =
  | { readonly kind: "FOUND"; readonly payment: PaymentView }
  | { readonly kind: "NOT_FOUND" };

// ── Store ─────────────────────────────────────────────────────────────────────

export class SqlitePaymentStore {
  constructor(
    private readonly database: LocalDatabase,
    private readonly durableSync: DurableSyncStore,
    private readonly cashPort: CashPort,
    private readonly inventoryPort: InventoryPort,
    private readonly now: () => Date = () => new Date(),
    /**
     * Sólo hace falta para `CUSTOMER_CREDIT`. Sin él, registrar una venta a
     * crédito devuelve `CREDIT_NOT_AVAILABLE` en vez de fallar: un despliegue
     * que no fía sigue cobrando efectivo, transferencia y QR exactamente igual.
     */
    private readonly creditPort?: CreditPort,
  ) {}

  // ── Lecturas ────────────────────────────────────────────────────────────────

  get(scope: SyncScope, paymentId: string): GetPaymentOutcome {
    const row = this.database.native.prepare(
      `SELECT p.id, p.payment_method, p.status, p.expected_amount, p.confirmed_amount,
              p.currency_code, p.version, g.collection_subject_id
       FROM payments_payments p
       JOIN payments_payment_groups g ON g.tenant_id = p.tenant_id AND g.id = p.payment_group_id
       WHERE p.tenant_id=? AND p.id=?`,
    ).get(scope.tenantId, paymentId) as
      | {
          id: string; payment_method: string; status: string; expected_amount: string;
          confirmed_amount: string; currency_code: string; version: number;
          collection_subject_id: string;
        }
      | undefined;

    if (row === undefined) return { kind: "NOT_FOUND" };
    return {
      kind: "FOUND",
      payment: {
        paymentId: row.id,
        saleId: row.collection_subject_id,
        method: row.payment_method,
        status: row.status,
        expectedAmount: row.expected_amount,
        confirmedAmount: row.confirmed_amount,
        currencyCode: row.currency_code,
        version: row.version,
      },
    };
  }

  /**
   * Cobertura confirmada de una venta, leída **exclusivamente** de las
   * imputaciones. Es la única fuente admisible (`DEC-016` §5.5).
   */
  private confirmedCoverage(tenantId: string, saleId: string): bigint {
    const rows = this.database.native.prepare(
      `SELECT amount FROM payments_payment_allocations
       WHERE tenant_id=? AND collection_subject_type='SALE' AND collection_subject_id=?`,
    ).all(tenantId, saleId) as Array<{ amount: string }>;

    return rows.reduce((total, row) => total + scale6ToBigInt(row.amount), 0n);
  }

  private loadSale(tenantId: string, saleId: string): SaleRow | undefined {
    return this.database.native.prepare(
      `SELECT status, currency_code, payable_amount, cash_shift_id, customer_id, version
       FROM sales_sales WHERE tenant_id=? AND id=?`,
    ).get(tenantId, saleId) as SaleRow | undefined;
  }

  // ── Escrituras auxiliares ───────────────────────────────────────────────────

  /**
   * Idempotencia canónica de una operación Payment — `runtime_operations`.
   *
   * `runtime_operations.idempotency_key` es UNIQUE y guarda el checksum del
   * payload, de modo que es el registro que decide si una operación ya ocurrió.
   * La fila del pago **no** sirve para esto: pertenece al agregado, no a la
   * operación, y reutilizarla obligaría a sobrescribir la clave del registro
   * cada vez que llega una operación posterior (defecto `D-1`).
   *
   * Se consulta **antes de escribir**: dejar que salte la restricción UNIQUE
   * convertiría una repetición legítima en una excepción no controlada que el
   * canal IPC traduce en destrucción del socket (defecto `D-2`).
   */
  private operationIdempotency(idempotencyKey: string, checksum: string): "NEW" | "REPLAY" | "CONFLICT" {
    const row = this.database.native.prepare(
      "SELECT payload_checksum FROM runtime_operations WHERE idempotency_key=?",
    ).get(idempotencyKey) as { payload_checksum: string } | undefined;

    if (row === undefined) return "NEW";
    return row.payload_checksum === checksum ? "REPLAY" : "CONFLICT";
  }

  private insertOperation(operationId: string, idempotencyKey: string, checksum: string, resultCode: string, nowIso: string): void {
    this.database.native.prepare(
      `INSERT INTO runtime_operations(operation_id, idempotency_key, payload_checksum, status, result_code, created_at, updated_at)
       VALUES (?,?,?,'SUCCEEDED',?,?,?)`,
    ).run(operationId, idempotencyKey, checksum, resultCode, nowIso, nowIso);
  }

  private writeAudit(
    input: CommonInput,
    actionCode: string,
    resourceType: string,
    resourceId: string,
    details: Record<string, unknown>,
    nowIso: string,
  ): void {
    this.database.native.prepare(
      `INSERT INTO local_operation_audit(
        tenant_id, company_id, branch_id, device_id,
        actor_type, actor_id, session_id,
        action_code, resource_type, resource_id,
        correlation_id, causation_id, reason_code, details_json, created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?)`,
    ).run(
      input.scope.tenantId, input.scope.companyId, input.scope.branchId, input.scope.deviceId,
      input.auditActorType ?? "USER", input.auditActorId ?? input.operatorUserId, input.sessionId,
      actionCode, resourceType, resourceId,
      input.correlationId, input.causationId,
      canonicalJson(details), nowIso,
    );
  }

  private enqueue(
    input: CommonInput,
    operationId: string,
    idempotencyKey: string,
    aggregateType: string,
    aggregateId: string,
    operationType: string,
    payload: Record<string, unknown>,
    checksum: string,
    nowIso: string,
  ): void {
    const nextSequence = (this.database.native.prepare(
      `SELECT COALESCE(MAX(local_sequence), 0) + 1 AS next_sequence FROM local_sync_outbox
       WHERE tenant_id=? AND company_id=? AND branch_id=? AND device_id=? AND installation_id=?`,
    ).get(
      input.scope.tenantId, input.scope.companyId, input.scope.branchId,
      input.scope.deviceId, input.scope.installationId,
    ) as NextSequenceRow).next_sequence;

    this.durableSync.enqueue({
      operation_id: operationId,
      tenant_id: input.scope.tenantId,
      company_id: input.scope.companyId,
      branch_id: input.scope.branchId,
      device_id: input.scope.deviceId,
      installation_id: input.scope.installationId,
      session_id: input.sessionId,
      actor_id: input.operatorUserId,
      aggregate_type: aggregateType,
      aggregate_id: aggregateId,
      operation_type: operationType,
      authority_policy: "LOCAL_AUTHORITATIVE_UNTIL_SYNC",
      local_sequence: nextSequence,
      idempotency_key: idempotencyKey,
      expected_version: null,
      payload_schema_version: PAYMENT_PAYLOAD_SCHEMA_VERSION,
      payload,
      payload_checksum: checksum,
      causation_id: input.causationId,
      correlation_id: input.correlationId,
      occurred_at_local: nowIso,
      recorded_at_local: nowIso,
    });
  }

  /**
   * Mueve la venta a `PAYMENT_IN_PROGRESS` si aún está `READY_FOR_PAYMENT`, y
   * devuelve la versión vigente tras la transición.
   */
  private beginPaymentOnSale(tenantId: string, saleId: string, sale: SaleRow): number {
    if (sale.status !== "READY_FOR_PAYMENT") return sale.version;

    this.database.native.prepare(
      `UPDATE sales_sales SET status='PAYMENT_IN_PROGRESS', version=version+1
       WHERE tenant_id=? AND id=? AND version=?`,
    ).run(tenantId, saleId, sale.version);

    return sale.version + 1;
  }

  /**
   * Completa la venta si la cobertura recomputada la cubre.
   *
   * Es el único punto del sistema que produce `COMPLETED`, y sólo puede
   * ejecutarse dentro de la transacción que acaba de imputar el pago.
   */
  private completeSaleIfCovered(
    input: CommonInput,
    saleId: string,
    payableAmount: string,
    saleVersion: number,
    completionOperationId: string,
    nowIso: string,
  ): { completed: boolean; coverage: bigint } {
    const coverage = this.confirmedCoverage(input.scope.tenantId, saleId);
    if (coverage < scale6ToBigInt(payableAmount)) return { completed: false, coverage };

    // La mercancía sale **antes** de marcar COMPLETED y dentro de esta misma
    // transacción: una venta cobrada cuya existencia sigue en la estantería es
    // el descuadre que el inventario existe para impedir.
    this.deductSoldStock(input, saleId);

    const completionKey = `sale_completion:${input.idempotencyKey}`;
    this.insertOperation(completionOperationId, completionKey, input.requestChecksum, "SALE_COMPLETED", nowIso);

    this.database.native.prepare(
      `UPDATE sales_sales SET status='COMPLETED', completed_at=?, version=version+1
       WHERE tenant_id=? AND id=? AND version=?`,
    ).run(nowIso, input.scope.tenantId, saleId, saleVersion);

    const details = { coverage_amount: bigIntToScale6(coverage), payable_amount: payableAmount, sale_id: saleId };
    this.writeAudit(input, "SALE_COMPLETED", "SALE", saleId, details, nowIso);
    this.enqueue(
      input, completionOperationId, completionKey,
      "SALE", saleId, "SALE_COMPLETED", details, input.requestChecksum, nowIso,
    );

    return { completed: true, coverage };
  }

  /**
   * Da salida a lo vendido, sólo de los productos con control de existencia.
   *
   * Agrupa por presentación: la misma presentación puede estar en dos líneas de
   * la misma venta y el libro debe registrar una salida por presentación, no una
   * por línea. `SUM` se hace en SQLite sobre TEXT de escala 6, así que la suma
   * se recompone aquí con la aritmética entera del proyecto.
   */
  private deductSoldStock(input: CommonInput, saleId: string): void {
    const lines = this.database.native.prepare(
      `SELECT i.presentation_id, i.quantity
       FROM sales_sale_items i
       JOIN catalog_product p ON p.tenant_id = i.tenant_id AND p.id = i.product_id
       WHERE i.tenant_id=? AND i.sale_id=? AND p.stock_controlled = 1
       ORDER BY i.line_number`,
    ).all(input.scope.tenantId, saleId) as Array<{ presentation_id: string; quantity: string }>;

    if (lines.length === 0) return;

    const byPresentation = new Map<string, bigint>();
    for (const line of lines) {
      const accumulated = byPresentation.get(line.presentation_id) ?? 0n;
      byPresentation.set(line.presentation_id, accumulated + scale6ToBigInt(line.quantity));
    }

    const businessDate = this.saleBusinessDate(input.scope.tenantId, saleId);

    for (const [presentationId, units] of byPresentation) {
      const outcome = this.inventoryPort.appendSaleDeduction({
        scope: input.scope,
        sessionId: input.sessionId,
        operatorUserId: input.operatorUserId,
        saleId,
        presentationId,
        quantity: bigIntToScale6(units),
        businessDate,
        correlationId: input.correlationId,
        causationId: input.causationId,
      });

      if (outcome.kind === "INSUFFICIENT_STOCK") {
        throw new PaymentRollback<InsufficientStockOutcome>({
          kind: "INSUFFICIENT_STOCK",
          presentationId,
          available: outcome.available,
        });
      }
    }
  }

  /** Localiza o crea el grupo de cobro del sujeto. La unicidad la impone el índice. */
  private ensureGroup(input: RegisterPaymentInput, sale: SaleRow, nowIso: string): string {
    const existing = this.database.native.prepare(
      `SELECT id FROM payments_payment_groups
       WHERE tenant_id=? AND branch_id=? AND collection_subject_type='SALE' AND collection_subject_id=?`,
    ).get(input.scope.tenantId, input.scope.branchId, input.saleId) as { id: string } | undefined;

    if (existing) return existing.id;

    this.database.native.prepare(
      `INSERT INTO payments_payment_groups(
        id, tenant_id, company_id, branch_id,
        collection_subject_type, collection_subject_id,
        currency_code, expected_payable_amount,
        idempotency_key, request_checksum, correlation_id, causation_id, created_at
      ) VALUES (?,?,?,?,'SALE',?,?,?,?,?,?,?,?)`,
    ).run(
      input.groupId, input.scope.tenantId, input.scope.companyId, input.scope.branchId,
      input.saleId, sale.currency_code, sale.payable_amount,
      input.idempotencyKey, input.requestChecksum, input.correlationId, input.causationId, nowIso,
    );

    return input.groupId;
  }

  findPaymentByIdempotency(scope: SyncScope, idempotencyKey: string, requestChecksum: string):
    | { kind: "NEW" }
    | { kind: "IDEMPOTENT"; paymentId: string }
    | { kind: "IDEMPOTENCY_CONFLICT" } {
    const row = this.database.native.prepare(
      `SELECT id, request_checksum FROM payments_payments
       WHERE tenant_id=? AND origin_device_id=? AND idempotency_key=?`,
    ).get(scope.tenantId, scope.deviceId, idempotencyKey) as
      | { id: string; request_checksum: string }
      | undefined;

    if (row === undefined) return { kind: "NEW" };
    return row.request_checksum === requestChecksum
      ? { kind: "IDEMPOTENT", paymentId: row.id }
      : { kind: "IDEMPOTENCY_CONFLICT" };
  }

  /** Contexto confiable para crear una intención de pago respaldada por proveedor. */
  getPaymentIntentContext(scope: SyncScope, saleId: string):
    | { kind: "FOUND"; cashRegisterId: string; currencyCode: string; payableAmount: string }
    | { kind: "NOT_FOUND" }
    | { kind: "SALE_NOT_PAYABLE" } {
    const sale = this.database.native.prepare(
      `SELECT status, cash_register_id, currency_code, payable_amount
       FROM sales_sales WHERE tenant_id=? AND id=?`,
    ).get(scope.tenantId, saleId) as
      | { status: string; cash_register_id: string | null; currency_code: string; payable_amount: string }
      | undefined;

    if (sale === undefined) return { kind: "NOT_FOUND" };
    if (!PAYABLE_SALE_STATUSES.has(sale.status)) return { kind: "SALE_NOT_PAYABLE" };
    if (sale.cash_register_id === null) return { kind: "NOT_FOUND" };

    return {
      kind: "FOUND",
      cashRegisterId: sale.cash_register_id,
      currencyCode: sale.currency_code,
      payableAmount: sale.payable_amount,
    };
  }

  // ── Registro ────────────────────────────────────────────────────────────────

  /**
   * Registra un pago.
   *
   * `CASH` es autoridad local: se confirma, imputa y asienta en caja en esta
   * misma transacción, y si con ello la cobertura queda completa, la venta se
   * completa aquí también.
   *
   * `TRANSFER` registrado sin confirmar queda en `CREATED` y no imputa: sin
   * imputación no hay cobertura, y sin cobertura no hay completion.
   */
  register(input: RegisterPaymentInput): RegisterPaymentOutcome {
    const nowIso = this.now().toISOString();

    return runWithRollback(this.database.native.transaction((): RegisterPaymentOutcome => {
      // 1. Idempotencia canónica: la operación, no el agregado.
      const operation = this.operationIdempotency(input.idempotencyKey, input.requestChecksum);
      if (operation === "CONFLICT") return { kind: "IDEMPOTENCY_CONFLICT" };

      if (operation === "REPLAY") {
        // La clave ya se consumió con el mismo checksum: se devuelve el pago que
        // produjo. La fila conserva su clave de registro para siempre (`D-1`).
        const existing = this.database.native.prepare(
          `SELECT id FROM payments_payments
           WHERE tenant_id=? AND origin_device_id=? AND idempotency_key=?`,
        ).get(input.scope.tenantId, input.scope.deviceId, input.idempotencyKey) as
          | { id: string } | undefined;

        // Sin fila de pago, la clave la consumió otra clase de operación con
        // idéntico checksum. Es indistinguible de una colisión: fail-closed.
        if (existing === undefined) return { kind: "IDEMPOTENCY_CONFLICT" };
        return { kind: "IDEMPOTENT", paymentId: existing.id };
      }

      // 2. Venta
      const sale = this.loadSale(input.scope.tenantId, input.saleId);
      if (sale === undefined) return { kind: "SALE_NOT_FOUND" };
      if (sale.status === "COMPLETED") return { kind: "SALE_ALREADY_COMPLETED" };
      if (!PAYABLE_SALE_STATUSES.has(sale.status)) return { kind: "SALE_NOT_PAYABLE" };

      // 3. Cobertura: el sobrepago se impide ANTES de confirmar (DEC-002).
      const amount = scale6ToBigInt(input.amount);
      const payable = scale6ToBigInt(sale.payable_amount);

      // `confirmsCoverage` y `settlesInCash` eran el mismo booleano hasta
      // `DEC-005`, porque el único medio que confirmaba en el acto era el
      // efectivo. Ya no: el crédito **confirma cobertura** —la venta se
      // completa y la mercancía sale— pero **no liquida en efectivo**, así que
      // ni exige turno ni asienta en caja (`DEC-002` §146 regla 10: la caja
      // sólo registra efectivo realmente recibido).
      const onCredit = input.method === "CUSTOMER_CREDIT";
      const settlesInCash = input.method === "CASH";
      const confirmsCoverage = settlesInCash || onCredit;
      const providerAuthoritative = input.method === "QR";

      if (providerAuthoritative && (input.providerCode === null || input.providerReference === null)) {
        return { kind: "PROVIDER_REFERENCE_REQUIRED" };
      }
      if (confirmsCoverage && this.confirmedCoverage(input.scope.tenantId, input.saleId) + amount > payable) {
        return { kind: "OVERPAYMENT_NOT_ALLOWED" };
      }

      // 4a. Efectivo: exige turno abierto ANTES de escribir nada.
      if (settlesInCash) {
        if (sale.cash_shift_id === null) return { kind: "CASH_SHIFT_MISSING" };
      }

      // 4b. Crédito: las condiciones de `DEC-002` §159, todas antes de escribir.
      //
      // El cupo se comprueba aquí dentro y con el saldo recomputado desde el
      // libro: entre leerlo fuera y escribir cabría otra venta a crédito del
      // mismo cliente, y el cupo es precisamente lo que no puede excederse.
      let creditAccountId: string | null = null;
      if (onCredit) {
        if (this.creditPort === undefined) return { kind: "CREDIT_NOT_AVAILABLE" };
        if (sale.customer_id === null) return { kind: "CUSTOMER_REQUIRED" };

        const account = this.creditPort.findAccountByCustomer(input.scope, sale.customer_id);
        if (account === null) return { kind: "CREDIT_ACCOUNT_NOT_FOUND" };
        if (account.currencyCode !== sale.currency_code) return { kind: "CURRENCY_MISMATCH" };

        const outstanding = this.creditPort.outstandingBalance(input.scope, account.accountId);
        const limit = scale6ToBigInt(account.creditLimit);
        if (outstanding + amount > limit) {
          return {
            kind: "CREDIT_LIMIT_EXCEEDED",
            availableCredit: bigIntToScale6(limit > outstanding ? limit - outstanding : 0n),
          };
        }
        creditAccountId = account.accountId;
      }

      const group = this.ensureGroup(input, sale, nowIso);
      const status = confirmsCoverage ? "CONFIRMED" : providerAuthoritative ? "PENDING" : "CREATED";
      const resultCode = confirmsCoverage ? "PAYMENT_CONFIRMED" : "PAYMENT_REGISTERED";
      // `MANUAL_ATTESTATION` y no un valor nuevo: el `CHECK` vive en dos tablas
      // con hijas y SQLite no amplía un `CHECK` sin reconstruirlas, mientras
      // que **nadie lee** esta columna —sólo se escribe— y `payment_method` ya
      // distingue el crédito sin ambigüedad. Un usuario con permiso de crédito
      // que acepta una obligación es exactamente una atestación manual.
      const authority = settlesInCash
        ? "LOCAL_DEVICE"
        : providerAuthoritative ? "EXTERNAL_PROVIDER_AUTHORITATIVE" : "MANUAL_ATTESTATION";

      this.insertOperation(input.operationId, input.idempotencyKey, input.requestChecksum, resultCode, nowIso);

      this.database.native.prepare(
        `INSERT INTO payments_payments(
          id, tenant_id, company_id, branch_id, payment_group_id,
          payment_method, authority_type, status,
          expected_amount, confirmed_amount, tendered_amount, change_amount, currency_code,
          origin_device_id, installation_id,
          operator_actor_type, operator_actor_id,
          confirmed_by_actor_type, confirmed_by_actor_id,
          provider_code, provider_reference,
          operation_id, idempotency_key, request_checksum, correlation_id, causation_id,
          version, created_at, confirmed_at, cancelled_at, server_recorded_at
        ) VALUES (
          ?,?,?,?,?,
          ?,?,?,
          ?,?,?,?,?,
          ?,?,
          'USER',?,
          ?,?,
          ?,?,
          ?,?,?,?,?,
          1,?,?,NULL,NULL
        )`,
      ).run(
        input.paymentId, input.scope.tenantId, input.scope.companyId, input.scope.branchId, group,
        input.method, authority, status,
        input.amount, confirmsCoverage ? input.amount : "0.000000",
        input.tenderedAmount, input.changeAmount, sale.currency_code,
        input.scope.deviceId, input.scope.installationId,
        input.operatorUserId,
        confirmsCoverage ? "USER" : null, confirmsCoverage ? input.operatorUserId : null,
        input.providerCode, input.providerReference,
        input.operationId, input.idempotencyKey, input.requestChecksum, input.correlationId, input.causationId,
        nowIso, confirmsCoverage ? nowIso : null,
      );

      this.database.native.prepare(
        `INSERT INTO payments_payment_attempts(
          id, tenant_id, company_id, branch_id, payment_id, attempt_number,
          payment_method, authority_type, status, amount, currency_code,
          provider_code, provider_reference_type, provider_reference,
          manual_confirmation_actor_id, error_code,
          idempotency_key, request_checksum, correlation_id, causation_id,
          version, initiated_at, provider_reported_at, confirmed_at, server_recorded_at
        ) VALUES (?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,NULL,?,?,?,?,1,?,NULL,?,NULL)`,
      ).run(
        input.attemptId, input.scope.tenantId, input.scope.companyId, input.scope.branchId,
        input.paymentId,
        input.method, authority, status,
        input.amount, sale.currency_code,
        input.providerCode,
        input.providerReference === null ? null : providerAuthoritative ? "PROVIDER_INTENT" : "MANUAL_REFERENCE",
        input.providerReference,
        confirmsCoverage ? input.operatorUserId : null,
        `attempt:${input.idempotencyKey}`, input.requestChecksum, input.correlationId, input.causationId,
        nowIso, confirmsCoverage ? nowIso : null,
      );

      const saleVersion = this.beginPaymentOnSale(input.scope.tenantId, input.saleId, sale);

      if (!confirmsCoverage) {
        const details = { amount: input.amount, method: input.method, payment_id: input.paymentId, sale_id: input.saleId };
        this.writeAudit(input, "PAYMENT_REGISTERED", "PAYMENT", input.paymentId, details, nowIso);
        this.enqueue(
          input, input.operationId, input.idempotencyKey,
          "PAYMENT", input.paymentId, "PAYMENT_REGISTERED", details, input.requestChecksum, nowIso,
        );
        return { kind: "REGISTERED", paymentId: input.paymentId };
      }

      // Imputación: la cobertura sólo existe a través de esta fila.
      this.insertAllocation(input.scope.tenantId, input.allocationId, group, input.paymentId, input.saleId, input.amount, sale.currency_code, nowIso);

      // Libro de crédito: la obligación nace en la misma transacción que
      // confirma el pago que la origina. Si una se escribiera sin la otra, el
      // comercio habría entregado mercancía que nadie debe.
      if (onCredit && creditAccountId !== null && this.creditPort !== undefined) {
        this.creditPort.appendTransaction({
          scope: input.scope,
          transactionId: input.creditTransactionId as string,
          accountId: creditAccountId,
          transactionType: "SALE_CREDIT",
          direction: "INCREASE",
          amount: input.amount,
          currencyCode: sale.currency_code,
          saleId: input.saleId,
          paymentId: input.paymentId,
          actorId: input.operatorUserId,
          idempotencyKey: `credit_sale:${input.idempotencyKey}`,
          requestChecksum: input.requestChecksum,
          correlationId: input.correlationId,
          causationId: input.causationId,
          nowIso,
        });

        const creditDetails = {
          account_id: creditAccountId,
          amount: input.amount,
          customer_id: sale.customer_id,
          payment_id: input.paymentId,
          sale_id: input.saleId,
        };
        this.writeAudit(input, "CREDIT_SALE_RECORDED", "CREDIT_ACCOUNT", creditAccountId, creditDetails, nowIso);
        this.enqueue(
          input, input.creditTransactionId as string, `credit_sale:${input.idempotencyKey}`,
          "CREDIT_ACCOUNT", creditAccountId, "CREDIT_SALE_RECORDED", creditDetails,
          input.requestChecksum, nowIso,
        );
      }

      // Caja: por puerto, jamás escritura directa. **Sólo el efectivo.** El
      // crédito no crea efectivo ficticio (`UC-PAY-004` §1156 regla 9).
      const posted = settlesInCash ? this.cashPort.appendCashSale({
        scope: input.scope,
        movementId: input.movementId,
        cashShiftId: sale.cash_shift_id as string,
        amount: input.amount,
        currencyCode: sale.currency_code,
        operatorUserId: input.operatorUserId,
        businessDate: this.saleBusinessDate(input.scope.tenantId, input.saleId),
        idempotencyKey: `cash_sale:${input.idempotencyKey}`,
        requestChecksum: input.requestChecksum,
        correlationId: input.correlationId,
        reasonCode: "CASH_SALE",
      }) : null;

      // Se lanza, no se retorna: en este punto ya hay filas escritas y sólo una
      // excepción revierte la transacción.
      if (posted !== null && posted.kind === "SHIFT_NOT_OPEN") {
        throw new PaymentRollback<RegisterPaymentOutcome>({ kind: "CASH_SHIFT_NOT_OPEN" });
      }
      if (posted !== null && posted.kind === "SHIFT_NOT_FOUND") {
        throw new PaymentRollback<RegisterPaymentOutcome>({ kind: "CASH_SHIFT_MISSING" });
      }
      if (posted !== null && posted.kind === "CURRENCY_MISMATCH") {
        throw new PaymentRollback<RegisterPaymentOutcome>({ kind: "CURRENCY_MISMATCH" });
      }

      const details = {
        amount: input.amount, method: input.method,
        payment_id: input.paymentId, sale_id: input.saleId,
      };
      this.writeAudit(input, "PAYMENT_CONFIRMED", "PAYMENT", input.paymentId, details, nowIso);
      this.enqueue(
        input, input.operationId, input.idempotencyKey,
        "PAYMENT", input.paymentId, "PAYMENT_CONFIRMED", details, input.requestChecksum, nowIso,
      );

      const completion = this.completeSaleIfCovered(
        input, input.saleId, sale.payable_amount, saleVersion, input.saleCompletionOperationId, nowIso,
      );

      return {
        kind: "CONFIRMED",
        paymentId: input.paymentId,
        saleCompleted: completion.completed,
        confirmedCoverage: bigIntToScale6(completion.coverage),
        payableAmount: sale.payable_amount,
      };
    }));
  }

  private saleBusinessDate(tenantId: string, saleId: string): string {
    return (this.database.native.prepare(
      "SELECT business_date FROM sales_sales WHERE tenant_id=? AND id=?",
    ).get(tenantId, saleId) as { business_date: string }).business_date;
  }

  private insertAllocation(
    tenantId: string, allocationId: string, groupId: string, paymentId: string,
    saleId: string, amount: string, currencyCode: string, nowIso: string,
  ): void {
    const nextSequence = (this.database.native.prepare(
      `SELECT COALESCE(MAX(allocation_sequence), 0) + 1 AS next_sequence
       FROM payments_payment_allocations WHERE tenant_id=? AND payment_id=?`,
    ).get(tenantId, paymentId) as NextSequenceRow).next_sequence;

    this.database.native.prepare(
      `INSERT INTO payments_payment_allocations(
        id, tenant_id, payment_group_id, payment_id,
        collection_subject_type, collection_subject_id,
        amount, currency_code, allocation_sequence, created_at
      ) VALUES (?,?,?,?,'SALE',?,?,?,?,?)`,
    ).run(allocationId, tenantId, groupId, paymentId, saleId, amount, currencyCode, nextSequence, nowIso);
  }

  // ── Confirmación de transferencia ───────────────────────────────────────────

  /**
   * Confirma una transferencia previamente reportada — atestiguación manual.
   *
   * Es el punto donde una transferencia produce cobertura, y por tanto donde
   * puede completar la venta.
   */
  confirmTransfer(input: ConfirmTransferInput): ConfirmTransferOutcome {
    const nowIso = this.now().toISOString();

    return runWithRollback(this.database.native.transaction((): ConfirmTransferOutcome => {
      const operation = this.operationIdempotency(input.idempotencyKey, input.requestChecksum);
      if (operation === "CONFLICT") return { kind: "IDEMPOTENCY_CONFLICT" };

      const payment = this.database.native.prepare(
        `SELECT p.id, p.payment_group_id, p.payment_method, p.status, p.expected_amount,
                p.confirmed_amount, p.currency_code, p.version, p.request_checksum,
                g.collection_subject_id
         FROM payments_payments p
         JOIN payments_payment_groups g ON g.tenant_id = p.tenant_id AND g.id = p.payment_group_id
         WHERE p.tenant_id=? AND p.id=?`,
      ).get(input.scope.tenantId, input.paymentId) as PaymentRow | undefined;

      if (payment === undefined) return { kind: "PAYMENT_NOT_FOUND" };

      // Reintento de esta misma confirmación. Se resuelve antes de mirar el
      // estado: tras confirmar, el pago ya no es `CREATED` y la comprobación de
      // estado devolvería `PAYMENT_NOT_CONFIRMABLE` a una repetición legítima.
      if (operation === "REPLAY") return { kind: "IDEMPOTENT", paymentId: payment.id };

      if (payment.status !== "CREATED") return { kind: "PAYMENT_NOT_CONFIRMABLE" };
      if (payment.version !== input.expectedVersion) return { kind: "VERSION_CONFLICT" };

      const saleId = payment.collection_subject_id;
      const sale = this.loadSale(input.scope.tenantId, saleId);
      if (sale === undefined) return { kind: "PAYMENT_NOT_FOUND" };
      if (sale.status === "COMPLETED") return { kind: "SALE_ALREADY_COMPLETED" };

      const amount = scale6ToBigInt(payment.expected_amount);
      if (this.confirmedCoverage(input.scope.tenantId, saleId) + amount > scale6ToBigInt(sale.payable_amount)) {
        return { kind: "OVERPAYMENT_NOT_ALLOWED" };
      }

      this.insertOperation(input.operationId, input.idempotencyKey, input.requestChecksum, "PAYMENT_CONFIRMED", nowIso);

      this.database.native.prepare(
        // `idempotency_key` y `request_checksum` NO se tocan: pertenecen a la
        // operación de registro y son su ancla permanente (`D-1`). La
        // confirmación registra la suya en `runtime_operations`.
        `UPDATE payments_payments
         SET status='CONFIRMED', confirmed_amount=expected_amount, confirmed_at=?,
             confirmed_by_actor_type='USER', confirmed_by_actor_id=?,
             version=version+1
         WHERE tenant_id=? AND id=? AND version=?`,
      ).run(
        nowIso, input.operatorUserId,
        input.scope.tenantId, input.paymentId, input.expectedVersion,
      );

      this.database.native.prepare(
        `UPDATE payments_payment_attempts
         SET status='CONFIRMED', confirmed_at=?, manual_confirmation_actor_id=?, version=version+1
         WHERE tenant_id=? AND payment_id=? AND id=?`,
      ).run(nowIso, input.operatorUserId, input.scope.tenantId, input.paymentId, input.attemptId);

      this.insertAllocation(
        input.scope.tenantId, input.allocationId, payment.payment_group_id, input.paymentId,
        saleId, payment.expected_amount, payment.currency_code, nowIso,
      );

      const saleVersion = this.beginPaymentOnSale(input.scope.tenantId, saleId, sale);

      const details = {
        amount: payment.expected_amount, method: payment.payment_method,
        payment_id: input.paymentId, sale_id: saleId,
      };
      this.writeAudit(input, "PAYMENT_CONFIRMED", "PAYMENT", input.paymentId, details, nowIso);
      this.enqueue(
        input, input.operationId, input.idempotencyKey,
        "PAYMENT", input.paymentId, "PAYMENT_CONFIRMED", details, input.requestChecksum, nowIso,
      );

      const completion = this.completeSaleIfCovered(
        input, saleId, sale.payable_amount, saleVersion, input.saleCompletionOperationId, nowIso,
      );

      return {
        kind: "CONFIRMED",
        paymentId: input.paymentId,
        saleCompleted: completion.completed,
        confirmedCoverage: bigIntToScale6(completion.coverage),
        payableAmount: sale.payable_amount,
      };
    }));
  }

  // ── Confirmación autorizada por proveedor ─────────────────────────────────

  /**
   * Confirma un pago QR a partir de evidencia ya autenticada y normalizada por
   * `PaymentProviderPort`.
   *
   * El proveedor es la autoridad financiera. La evidencia nunca se acepta por
   * monto solamente: las referencias y los importes deben coincidir con el
   * Payment pendiente.
   */
  confirmProviderPayment(input: ConfirmProviderPaymentInput): ConfirmProviderPaymentOutcome {
    const nowIso = this.now().toISOString();

    return runWithRollback(this.database.native.transaction((): ConfirmProviderPaymentOutcome => {
      const operation = this.operationIdempotency(input.idempotencyKey, input.requestChecksum);
      if (operation === "CONFLICT") return { kind: "IDEMPOTENCY_CONFLICT" };

      const payment = this.database.native.prepare(
        `SELECT p.id, p.payment_group_id, p.payment_method, p.status, p.expected_amount,
                p.confirmed_amount, p.currency_code, p.version, p.request_checksum,
                p.provider_code, p.provider_reference,
                g.collection_subject_id
         FROM payments_payments p
         JOIN payments_payment_groups g ON g.tenant_id = p.tenant_id AND g.id = p.payment_group_id
         WHERE p.tenant_id=? AND p.id=?`
      ).get(input.scope.tenantId, input.paymentId) as
        | (PaymentRow & { provider_code: string | null; provider_reference: string | null })
        | undefined;

      if (payment === undefined) return { kind: "PAYMENT_NOT_FOUND" };
      if (operation === "REPLAY") return { kind: "IDEMPOTENT", paymentId: payment.id };

      if (payment.payment_method !== "QR"
        || payment.provider_code !== input.providerCode
        || payment.provider_reference !== input.providerReference) {
        return { kind: "PROVIDER_MISMATCH" };
      }

      if (payment.status !== "PENDING" && payment.status !== "CREATED") {
        return { kind: "PAYMENT_NOT_CONFIRMABLE" };
      }
      if (payment.version !== input.expectedVersion) return { kind: "VERSION_CONFLICT" };

      const saleId = payment.collection_subject_id;
      const sale = this.loadSale(input.scope.tenantId, saleId);
      if (sale === undefined) return { kind: "PAYMENT_NOT_FOUND" };
      if (sale.status === "COMPLETED") return { kind: "SALE_ALREADY_COMPLETED" };

      if (input.currencyCode !== sale.currency_code || payment.currency_code !== input.currencyCode) {
        return { kind: "CURRENCY_MISMATCH" };
      }
      if (scale6ToBigInt(input.amount) !== scale6ToBigInt(payment.expected_amount)
        || scale6ToBigInt(input.amount) !== scale6ToBigInt(sale.payable_amount)
          - this.confirmedCoverage(input.scope.tenantId, saleId)) {
        return { kind: "AMOUNT_MISMATCH" };
      }

      // La identidad del proveedor vive en su propia columna desde
      // `MIGRATION_016`; antes había que buscarla en `provider_reference`
      // bajo `PROVIDER_TRANSACTION`, que era la misma casilla que guardaba la
      // referencia comercial. `payments_payment_attempts_provider_transaction_idx`
      // respalda esta guarda en el esquema.
      const providerAttempt = this.database.native.prepare(
        `SELECT payment_id FROM payments_payment_attempts
         WHERE tenant_id=? AND provider_code=? AND provider_transaction_id=?`
      ).get(input.scope.tenantId, input.providerCode, input.providerTransactionId) as
        | { payment_id: string }
        | undefined;

      if (providerAttempt !== undefined && providerAttempt.payment_id !== input.paymentId) {
        return { kind: "PROVIDER_TRANSACTION_CONFLICT" };
      }

      // `UNKNOWN` además de `PENDING`: un intento cuya consulta no pudo
      // determinarse sigue esperando veredicto, y `PAY-007` autoriza
      // `UNKNOWN → CONFIRMED`. Es la misma confirmación, con la misma
      // evidencia y las mismas invariantes comerciales; lo único distinto es
      // de qué estado venía.
      const pendingAttempt = this.database.native.prepare(
        `SELECT id, provider_transaction_id FROM payments_payment_attempts
         WHERE tenant_id=? AND payment_id=? AND payment_method='QR'
           AND status IN ('PENDING','UNKNOWN')
         ORDER BY attempt_number DESC
         LIMIT 1`
      ).get(input.scope.tenantId, input.paymentId) as
        | { id: string; provider_transaction_id: string | null }
        | undefined;

      if (pendingAttempt === undefined) return { kind: "PAYMENT_NOT_CONFIRMABLE" };

      // El intento ya podía traer un `transaction.id` aprendido antes de esta
      // evidencia. Si el que llega es otro, no es una actualización: son dos
      // transacciones distintas reclamando el mismo intento.
      if (pendingAttempt.provider_transaction_id !== null
        && pendingAttempt.provider_transaction_id !== input.providerTransactionId) {
        return { kind: "PROVIDER_TRANSACTION_CONFLICT" };
      }

      this.insertOperation(input.operationId, input.idempotencyKey, input.requestChecksum, "PAYMENT_CONFIRMED", nowIso);

      this.database.native.prepare(
        `UPDATE payments_payments
         SET status='CONFIRMED', confirmed_amount=expected_amount, confirmed_at=?,
             version=version+1
         WHERE tenant_id=? AND id=? AND version=?`
      ).run(nowIso, input.scope.tenantId, input.paymentId, input.expectedVersion);

      // `provider_reference_type` y `provider_reference` **no se tocan**: el
      // intento conserva la referencia comercial con la que se abrió el cobro
      // (`D-2-bis`). La identidad que trae el proveedor entra por su propia
      // columna, así que confirmar deja de ser una sustitución.
      this.database.native.prepare(
        `UPDATE payments_payment_attempts
         SET status='CONFIRMED', provider_code=?, provider_transaction_id=?,
             provider_reported_at=?, confirmed_at=?,
             manual_confirmation_actor_id=NULL, version=version+1
         WHERE tenant_id=? AND payment_id=? AND id=?`
      ).run(
        input.providerCode, input.providerTransactionId, input.receivedAt, nowIso,
        input.scope.tenantId, input.paymentId, pendingAttempt.id,
      );

      this.insertAllocation(
        input.scope.tenantId, input.allocationId, payment.payment_group_id, input.paymentId,
        saleId, payment.expected_amount, payment.currency_code, nowIso,
      );

      const saleVersion = this.beginPaymentOnSale(input.scope.tenantId, saleId, sale);

      const details = {
        amount: payment.expected_amount,
        method: payment.payment_method,
        payment_id: input.paymentId,
        sale_id: saleId,
        provider_code: input.providerCode,
        provider_reference: input.providerReference,
        provider_transaction_id: input.providerTransactionId,
        received_at: input.receivedAt,
        payer_reference: input.payerReference,
      };
      this.writeAudit(input, "PAYMENT_PROVIDER_CONFIRMED", "PAYMENT", input.paymentId, details, nowIso);
      this.enqueue(
        input, input.operationId, input.idempotencyKey,
        "PAYMENT", input.paymentId, "PAYMENT_PROVIDER_CONFIRMED", details, input.requestChecksum, nowIso,
      );

      const completion = this.completeSaleIfCovered(
        input, saleId, sale.payable_amount, saleVersion, input.saleCompletionOperationId, nowIso,
      );

      return {
        kind: "CONFIRMED",
        paymentId: input.paymentId,
        saleCompleted: completion.completed,
        confirmedCoverage: bigIntToScale6(completion.coverage),
        payableAmount: sale.payable_amount,
      };
    }));
  }
  // ── Cancelación ─────────────────────────────────────────────────────────────

  /**
   * Cancela un pago **no confirmado**.
   *
   * Un pago confirmado nunca se cancela: `DEC-002` prohíbe la sobrescritura
   * destructiva de un componente confirmado, y revertirlo es una operación
   * compensatoria (`Refund`/`Reversal`) fuera de V1.
   *
   * Cancelables: `CREATED` (transferencia reportada) y `PENDING` (pago con
   * proveedor que el operador abandona). `PENDING` no lo era, y eso dejaba a
   * un pago QR sin ninguna salida: nace `PENDING` (§register), sólo
   * `confirmProviderPayment` podía moverlo, y esa vía exige evidencia
   * autorizada que hoy ningún flujo productivo entrega. El pago quedaba
   * absorbente. `PAY-007` autoriza `Payment: PENDING → CANCELLED`.
   *
   * El intento **no** sigue al pago a `CANCELLED`: `PAY-007` no autoriza
   * `PaymentAttempt: PENDING → CANCELLED`. Autoriza `PENDING → EXPIRED`, que
   * además es lo que de verdad ocurrió — se abandonó un intento en vuelo sin
   * veredicto del proveedor, no se retiró algo que nunca salió del POS. Un
   * intento `CREATED` sí se cancela, como hasta ahora.
   *
   * Cancelar no es evidencia de que el proveedor no cobrara. Si más tarde
   * llegara evidencia aprobada sobre este pago, `confirmProviderPayment` la
   * rechaza con `PAYMENT_NOT_CONFIRMABLE` y la contradicción se pierde:
   * representarla es `REVIEW_REQUIRED` (`PAY-007` regla 5), que necesita el
   * camino de resolución de evidencia y queda como dependencia declarada.
   */
  cancel(input: CancelPaymentInput): CancelPaymentOutcome {
    const nowIso = this.now().toISOString();

    return this.database.native.transaction((): CancelPaymentOutcome => {
      const operation = this.operationIdempotency(input.idempotencyKey, input.requestChecksum);
      if (operation === "CONFLICT") return { kind: "IDEMPOTENCY_CONFLICT" };

      const payment = this.database.native.prepare(
        `SELECT p.id, p.payment_group_id, p.payment_method, p.status, p.expected_amount,
                p.confirmed_amount, p.currency_code, p.version, p.request_checksum,
                g.collection_subject_id
         FROM payments_payments p
         JOIN payments_payment_groups g ON g.tenant_id = p.tenant_id AND g.id = p.payment_group_id
         WHERE p.tenant_id=? AND p.id=?`,
      ).get(input.scope.tenantId, input.paymentId) as PaymentRow | undefined;

      if (payment === undefined) return { kind: "PAYMENT_NOT_FOUND" };
      if (operation === "REPLAY") return { kind: "IDEMPOTENT", paymentId: payment.id };
      if (payment.status === "CANCELLED") return { kind: "IDEMPOTENT", paymentId: payment.id };
      if (payment.status !== "CREATED" && payment.status !== "PENDING") {
        return { kind: "PAYMENT_NOT_CANCELLABLE" };
      }
      if (payment.version !== input.expectedVersion) return { kind: "VERSION_CONFLICT" };

      this.insertOperation(input.operationId, input.idempotencyKey, input.requestChecksum, "PAYMENT_CANCELLED", nowIso);

      this.database.native.prepare(
        `UPDATE payments_payments SET status='CANCELLED', cancelled_at=?, version=version+1
         WHERE tenant_id=? AND id=? AND version=?`,
      ).run(nowIso, input.scope.tenantId, input.paymentId, input.expectedVersion);

      const attempt = this.database.native.prepare(
        `SELECT status FROM payments_payment_attempts
         WHERE tenant_id=? AND payment_id=? AND attempt_number=1`,
      ).get(input.scope.tenantId, input.paymentId) as { status: string } | undefined;

      // `PENDING → EXPIRED`, `CREATED → CANCELLED`: las dos transiciones que
      // `PAY-007` autoriza para un intento que termina sin veredicto.
      const attemptStatus = attempt?.status === "PENDING" ? "EXPIRED" : "CANCELLED";

      this.database.native.prepare(
        `UPDATE payments_payment_attempts SET status=?, version=version+1
         WHERE tenant_id=? AND payment_id=? AND attempt_number=1`,
      ).run(attemptStatus, input.scope.tenantId, input.paymentId);

      // `attempt_status` distingue dos cancelaciones que no son el mismo
      // hecho: `CANCELLED` es un intento que nunca salió del POS, `EXPIRED`
      // uno que sí se envió al proveedor y se abandonó sin veredicto —
      // compatible con que exista un cobro externo. El evento sigue siendo
      // `PAYMENT_CANCELLED`; sólo se audita con qué terminó el intento.
      const details = {
        attempt_status: attemptStatus,
        payment_id: input.paymentId,
        sale_id: payment.collection_subject_id,
      };
      this.writeAudit(input, "PAYMENT_CANCELLED", "PAYMENT", input.paymentId, details, nowIso);
      this.enqueue(
        input, input.operationId, input.idempotencyKey,
        "PAYMENT", input.paymentId, "PAYMENT_CANCELLED", details, input.requestChecksum, nowIso,
      );

      return { kind: "CANCELLED", paymentId: input.paymentId };
    })();
  }

  // ── Incertidumbre ───────────────────────────────────────────────────────────

  /**
   * Deja constancia de que una consulta al proveedor **no pudo determinar** el
   * resultado del intento.
   *
   * Hasta aquí una incertidumbre técnica moría en una excepción: el puerto la
   * devolvía como `UNKNOWN` (`D-3`) y nadie la escribía, así que un intento
   * cuyo cobro pudo haber ocurrido de verdad seguía indistinguible de uno que
   * simplemente espera al cliente. Esto la persiste.
   *
   * **No es un veredicto.** El pago no se confirma ni se rechaza, la venta no
   * se toca, y no se imputa cobertura: `UNKNOWN` es estado del *intento*, no
   * del pago (`PAY-007` lo sitúa sólo en `PaymentAttemptStatus`). La
   * transición `PENDING → UNKNOWN` es la que `PAY-007` autoriza, y desde ahí
   * el intento sigue pudiendo ir a `CONFIRMED` o `DECLINED` cuando aparezca
   * evidencia: por eso esto es el punto de partida de una resolución futura y
   * no su final.
   *
   * Lo que **no** toca: `provider_reference` y `provider_reference_type`
   * conservan la referencia comercial (`D-2-bis`), y
   * `provider_transaction_id` se deja como esté — si el proveedor ya lo había
   * dado, sigue ahí junto a la incertidumbre; si no, sigue `NULL`, porque
   * inventarlo sería fabricar la identidad que hace falta para resolverla.
   */
  recordProviderUncertainty(input: RecordProviderUncertaintyInput): RecordProviderUncertaintyOutcome {
    const nowIso = this.now().toISOString();

    return runWithRollback(this.database.native.transaction((): RecordProviderUncertaintyOutcome => {
      const operation = this.operationIdempotency(input.idempotencyKey, input.requestChecksum);
      if (operation === "CONFLICT") return { kind: "IDEMPOTENCY_CONFLICT" };

      const payment = this.database.native.prepare(
        `SELECT p.id, g.collection_subject_id
         FROM payments_payments p
         JOIN payments_payment_groups g ON g.tenant_id = p.tenant_id AND g.id = p.payment_group_id
         WHERE p.tenant_id=? AND p.id=?`,
      ).get(input.scope.tenantId, input.paymentId) as
        | { id: string; collection_subject_id: string }
        | undefined;

      if (payment === undefined) return { kind: "PAYMENT_NOT_FOUND" };
      if (operation === "REPLAY") return { kind: "IDEMPOTENT", paymentId: payment.id };

      // `PAY-007` autoriza `PENDING → UNKNOWN`. Un intento ya confirmado,
      // rechazado o cancelado no vuelve a ser incierto: una respuesta tardía
      // que contradiga un intento terminal es una incidencia
      // (`REVIEW_REQUIRED`), no una marcha atrás silenciosa.
      const attempt = this.database.native.prepare(
        `SELECT id, provider_code, provider_transaction_id FROM payments_payment_attempts
         WHERE tenant_id=? AND payment_id=? AND status='PENDING'
         ORDER BY attempt_number DESC
         LIMIT 1`,
      ).get(input.scope.tenantId, input.paymentId) as
        | { id: string; provider_code: string | null; provider_transaction_id: string | null }
        | undefined;

      if (attempt === undefined) return { kind: "ATTEMPT_NOT_UNCERTAINABLE" };

      this.insertOperation(input.operationId, input.idempotencyKey, input.requestChecksum, "PAYMENT_PROVIDER_UNCERTAIN", nowIso);

      // `MIGRATION_018`: aquí nace la cita de la resolución automática. El
      // contador arranca en 0 —nadie ha preguntado todavía— y la primera
      // consulta se programa con el retardo inicial contado desde
      // `observedAt`, que es el origen de la ventana que `D-5` fija. Un
      // intento sin `provider_transaction_id` recibe cita igual: la cita dice
      // cuándo mirarlo, y es el selector del barrido quien decide que sin esa
      // identidad no hay nada que preguntar.
      this.database.native.prepare(
        `UPDATE payments_payment_attempts
         SET status='UNKNOWN', provider_uncertainty_reason=?, provider_uncertainty_observed_at=?,
             attempt_count=0, next_attempt_at=?,
             version=version+1
         WHERE tenant_id=? AND id=?`,
      ).run(
        input.reason, input.observedAt, firstQueryAt(input.observedAt),
        input.scope.tenantId, attempt.id,
      );

      const details = {
        attempt_id: attempt.id,
        payment_id: input.paymentId,
        provider_code: attempt.provider_code,
        provider_transaction_id: attempt.provider_transaction_id,
        reason: input.reason,
        observed_at: input.observedAt,
        sale_id: payment.collection_subject_id,
      };
      this.writeAudit(input, "PAYMENT_PROVIDER_UNCERTAIN", "PAYMENT", input.paymentId, details, nowIso);
      this.enqueue(
        input, input.operationId, input.idempotencyKey,
        "PAYMENT", input.paymentId, "PAYMENT_PROVIDER_UNCERTAIN", details, input.requestChecksum, nowIso,
      );

      return { kind: "RECORDED", paymentId: input.paymentId, attemptId: attempt.id };
    }));
  }

  /**
   * Resuelve un intento `UNKNOWN` con evidencia de **rechazo comercial**.
   *
   * `PAY-007` autoriza `UNKNOWN → DECLINED`. Es la contrapartida de
   * `confirmProviderPayment`: la misma incertidumbre, resuelta hacia el otro
   * lado.
   *
   * **El pago no se toca.** Un intento rechazado no es un pago fallido:
   * `PAY-007` admite varios intentos independientes por pago, así que
   * `payments_payments` sigue `PENDING` y el operador conserva sus opciones —
   * cobrar por otro medio o cancelar (`PENDING → CANCELLED`, `D-3`). Llevar
   * el pago a `FAILED` aquí sería una decisión de producto que nadie pidió.
   * La venta tampoco se toca, y no se imputa cobertura.
   *
   * La identidad del proveedor se anota si el intento aún no la tenía; si ya
   * traía otra, esto es un conflicto, no una corrección.
   */
  declineUncertainProviderPayment(input: DeclineUncertainPaymentInput): DeclineUncertainPaymentOutcome {
    const nowIso = this.now().toISOString();

    return runWithRollback(this.database.native.transaction((): DeclineUncertainPaymentOutcome => {
      const operation = this.operationIdempotency(input.idempotencyKey, input.requestChecksum);
      if (operation === "CONFLICT") return { kind: "IDEMPOTENCY_CONFLICT" };

      const payment = this.database.native.prepare(
        `SELECT p.id, p.provider_code, g.collection_subject_id
         FROM payments_payments p
         JOIN payments_payment_groups g ON g.tenant_id = p.tenant_id AND g.id = p.payment_group_id
         WHERE p.tenant_id=? AND p.id=?`,
      ).get(input.scope.tenantId, input.paymentId) as
        | { id: string; provider_code: string | null; collection_subject_id: string }
        | undefined;

      if (payment === undefined) return { kind: "PAYMENT_NOT_FOUND" };
      if (operation === "REPLAY") return { kind: "IDEMPOTENT", paymentId: payment.id };
      if (payment.provider_code !== input.providerCode) return { kind: "PROVIDER_MISMATCH" };

      // La misma transacción no puede reclamar dos intentos distintos.
      const claimed = this.database.native.prepare(
        `SELECT payment_id FROM payments_payment_attempts
         WHERE tenant_id=? AND provider_code=? AND provider_transaction_id=?`,
      ).get(input.scope.tenantId, input.providerCode, input.providerTransactionId) as
        | { payment_id: string }
        | undefined;

      if (claimed !== undefined && claimed.payment_id !== input.paymentId) {
        return { kind: "PROVIDER_TRANSACTION_CONFLICT" };
      }

      const attempt = this.database.native.prepare(
        `SELECT id, provider_transaction_id FROM payments_payment_attempts
         WHERE tenant_id=? AND payment_id=? AND status='UNKNOWN'
         ORDER BY attempt_number DESC
         LIMIT 1`,
      ).get(input.scope.tenantId, input.paymentId) as
        | { id: string; provider_transaction_id: string | null }
        | undefined;

      if (attempt === undefined) return { kind: "ATTEMPT_NOT_RESOLVABLE" };

      if (attempt.provider_transaction_id !== null
        && attempt.provider_transaction_id !== input.providerTransactionId) {
        return { kind: "PROVIDER_TRANSACTION_CONFLICT" };
      }

      this.insertOperation(input.operationId, input.idempotencyKey, input.requestChecksum, "PAYMENT_PROVIDER_DECLINED", nowIso);

      this.database.native.prepare(
        `UPDATE payments_payment_attempts
         SET status='DECLINED', provider_transaction_id=?, provider_reported_at=?,
             version=version+1
         WHERE tenant_id=? AND id=?`,
      ).run(input.providerTransactionId, input.receivedAt, input.scope.tenantId, attempt.id);

      const details = {
        attempt_id: attempt.id,
        payment_id: input.paymentId,
        provider_code: input.providerCode,
        provider_transaction_id: input.providerTransactionId,
        received_at: input.receivedAt,
        sale_id: payment.collection_subject_id,
      };
      this.writeAudit(input, "PAYMENT_PROVIDER_DECLINED", "PAYMENT", input.paymentId, details, nowIso);
      this.enqueue(
        input, input.operationId, input.idempotencyKey,
        "PAYMENT", input.paymentId, "PAYMENT_PROVIDER_DECLINED", details, input.requestChecksum, nowIso,
      );

      return { kind: "DECLINED", paymentId: input.paymentId, attemptId: attempt.id };
    }));
  }

  /**
   * Localiza el intento `UNKNOWN` de un pago y lo que se sabe de él.
   *
   * Es sólo lectura y está acotada por `tenant_id` y `payment_id`, de modo que
   * una consulta no puede alcanzar el intento de otro pago ni de otro tenant
   * por coincidencia. Devuelve `providerTransactionId` tal cual esté —
   * incluido `null`—: decidir qué hacer sin esa identidad es política del
   * caso de uso, no del almacén.
   */
  findUncertainProviderAttempt(scope: SyncScope, paymentId: string): UncertainProviderAttemptOutcome {
    const payment = this.database.native.prepare(
      "SELECT id, version FROM payments_payments WHERE tenant_id=? AND id=?",
    ).get(scope.tenantId, paymentId) as { id: string; version: number } | undefined;

    if (payment === undefined) return { kind: "PAYMENT_NOT_FOUND" };

    const attempt = this.database.native.prepare(
      `SELECT id, provider_code, provider_transaction_id, provider_uncertainty_reason
       FROM payments_payment_attempts
       WHERE tenant_id=? AND payment_id=? AND status='UNKNOWN'
       ORDER BY attempt_number DESC
       LIMIT 1`,
    ).get(scope.tenantId, paymentId) as
      | {
          id: string;
          provider_code: string | null;
          provider_transaction_id: string | null;
          provider_uncertainty_reason: string | null;
        }
      | undefined;

    if (attempt === undefined) return { kind: "ATTEMPT_NOT_UNCERTAIN" };

    return {
      kind: "FOUND",
      attempt: {
        paymentId: payment.id,
        paymentVersion: payment.version,
        attemptId: attempt.id,
        providerCode: attempt.provider_code,
        providerTransactionId: attempt.provider_transaction_id,
        uncertaintyReason: attempt.provider_uncertainty_reason,
      },
    };
  }

  // ── Barrido de inciertos (`D-5`, `D-6`, `D-7`) ───────────────────────────────

  /**
   * Intentos `UNKNOWN` a los que **toca** preguntar ahora.
   *
   * El selector es exactamente el que `payments_payment_attempts_uncertain_sweep_idx`
   * respalda, y las cuatro condiciones dicen cosas distintas:
   *
   * - `status='UNKNOWN'` deja fuera los terminales y los `REVIEW_REQUIRED`:
   *   una resolución ya abandonada no vuelve sola al barrido.
   * - `provider_transaction_id IS NOT NULL` deja fuera lo que no se puede
   *   preguntar. `GET /v1/transactions/{id}` necesita la identidad que asigna
   *   el proveedor, y la referencia comercial no la resuelve (`DEC-016` §21):
   *   un intento sin ella no es un candidato lento, es uno incontestable.
   * - `next_attempt_at IS NOT NULL` deja fuera lo que no tiene cita: filas
   *   anteriores a `MIGRATION_018` y las que reclamó otra invocación.
   * - `next_attempt_at <= now` deja fuera lo que todavía no vence.
   *
   * La ventana **no** se filtra aquí a propósito. Un candidato vencido tiene
   * que entrar para que el barrido lo retire a `REVIEW_REQUIRED` (`D-6`); si
   * el SQL lo escondiera, nadie lo retiraría nunca y el abandono no existiría.
   *
   * Está acotada por `tenant_id` como el resto del almacén, así que un barrido
   * de un tenant no alcanza los intentos de otro.
   */
  findUncertainProviderSweepCandidates(
    scope: SyncScope,
    options: { readonly now: Date; readonly limit: number },
  ): UncertainProviderSweepCandidate[] {
    const rows = this.database.native.prepare(
      `SELECT a.id, a.version, a.attempt_count, a.payment_id, a.provider_code,
              a.provider_transaction_id, a.provider_uncertainty_observed_at, a.next_attempt_at,
              p.version AS payment_version
       FROM payments_payment_attempts a
       JOIN payments_payments p ON p.tenant_id = a.tenant_id AND p.id = a.payment_id
       WHERE a.tenant_id=? AND a.status='UNKNOWN'
         AND a.provider_code IS NOT NULL
         AND a.provider_transaction_id IS NOT NULL
         AND a.provider_uncertainty_observed_at IS NOT NULL
         AND a.next_attempt_at IS NOT NULL AND a.next_attempt_at <= ?
       ORDER BY a.next_attempt_at ASC, a.id ASC
       LIMIT ?`,
    ).all(scope.tenantId, options.now.toISOString(), options.limit) as Array<{
      id: string;
      version: number;
      attempt_count: number;
      payment_id: string;
      provider_code: string;
      provider_transaction_id: string;
      provider_uncertainty_observed_at: string;
      next_attempt_at: string;
      payment_version: number;
    }>;

    return rows.map((row) => ({
      attemptId: row.id,
      attemptVersion: row.version,
      attemptCount: row.attempt_count,
      paymentId: row.payment_id,
      paymentVersion: row.payment_version,
      providerCode: row.provider_code,
      providerTransactionId: row.provider_transaction_id,
      observedAt: row.provider_uncertainty_observed_at,
      nextAttemptAt: row.next_attempt_at,
    }));
  }

  /**
   * Reclama un candidato **antes** de llamar al proveedor.
   *
   * `DEC-016` §6 regla 3 prohíbe invocar el puerto dentro de una transacción,
   * así que no se puede sostener un bloqueo mientras se pregunta. Lo que sí se
   * puede es dejar el candidato fuera del selector durante la llamada: el
   * reclamo gasta la consulta —`attempt_count + 1`, que es lo que hace que la
   * consulta número *n* ocurra con el contador ya en *n*— y aparca la cita en
   * el fin de la ventana.
   *
   * La guarda es `version`, no un lock: el `UPDATE` sólo prospera si nadie
   * tocó el intento desde que se leyó. Dos invocaciones que vean el mismo
   * candidato hacen el mismo `UPDATE` y **sólo una modifica una fila**; la
   * otra recibe `NOT_CLAIMED` y lo suelta. No hace falta un lock distribuido
   * porque no hay más de un escritor: el Local Service.
   *
   * Aparcar en el fin de la ventana y no en `NULL` es deliberado. Si el
   * proceso muere entre el reclamo y la respuesta, el intento no queda varado
   * sin cita: el siguiente barrido lo encuentra pasada la ventana y lo retira
   * a `REVIEW_REQUIRED`, que es exactamente lo que `D-6` quiere que le pase a
   * una incertidumbre que nadie pudo resolver.
   */
  claimUncertainProviderQuery(input: {
    readonly scope: SyncScope;
    readonly attemptId: string;
    readonly expectedAttemptVersion: number;
    readonly parkedUntil: string;
  }): "CLAIMED" | "NOT_CLAIMED" {
    const result = this.database.native.prepare(
      `UPDATE payments_payment_attempts
       SET attempt_count=attempt_count+1, next_attempt_at=?, version=version+1
       WHERE tenant_id=? AND id=? AND version=? AND status='UNKNOWN'`,
    ).run(input.parkedUntil, input.scope.tenantId, input.attemptId, input.expectedAttemptVersion);

    return result.changes === 1 ? "CLAIMED" : "NOT_CLAIMED";
  }

  /**
   * Devuelve el candidato tal y como estaba antes del reclamo.
   *
   * Es la contrapartida exacta de `claimUncertainProviderQuery` y existe por
   * una sola razón: un error tipado del proveedor —credenciales inválidas, un
   * `transaction.id` que no reconoce— **no es incertidumbre**, así que no
   * puede gastar una de las seis consultas ni mover la cita. El reclamo se
   * hace antes de preguntar porque no hay otra forma de excluir el candidato
   * durante la llamada; cuando la pregunta resulta no haber sido válida, se
   * deshace.
   *
   * No escribe auditoría: no ocurrió nada que auditar. El error viaja hacia
   * arriba y es allí donde se ve.
   */
  releaseUncertainProviderQuery(input: {
    readonly scope: SyncScope;
    readonly attemptId: string;
    readonly expectedAttemptVersion: number;
    readonly restoredNextAttemptAt: string;
  }): "RELEASED" | "NOT_RELEASED" {
    const result = this.database.native.prepare(
      `UPDATE payments_payment_attempts
       SET attempt_count=attempt_count-1, next_attempt_at=?, version=version+1
       WHERE tenant_id=? AND id=? AND version=? AND status='UNKNOWN' AND attempt_count > 0`,
    ).run(
      input.restoredNextAttemptAt, input.scope.tenantId, input.attemptId,
      input.expectedAttemptVersion,
    );

    return result.changes === 1 ? "RELEASED" : "NOT_RELEASED";
  }

  /**
   * Deja constancia de una consulta automática **contestada** y fija la cita
   * siguiente.
   *
   * Un solo asiento sostiene las tres cosas que `D-5` exige poder distinguir:
   * que se consultó (`attempt_number`), qué contestó el proveedor (`result` y,
   * si no contestó, `uncertainty_reason`) y cuándo toca volver (`next_attempt_at`,
   * `null` cuando no habrá otra). Separarlas en tres códigos habría dado tres
   * registros de un único hecho.
   *
   * **No cambia `status`.** Una consulta no resuelve: resolver es de
   * `confirmProviderPayment` y `declineUncertainProviderPayment`, y el intento
   * sigue `UNKNOWN` hasta que uno de ellos actúe. Tampoco toca
   * `provider_uncertainty_reason` ni `provider_uncertainty_observed_at`: la
   * incertidumbre original es el origen de la ventana y sobrevive a cada
   * consulta —moverla reiniciaría el reloj del abandono en cada intento, que
   * es justo lo que una ventana máxima impide—.
   */
  recordUncertainProviderQuery(input: RecordUncertainProviderQueryInput): RecordUncertainProviderQueryOutcome {
    const nowIso = this.now().toISOString();

    return runWithRollback(this.database.native.transaction((): RecordUncertainProviderQueryOutcome => {
      const operation = this.operationIdempotency(input.idempotencyKey, input.requestChecksum);
      if (operation === "CONFLICT") return { kind: "IDEMPOTENCY_CONFLICT" };

      const payment = this.database.native.prepare(
        `SELECT p.id, g.collection_subject_id
         FROM payments_payments p
         JOIN payments_payment_groups g ON g.tenant_id = p.tenant_id AND g.id = p.payment_group_id
         WHERE p.tenant_id=? AND p.id=?`,
      ).get(input.scope.tenantId, input.paymentId) as
        | { id: string; collection_subject_id: string }
        | undefined;

      if (payment === undefined) return { kind: "PAYMENT_NOT_FOUND" };
      if (operation === "REPLAY") return { kind: "IDEMPOTENT", paymentId: payment.id };

      const updated = this.database.native.prepare(
        `UPDATE payments_payment_attempts
         SET next_attempt_at=?, version=version+1
         WHERE tenant_id=? AND id=? AND payment_id=? AND status='UNKNOWN'`,
      ).run(input.nextAttemptAt, input.scope.tenantId, input.attemptId, input.paymentId);

      if (updated.changes !== 1) return { kind: "ATTEMPT_NOT_UNCERTAIN" };

      this.insertOperation(
        input.operationId, input.idempotencyKey, input.requestChecksum,
        "PAYMENT_PROVIDER_QUERIED", nowIso,
      );

      const details = {
        attempt_id: input.attemptId,
        attempt_number: input.attemptNumber,
        next_attempt_at: input.nextAttemptAt,
        payment_id: input.paymentId,
        result: input.result,
        sale_id: payment.collection_subject_id,
        uncertainty_reason: input.uncertaintyReason,
      };
      this.writeAudit(input, "PAYMENT_PROVIDER_QUERIED", "PAYMENT", input.paymentId, details, nowIso);
      this.enqueue(
        input, input.operationId, input.idempotencyKey,
        "PAYMENT", input.paymentId, "PAYMENT_PROVIDER_QUERIED", details, input.requestChecksum, nowIso,
      );

      return { kind: "RECORDED", paymentId: input.paymentId, attemptId: input.attemptId };
    }));
  }

  /**
   * Termina la resolución automática: `UNKNOWN → REVIEW_REQUIRED` (`D-6`).
   *
   * **Nunca `FAILED`.** Agotar la ventana o las consultas no dice que el pago
   * fracasara; dice que este mecanismo dejó de preguntar. `PAY-007` lo tiene
   * escrito desde el principio —regla 1: un timeout no produce `FAILED`— y
   * `REVIEW_REQUIRED` no es terminal, así que una evidencia tardía por una
   * entrada autorizada sigue pudiendo resolver el intento por las reglas que
   * ya existen.
   *
   * La cita se borra: sin `next_attempt_at` el intento no vuelve al selector,
   * que es lo que «se acabó lo automático» significa en el esquema.
   * `provider_uncertainty_reason` y `provider_uncertainty_observed_at` se
   * conservan — son la historia de por qué se llegó aquí.
   */
  abandonUncertainProviderResolution(input: AbandonUncertainResolutionInput): AbandonUncertainResolutionOutcome {
    const nowIso = this.now().toISOString();

    return runWithRollback(this.database.native.transaction((): AbandonUncertainResolutionOutcome => {
      const operation = this.operationIdempotency(input.idempotencyKey, input.requestChecksum);
      if (operation === "CONFLICT") return { kind: "IDEMPOTENCY_CONFLICT" };

      const payment = this.database.native.prepare(
        `SELECT p.id, g.collection_subject_id
         FROM payments_payments p
         JOIN payments_payment_groups g ON g.tenant_id = p.tenant_id AND g.id = p.payment_group_id
         WHERE p.tenant_id=? AND p.id=?`,
      ).get(input.scope.tenantId, input.paymentId) as
        | { id: string; collection_subject_id: string }
        | undefined;

      if (payment === undefined) return { kind: "PAYMENT_NOT_FOUND" };
      if (operation === "REPLAY") return { kind: "IDEMPOTENT", paymentId: payment.id };

      const attempt = this.database.native.prepare(
        `SELECT attempt_count FROM payments_payment_attempts
         WHERE tenant_id=? AND id=? AND payment_id=? AND status='UNKNOWN'`,
      ).get(input.scope.tenantId, input.attemptId, input.paymentId) as
        | { attempt_count: number }
        | undefined;

      if (attempt === undefined) return { kind: "ATTEMPT_NOT_UNCERTAIN" };

      this.insertOperation(
        input.operationId, input.idempotencyKey, input.requestChecksum,
        "PAYMENT_PROVIDER_RESOLUTION_ABANDONED", nowIso,
      );

      this.database.native.prepare(
        `UPDATE payments_payment_attempts
         SET status='REVIEW_REQUIRED', next_attempt_at=NULL, version=version+1
         WHERE tenant_id=? AND id=?`,
      ).run(input.scope.tenantId, input.attemptId);

      const details = {
        attempt_id: input.attemptId,
        attempt_count: attempt.attempt_count,
        payment_id: input.paymentId,
        reason: input.reason,
        sale_id: payment.collection_subject_id,
      };
      this.writeAudit(
        input, "PAYMENT_PROVIDER_RESOLUTION_ABANDONED", "PAYMENT", input.paymentId, details, nowIso,
      );
      this.enqueue(
        input, input.operationId, input.idempotencyKey,
        "PAYMENT", input.paymentId, "PAYMENT_PROVIDER_RESOLUTION_ABANDONED", details,
        input.requestChecksum, nowIso,
      );

      return { kind: "REVIEW_REQUIRED", paymentId: input.paymentId, attemptId: input.attemptId };
    }));
  }
}
