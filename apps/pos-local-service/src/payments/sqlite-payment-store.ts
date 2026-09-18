import type { LocalDatabase } from "@pos-platform/database-sqlite";
import { canonicalJson } from "../channel/canonical-json.js";
import type { DurableSyncStore, SyncScope } from "../sync/durable-sync-store.js";
import type { CashPort } from "./cash-port.js";
import type { InventoryPort } from "./inventory-port.js";
import { bigIntToScale6, scale6ToBigInt } from "../money.js";

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

export type PaymentMethod = "CASH" | "TRANSFER" | "QR";

interface SaleRow {
  status: string;
  currency_code: string;
  payable_amount: string;
  cash_shift_id: string | null;
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

export type GetPaymentOutcome =
  | { readonly kind: "FOUND"; readonly payment: PaymentView }
  | { readonly kind: "NOT_FOUND" };

export interface ObservedProviderTransaction {
  readonly providerTransactionId: string;
  readonly observedAt: string;
}

export type RecordObservedProviderTransactionOutcome =
  | { readonly kind: "RECORDED" }
  | { readonly kind: "PAYMENT_NOT_FOUND" }
  | { readonly kind: "PAYMENT_NOT_RECONCILABLE" };

// ── Store ─────────────────────────────────────────────────────────────────────

export class SqlitePaymentStore {
  constructor(
    private readonly database: LocalDatabase,
    private readonly durableSync: DurableSyncStore,
    private readonly cashPort: CashPort,
    private readonly inventoryPort: InventoryPort,
    private readonly now: () => Date = () => new Date(),
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
   * Anota un `transaction.id` de Wompi aprendido antes de confirmar —
   * `MIGRATION_016`, `DEC-016` §20. **No autoritativo**: no cambia
   * `payments_payments.status` ni `payments_payment_attempts.status`. Sólo
   * `confirmProviderPayment` puede hacer eso.
   *
   * Localiza el mismo intento `QR`/`PENDING` que `confirmProviderPayment`
   * confirmaría, para que ambos caminos operen siempre sobre la misma fila.
   */
  recordObservedProviderTransaction(
    scope: SyncScope,
    paymentId: string,
    providerTransactionId: string,
    observedAt: string,
  ): RecordObservedProviderTransactionOutcome {
    const pendingAttempt = this.database.native.prepare(
      `SELECT id FROM payments_payment_attempts
       WHERE tenant_id=? AND payment_id=? AND payment_method='QR' AND status='PENDING'
       ORDER BY attempt_number DESC
       LIMIT 1`,
    ).get(scope.tenantId, paymentId) as { id: string } | undefined;

    if (pendingAttempt === undefined) {
      const exists = this.database.native.prepare(
        `SELECT 1 FROM payments_payments WHERE tenant_id=? AND id=?`,
      ).get(scope.tenantId, paymentId);
      return { kind: exists === undefined ? "PAYMENT_NOT_FOUND" : "PAYMENT_NOT_RECONCILABLE" };
    }

    this.database.native.prepare(
      `UPDATE payments_payment_attempts
       SET observed_provider_transaction_id=?, observed_provider_transaction_at=?
       WHERE tenant_id=? AND id=?`,
    ).run(providerTransactionId, observedAt, scope.tenantId, pendingAttempt.id);

    return { kind: "RECORDED" };
  }

  /** Lee lo que `recordObservedProviderTransaction` anotó, si algo. */
  getObservedProviderTransaction(scope: SyncScope, paymentId: string): ObservedProviderTransaction | null {
    const row = this.database.native.prepare(
      `SELECT observed_provider_transaction_id, observed_provider_transaction_at
       FROM payments_payment_attempts
       WHERE tenant_id=? AND payment_id=? AND payment_method='QR'
       ORDER BY attempt_number DESC
       LIMIT 1`,
    ).get(scope.tenantId, paymentId) as
      | { observed_provider_transaction_id: string | null; observed_provider_transaction_at: string | null }
      | undefined;

    if (row === undefined || row.observed_provider_transaction_id === null || row.observed_provider_transaction_at === null) {
      return null;
    }
    return {
      providerTransactionId: row.observed_provider_transaction_id,
      observedAt: row.observed_provider_transaction_at,
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
      `SELECT status, currency_code, payable_amount, cash_shift_id, version
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
      const confirming = input.method === "CASH";
      const providerAuthoritative = input.method === "QR";
      if (providerAuthoritative && (input.providerCode === null || input.providerReference === null)) {
        return { kind: "PROVIDER_REFERENCE_REQUIRED" };
      }
      if (confirming && this.confirmedCoverage(input.scope.tenantId, input.saleId) + amount > payable) {
        return { kind: "OVERPAYMENT_NOT_ALLOWED" };
      }

      // 4. Efectivo: exige turno abierto ANTES de escribir nada.
      if (confirming) {
        if (sale.cash_shift_id === null) return { kind: "CASH_SHIFT_MISSING" };
      }

      const group = this.ensureGroup(input, sale, nowIso);
      const status = confirming ? "CONFIRMED" : providerAuthoritative ? "PENDING" : "CREATED";
      const resultCode = confirming ? "PAYMENT_CONFIRMED" : "PAYMENT_REGISTERED";

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
        input.method, confirming ? "LOCAL_DEVICE" : providerAuthoritative ? "EXTERNAL_PROVIDER_AUTHORITATIVE" : "MANUAL_ATTESTATION", status,
        input.amount, confirming ? input.amount : "0.000000",
        input.tenderedAmount, input.changeAmount, sale.currency_code,
        input.scope.deviceId, input.scope.installationId,
        input.operatorUserId,
        confirming ? "USER" : null, confirming ? input.operatorUserId : null,
        input.providerCode, input.providerReference,
        input.operationId, input.idempotencyKey, input.requestChecksum, input.correlationId, input.causationId,
        nowIso, confirming ? nowIso : null,
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
        input.method, confirming ? "LOCAL_DEVICE" : providerAuthoritative ? "EXTERNAL_PROVIDER_AUTHORITATIVE" : "MANUAL_ATTESTATION", status,
        input.amount, sale.currency_code,
        input.providerCode,
        input.providerReference === null ? null : providerAuthoritative ? "PROVIDER_INTENT" : "MANUAL_REFERENCE",
        input.providerReference,
        confirming ? input.operatorUserId : null,
        `attempt:${input.idempotencyKey}`, input.requestChecksum, input.correlationId, input.causationId,
        nowIso, confirming ? nowIso : null,
      );

      const saleVersion = this.beginPaymentOnSale(input.scope.tenantId, input.saleId, sale);

      if (!confirming) {
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

      // Caja: por puerto, jamás escritura directa.
      const posted = this.cashPort.appendCashSale({
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
      });

      // Se lanza, no se retorna: en este punto ya hay filas escritas y sólo una
      // excepción revierte la transacción.
      if (posted.kind === "SHIFT_NOT_OPEN") {
        throw new PaymentRollback<RegisterPaymentOutcome>({ kind: "CASH_SHIFT_NOT_OPEN" });
      }
      if (posted.kind === "SHIFT_NOT_FOUND") {
        throw new PaymentRollback<RegisterPaymentOutcome>({ kind: "CASH_SHIFT_MISSING" });
      }
      if (posted.kind === "CURRENCY_MISMATCH") {
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

      const providerAttempt = this.database.native.prepare(
        `SELECT payment_id FROM payments_payment_attempts
         WHERE tenant_id=? AND provider_code=? AND provider_reference_type='PROVIDER_TRANSACTION'
           AND provider_reference=?`
      ).get(input.scope.tenantId, input.providerCode, input.providerTransactionId) as
        | { payment_id: string }
        | undefined;

      if (providerAttempt !== undefined && providerAttempt.payment_id !== input.paymentId) {
        return { kind: "PROVIDER_TRANSACTION_CONFLICT" };
      }

      const pendingAttempt = this.database.native.prepare(
        `SELECT id FROM payments_payment_attempts
         WHERE tenant_id=? AND payment_id=? AND payment_method='QR'
           AND status='PENDING'
         ORDER BY attempt_number DESC
         LIMIT 1`
      ).get(input.scope.tenantId, input.paymentId) as { id: string } | undefined;

      if (pendingAttempt === undefined) return { kind: "PAYMENT_NOT_CONFIRMABLE" };

      this.insertOperation(input.operationId, input.idempotencyKey, input.requestChecksum, "PAYMENT_CONFIRMED", nowIso);

      this.database.native.prepare(
        `UPDATE payments_payments
         SET status='CONFIRMED', confirmed_amount=expected_amount, confirmed_at=?,
             version=version+1
         WHERE tenant_id=? AND id=? AND version=?`
      ).run(nowIso, input.scope.tenantId, input.paymentId, input.expectedVersion);

      this.database.native.prepare(
        `UPDATE payments_payment_attempts
         SET status='CONFIRMED', provider_code=?, provider_reference_type='PROVIDER_TRANSACTION',
             provider_reference=?, provider_reported_at=?, confirmed_at=?,
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
      if (payment.status !== "CREATED") return { kind: "PAYMENT_NOT_CANCELLABLE" };
      if (payment.version !== input.expectedVersion) return { kind: "VERSION_CONFLICT" };

      this.insertOperation(input.operationId, input.idempotencyKey, input.requestChecksum, "PAYMENT_CANCELLED", nowIso);

      this.database.native.prepare(
        `UPDATE payments_payments SET status='CANCELLED', cancelled_at=?, version=version+1
         WHERE tenant_id=? AND id=? AND version=?`,
      ).run(nowIso, input.scope.tenantId, input.paymentId, input.expectedVersion);

      this.database.native.prepare(
        `UPDATE payments_payment_attempts SET status='CANCELLED', version=version+1
         WHERE tenant_id=? AND payment_id=? AND attempt_number=1`,
      ).run(input.scope.tenantId, input.paymentId);

      const details = { payment_id: input.paymentId, sale_id: payment.collection_subject_id };
      this.writeAudit(input, "PAYMENT_CANCELLED", "PAYMENT", input.paymentId, details, nowIso);
      this.enqueue(
        input, input.operationId, input.idempotencyKey,
        "PAYMENT", input.paymentId, "PAYMENT_CANCELLED", details, input.requestChecksum, nowIso,
      );

      return { kind: "CANCELLED", paymentId: input.paymentId };
    })();
  }
}
