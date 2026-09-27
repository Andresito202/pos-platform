import type { LocalDatabase } from "@pos-platform/database-sqlite";
import { uuidV7 } from "@pos-platform/contracts";
import { canonicalJson } from "../channel/canonical-json.js";
import type { DurableSyncStore, SyncScope } from "../sync/durable-sync-store.js";
import { bigIntToScale6, scale6ToBigInt } from "../money.js";
import type { ReturnCashPort, ReturnInventoryPort } from "./return-ports.js";

const RETURN_PAYLOAD_SCHEMA_VERSION = "1.0.0";

export type PhysicalCondition =
  | "RESTOCKABLE" | "DAMAGED" | "EXPIRED" | "OPENED" | "QUARANTINE"
  | "DISCARDED" | "RETURN_TO_SUPPLIER" | "NOT_APPLICABLE";

/** Exigen un destino de inventario —cuarentena, proveedor— que no existe. */
const CONDITIONS_WITHOUT_DESTINATION: ReadonlySet<PhysicalCondition> = new Set(["QUARANTINE", "RETURN_TO_SUPPLIER"]);

export interface CreateSaleReturnInput {
  readonly scope: SyncScope;
  readonly sessionId: string;
  readonly operatorUserId: string;
  readonly saleId: string;
  /** Obligatoria para una venta en efectivo; ignorada para transferencia — no hay caja de la que sacar nada. */
  readonly cashRegisterId: string | null;
  readonly reasonCode: string;
  readonly reasonDetail: string | null;
  readonly lines: readonly { readonly lineNumber: number; readonly physicalCondition: PhysicalCondition }[];
  readonly idempotencyKey: string;
  readonly requestChecksum: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

export interface SaleReturnSummary {
  readonly saleReturnId: string;
  readonly refundId: string;
  readonly commercialAmount: string;
  readonly roundingAdjustment: string;
  readonly refundedAmount: string;
  readonly restockedLines: number;
  readonly fiscalCorrection: "NO_FISCAL_DOCUMENT" | "REQUIRED_NOT_AVAILABLE";
  /**
   * `COMPLETED`: el efectivo ya salió del cajón. `PROCESSING`: es una
   * transferencia — la devolución y el reingreso ya están hechos, pero el
   * dinero no se ha confirmado devuelto (`UC-PAY-004` §Reembolso de
   * transferencia o QR manual); falta `payments.refund.confirm`.
   */
  readonly refundStatus: "COMPLETED" | "PROCESSING";
}

export type CreateSaleReturnOutcome =
  | ({ readonly kind: "COMPLETED" | "IDEMPOTENT" } & SaleReturnSummary)
  | { readonly kind: "IDEMPOTENCY_CONFLICT" }
  | { readonly kind: "SALE_NOT_FOUND" }
  | { readonly kind: "SALE_NOT_COMPLETED" }
  | { readonly kind: "LINE_NOT_FOUND" }
  | { readonly kind: "LINE_ALREADY_RETURNED" }
  | { readonly kind: "CONDITION_NOT_SUPPORTED" }
  | { readonly kind: "REFUND_METHOD_NOT_SUPPORTED" }
  | { readonly kind: "ROUNDING_SHARE_NOT_SUPPORTED" }
  | { readonly kind: "CASH_REGISTER_REQUIRED" }
  | { readonly kind: "CASH_SHIFT_MISSING" }
  | { readonly kind: "CASH_SHIFT_NOT_OPEN" }
  | { readonly kind: "CURRENCY_MISMATCH" }
  | { readonly kind: "INSUFFICIENT_CASH" };

type Rejection = Exclude<CreateSaleReturnOutcome, { readonly kind: "COMPLETED" | "IDEMPOTENT" }>;

/**
 * Estados que siguen reclamando su línea — `D-50`. Un `RETURN_REQUESTED` o
 * `RETURN_APPROVED` todavía no completó nada, pero ya le impide a otra
 * solicitud tomar la misma línea: sin esto, dos solicitudes concurrentes
 * sobre la misma línea pasarían las dos su validación y sólo se descubriría
 * el choque al ejecutar la segunda.
 */
const RETURN_LINE_CLAIM_STATUSES = "('RETURN_REJECTED','RETURN_FAILED')";

export interface RequestSaleReturnInput {
  readonly scope: SyncScope;
  readonly sessionId: string;
  readonly operatorUserId: string;
  readonly saleId: string;
  readonly reasonCode: string;
  readonly reasonDetail: string | null;
  readonly lines: readonly { readonly lineNumber: number; readonly physicalCondition: PhysicalCondition }[];
  readonly idempotencyKey: string;
  readonly requestChecksum: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

export interface SaleReturnRequestSummary {
  readonly saleReturnId: string;
  readonly requestedAmount: string;
}

export type RequestSaleReturnOutcome =
  | ({ readonly kind: "REQUESTED" | "IDEMPOTENT" } & SaleReturnRequestSummary)
  | { readonly kind: "IDEMPOTENCY_CONFLICT" }
  | { readonly kind: "SALE_NOT_FOUND" }
  | { readonly kind: "SALE_NOT_COMPLETED" }
  | { readonly kind: "LINE_NOT_FOUND" }
  | { readonly kind: "LINE_ALREADY_RETURNED" }
  | { readonly kind: "CONDITION_NOT_SUPPORTED" }
  | { readonly kind: "REFUND_METHOD_NOT_SUPPORTED" }
  | { readonly kind: "ROUNDING_SHARE_NOT_SUPPORTED" };

export interface ApproveSaleReturnInput {
  readonly scope: SyncScope;
  readonly sessionId: string;
  readonly operatorUserId: string;
  readonly saleReturnId: string;
  readonly idempotencyKey: string;
  readonly requestChecksum: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

export type ApproveSaleReturnOutcome =
  | { readonly kind: "APPROVED" | "IDEMPOTENT"; readonly saleReturnId: string }
  | { readonly kind: "IDEMPOTENCY_CONFLICT" }
  | { readonly kind: "RETURN_NOT_FOUND" }
  | { readonly kind: "RETURN_NOT_PENDING" };

export interface ExecuteSaleReturnInput {
  readonly scope: SyncScope;
  readonly sessionId: string;
  readonly operatorUserId: string;
  readonly saleReturnId: string;
  readonly cashRegisterId: string | null;
  readonly idempotencyKey: string;
  readonly requestChecksum: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

export type ExecuteSaleReturnOutcome =
  | ({ readonly kind: "COMPLETED" | "IDEMPOTENT" } & SaleReturnSummary)
  | { readonly kind: "IDEMPOTENCY_CONFLICT" }
  | { readonly kind: "RETURN_NOT_FOUND" }
  | { readonly kind: "RETURN_NOT_APPROVED" }
  | { readonly kind: "REFUND_METHOD_NOT_SUPPORTED" }
  | { readonly kind: "CASH_REGISTER_REQUIRED" }
  | { readonly kind: "CASH_SHIFT_MISSING" }
  | { readonly kind: "CASH_SHIFT_NOT_OPEN" }
  | { readonly kind: "CURRENCY_MISMATCH" }
  | { readonly kind: "INSUFFICIENT_CASH" };

type ExecuteRejection = Exclude<ExecuteSaleReturnOutcome, { readonly kind: "COMPLETED" | "IDEMPOTENT" }>;

class ExecuteRollback extends Error {
  constructor(readonly outcome: ExecuteRejection) {
    super(outcome.kind);
  }
}

export interface ConfirmRefundInput {
  readonly scope: SyncScope;
  readonly sessionId: string;
  readonly operatorUserId: string;
  readonly refundId: string;
  readonly providerReference: string;
  readonly destinationReference: string;
  readonly idempotencyKey: string;
  readonly requestChecksum: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

export type ConfirmRefundOutcome =
  | { readonly kind: "CONFIRMED" | "IDEMPOTENT"; readonly refundId: string; readonly completedAmount: string }
  | { readonly kind: "IDEMPOTENCY_CONFLICT" }
  | { readonly kind: "REFUND_NOT_FOUND" }
  | { readonly kind: "REFUND_NOT_PENDING" }
  | { readonly kind: "SAME_ACTOR_NOT_ALLOWED" };

/** Se lanza para deshacer lo ya escrito: devolver dentro de la transacción la confirmaría. */
class ReturnRollback extends Error {
  constructor(readonly outcome: Rejection) {
    super(outcome.kind);
  }
}

interface SaleRow {
  company_id: string;
  branch_id: string;
  status: string;
  currency_code: string;
  payable_amount: string;
  commercial_rounding_adjustment: string;
  pricing_pipeline_version: string;
  tax_policy_version: string;
  rounding_policy_version: string;
  version: number;
}

interface ItemRow {
  id: string;
  line_number: number;
  presentation_id: string;
  lot_id: string | null;
  unit_id: string;
  quantity: string;
  unit_price_amount: string;
  discount_amount: string;
  taxable_amount: string;
  tax_amount: string;
  line_total_amount: string;
  stock_controlled: number;
}

/**
 * Devolución comercial con reembolso en efectivo — `B11`.
 *
 * Coordina en una unidad de trabajo local los agregados de Sales
 * (`sales_sale_returns`) y de Payments (`payments_refunds`), igual que
 * `SqlitePaymentStore` coordina el pago con la venta que completa. Caja e
 * inventario se escriben **sólo** a través de sus puertos: la secuencia del
 * turno y la existencia son de sus dueños.
 *
 * Todo se valida antes de escribir. Lo que sólo puede fallar al escribir —el
 * efectivo del turno— se lanza como `ReturnRollback`, y la transacción entera
 * se deshace: no queda una devolución sin su salida de caja ni una salida sin
 * su devolución.
 */
export class SqliteSaleReturnStore {
  constructor(
    private readonly database: LocalDatabase,
    private readonly durableSync: DurableSyncStore,
    private readonly cash: ReturnCashPort,
    private readonly inventory: ReturnInventoryPort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  create(input: CreateSaleReturnInput): CreateSaleReturnOutcome {
    try {
      return this.database.native.transaction(() => this.createInTransaction(input))();
    } catch (thrown) {
      if (thrown instanceof ReturnRollback) return thrown.outcome;
      throw thrown;
    }
  }

  private createInTransaction(input: CreateSaleReturnInput): CreateSaleReturnOutcome {
    const { scope } = input;
    const nowIso = this.now().toISOString();

    // 1. Idempotencia de la operación, antes de mirar nada más.
    const operation = this.database.native.prepare(
      "SELECT payload_checksum FROM runtime_operations WHERE idempotency_key=?",
    ).get(input.idempotencyKey) as { payload_checksum: string } | undefined;
    if (operation !== undefined) {
      if (operation.payload_checksum !== input.requestChecksum) return { kind: "IDEMPOTENCY_CONFLICT" };
      const replay = this.readSummary(scope, input.idempotencyKey);
      // La clave la consumió otra clase de operación con el mismo checksum:
      // indistinguible de una colisión, así que se rechaza.
      return replay === null ? { kind: "IDEMPOTENCY_CONFLICT" } : { kind: "IDEMPOTENT", ...replay };
    }

    // 2. La venta, dentro del ámbito confiable. Otra sucursal o compañía es
    //    «no existe»: no se revela que exista fuera del alcance del operador.
    const sale = this.database.native.prepare(
      `SELECT company_id, branch_id, status, currency_code, payable_amount, commercial_rounding_adjustment,
              pricing_pipeline_version, tax_policy_version, rounding_policy_version, version
         FROM sales_sales WHERE tenant_id=? AND id=?`,
    ).get(scope.tenantId, input.saleId) as SaleRow | undefined;
    if (sale === undefined || sale.company_id !== scope.companyId || sale.branch_id !== scope.branchId) {
      return { kind: "SALE_NOT_FOUND" };
    }
    if (sale.status !== "COMPLETED") return { kind: "SALE_NOT_COMPLETED" };

    // 3. Un único pago confirmado, con una sola imputación, en un medio que
    //    sabe reembolsarse: efectivo (atómico) o transferencia (manual,
    //    `UC-PAY-004` §Reembolso de transferencia o QR manual). El QR de este
    //    sistema es `EXTERNAL_PROVIDER_AUTHORITATIVE` (Wompi) y su reversal
    //    exigiría una llamada real al proveedor que `PaymentProviderPort` no
    //    tiene: no se inventa esa integración para adelantarlo.
    const payments = this.database.native.prepare(
      `SELECT p.id, p.payment_method, p.status FROM payments_payments p
         JOIN payments_payment_groups g ON g.tenant_id = p.tenant_id AND g.id = p.payment_group_id
        WHERE p.tenant_id=? AND g.collection_subject_type='SALE' AND g.collection_subject_id=?
          AND p.status NOT IN ('CANCELLED','FAILED')`,
    ).all(scope.tenantId, input.saleId) as { id: string; payment_method: string; status: string }[];
    const payment = payments[0];
    if (payments.length !== 1 || payment === undefined
      || (payment.payment_method !== "CASH" && payment.payment_method !== "TRANSFER")
      || payment.status !== "CONFIRMED") {
      return { kind: "REFUND_METHOD_NOT_SUPPORTED" };
    }
    const refundMethod = payment.payment_method as "CASH" | "TRANSFER";
    if (refundMethod === "CASH" && input.cashRegisterId === null) return { kind: "CASH_REGISTER_REQUIRED" };
    const allocations = this.database.native.prepare(
      "SELECT id, amount FROM payments_payment_allocations WHERE tenant_id=? AND payment_id=?",
    ).all(scope.tenantId, payment.id) as { id: string; amount: string }[];
    const allocation = allocations[0];
    if (allocations.length !== 1 || allocation === undefined) return { kind: "REFUND_METHOD_NOT_SUPPORTED" };

    // 4. Líneas: existen, su condición tiene destino y no se devolvieron antes.
    const items = this.database.native.prepare(
      `SELECT i.id, i.line_number, i.presentation_id, i.lot_id, i.unit_id, i.quantity, i.unit_price_amount,
              i.discount_amount, i.taxable_amount, i.tax_amount, i.line_total_amount, p.stock_controlled
         FROM sales_sale_items i
         JOIN catalog_product p ON p.tenant_id = i.tenant_id AND p.id = i.product_id
        WHERE i.tenant_id=? AND i.sale_id=?`,
    ).all(scope.tenantId, input.saleId) as ItemRow[];
    const byNumber = new Map(items.map((item) => [item.line_number, item]));
    const returnedBefore = new Set((this.database.native.prepare(
      `SELECT l.sale_item_id FROM sales_sale_return_lines l
         JOIN sales_sale_returns r ON r.tenant_id = l.tenant_id AND r.id = l.sale_return_id
        WHERE l.tenant_id=? AND r.sale_id=? AND r.status NOT IN ${RETURN_LINE_CLAIM_STATUSES}`,
    ).all(scope.tenantId, input.saleId) as { sale_item_id: string }[]).map((row) => row.sale_item_id));

    const chosen: { item: ItemRow; condition: PhysicalCondition }[] = [];
    for (const line of input.lines) {
      const item = byNumber.get(line.lineNumber);
      if (item === undefined) return { kind: "LINE_NOT_FOUND" };
      if (CONDITIONS_WITHOUT_DESTINATION.has(line.physicalCondition)) return { kind: "CONDITION_NOT_SUPPORTED" };
      if (returnedBefore.has(item.id)) return { kind: "LINE_ALREADY_RETURNED" };
      chosen.push({ item, condition: line.physicalCondition });
    }

    // 5. Importes. Una línea vuelve entera, así que su valor es su total
    //    congelado: nada se recalcula (`DEC-006` §Refund). El ajuste de
    //    redondeo sólo se reproduce en la devolución que cierra la venta
    //    (`DEC-006` §Devolución completa); una parcial con ajuste no tiene
    //    regla de normalización fijada y se rechaza.
    const commercial = chosen.reduce((total, c) => total + scale6ToBigInt(c.item.line_total_amount), 0n);
    const tax = chosen.reduce((total, c) => total + scale6ToBigInt(c.item.tax_amount), 0n);
    const closesSale = returnedBefore.size + chosen.length === items.length;
    const saleAdjustment = scale6ToBigInt(sale.commercial_rounding_adjustment);
    if (!closesSale && saleAdjustment !== 0n) return { kind: "ROUNDING_SHARE_NOT_SUPPORTED" };
    const rounding = closesSale ? saleAdjustment : 0n;
    const refund = commercial + rounding;

    const alreadyRefunded = (this.database.native.prepare(
      "SELECT completed_amount FROM payments_refunds WHERE tenant_id=? AND payment_id=? AND status='COMPLETED'",
    ).all(scope.tenantId, payment.id) as { completed_amount: string }[])
      .reduce((total, row) => total + scale6ToBigInt(row.completed_amount), 0n);
    // Imposible por construcción —líneas enteras, cada una una sola vez—, pero
    // es la invariante que protege el dinero: nunca se devuelve más de lo
    // cobrado.
    if (alreadyRefunded + refund > scale6ToBigInt(allocation.amount)) {
      throw new Error(`refund would exceed confirmed payment ${payment.id}`);
    }

    // 6. Caja: sólo para efectivo. El turno abierto ahora en la caja nombrada.
    //    Una transferencia no toca caja (`UC-PAY-004`: «no genera salida de
    //    caja»); su fecha de negocio es la del día en que se ejecuta la
    //    devolución, porque no hay turno del que tomarla.
    const shift = refundMethod === "CASH"
      ? this.cash.findActiveShiftForRegister(scope, input.cashRegisterId as string)
      : null;
    if (refundMethod === "CASH") {
      if (shift === null) return { kind: "CASH_SHIFT_MISSING" };
      if (shift.status !== "OPEN") return { kind: "CASH_SHIFT_NOT_OPEN" };
    }
    const businessDate = refundMethod === "CASH"
      ? this.cash.shiftBusinessDate(scope, (shift as { shiftId: string }).shiftId)
      : nowIso.slice(0, 10);
    if (businessDate === null) return { kind: "CASH_SHIFT_MISSING" };

    // ── Escritura ────────────────────────────────────────────────────────────
    const saleReturnId = uuidV7();
    const refundId = uuidV7();
    const returnOperationId = uuidV7();
    const refundOperationId = uuidV7();
    const cashMovementId = uuidV7();
    const refundKey = `refund:${input.idempotencyKey}`;
    const commercialText = bigIntToScale6(commercial);
    const roundingText = bigIntToScale6(rounding);
    const refundText = bigIntToScale6(refund);

    this.insertOperation(returnOperationId, input.idempotencyKey, input.requestChecksum, "SALE_RETURN_COMPLETED", nowIso);
    this.insertOperation(refundOperationId, refundKey, input.requestChecksum, "REFUND_COMPLETED", nowIso);

    this.database.native.prepare(
      `INSERT INTO sales_sale_returns(
        id, tenant_id, company_id, branch_id, sale_id, origin_device_id,
        requested_by_actor_id, approved_by_actor_id, reason_code, reason_detail, status, effective_at,
        currency_code, original_sale_payable_amount, requested_return_amount, approved_return_amount,
        completed_return_amount, returned_tax_amount, returned_rounding_adjustment,
        pricing_pipeline_version, tax_policy_version, rounding_policy_version,
        operation_id, idempotency_key, request_checksum, expected_sale_version,
        correlation_id, causation_id, requested_at, approved_at, completed_at, created_at, updated_at, version
      ) VALUES (?,?,?,?,?,?,?,?,?,?,'RETURN_COMPLETED',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
    ).run(
      saleReturnId, scope.tenantId, scope.companyId, scope.branchId, input.saleId, scope.deviceId,
      input.operatorUserId, input.operatorUserId, input.reasonCode, input.reasonDetail, nowIso,
      sale.currency_code, sale.payable_amount, commercialText, commercialText,
      commercialText, bigIntToScale6(tax), roundingText,
      sale.pricing_pipeline_version, sale.tax_policy_version, sale.rounding_policy_version,
      returnOperationId, input.idempotencyKey, input.requestChecksum, sale.version,
      input.correlationId, input.causationId, nowIso, nowIso, nowIso, nowIso, nowIso,
    );

    const lineIds = new Map<string, string>();
    let restockedLines = 0;
    const restockByPresentation = new Map<string, bigint>();
    for (const { item, condition } of chosen) {
      const resolution = item.stock_controlled !== 1
        ? "NOT_STOCK_CONTROLLED"
        : condition === "RESTOCKABLE" ? "RETURN_TO_AVAILABLE" : "NO_RESTOCK";
      if (resolution === "RETURN_TO_AVAILABLE") {
        restockedLines += 1;
        restockByPresentation.set(
          item.presentation_id,
          (restockByPresentation.get(item.presentation_id) ?? 0n) + scale6ToBigInt(item.quantity),
        );
      }
      const lineId = uuidV7();
      lineIds.set(item.id, lineId);
      this.database.native.prepare(
        `INSERT INTO sales_sale_return_lines(
          id, tenant_id, sale_return_id, sale_item_id, presentation_id, lot_id, unit_id,
          sold_quantity_snapshot, previously_returned_quantity_snapshot, requested_quantity, approved_quantity,
          completed_quantity, physical_condition, inventory_resolution,
          original_unit_price, original_discount_amount, original_taxable_amount, original_tax_amount,
          original_line_total, requested_return_amount, approved_return_amount, completed_return_amount,
          returned_tax_amount, created_at
        ) VALUES (?,?,?,?,?,?,?,?,'0.000000',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        lineId, scope.tenantId, saleReturnId, item.id, item.presentation_id, item.lot_id, item.unit_id,
        item.quantity, item.quantity, item.quantity, item.quantity, condition, resolution,
        item.unit_price_amount, item.discount_amount, item.taxable_amount, item.tax_amount,
        item.line_total_amount, item.line_total_amount, item.line_total_amount, item.line_total_amount,
        item.tax_amount, nowIso,
      );
    }

    // El efectivo sale del turno abierto; si no alcanza, todo se deshace. La
    // transferencia no toca caja: queda `PROCESSING` hasta que un actor
    // segregado la confirme con evidencia (`payments.refund.confirm`).
    if (refundMethod === "CASH") {
      const cash = this.cash.appendCashRefund({
        scope,
        movementId: cashMovementId,
        cashShiftId: (shift as { shiftId: string }).shiftId,
        amount: refundText,
        currencyCode: sale.currency_code,
        operatorUserId: input.operatorUserId,
        businessDate,
        idempotencyKey: `cash_refund:${input.idempotencyKey}`,
        requestChecksum: input.requestChecksum,
        correlationId: input.correlationId,
        reasonCode: "SALE_RETURN",
      });
      if (cash.kind === "SHIFT_NOT_FOUND") throw new ReturnRollback({ kind: "CASH_SHIFT_MISSING" });
      if (cash.kind === "SHIFT_NOT_OPEN") throw new ReturnRollback({ kind: "CASH_SHIFT_NOT_OPEN" });
      if (cash.kind === "CURRENCY_MISMATCH") throw new ReturnRollback({ kind: "CURRENCY_MISMATCH" });
      if (cash.kind === "INSUFFICIENT_CASH") throw new ReturnRollback({ kind: "INSUFFICIENT_CASH" });
    }

    const refundStatus: "COMPLETED" | "PROCESSING" = refundMethod === "CASH" ? "COMPLETED" : "PROCESSING";
    this.database.native.prepare(
      `INSERT INTO payments_refunds(
        id, tenant_id, company_id, branch_id, payment_id, sale_return_id,
        commercial_refund_amount, refund_rounding_adjustment, requested_amount, completed_amount,
        currency_code, refund_method, status, cash_movement_id, reason_code,
        requested_by_actor_id, approved_by_actor_id, idempotency_key, request_checksum,
        correlation_id, causation_id, version, requested_at, approved_at, completed_at, server_recorded_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,NULL)`,
    ).run(
      refundId, scope.tenantId, scope.companyId, scope.branchId, payment.id, saleReturnId,
      commercialText, roundingText, refundText, refundStatus === "COMPLETED" ? refundText : "0.000000",
      sale.currency_code, refundMethod, refundStatus, refundMethod === "CASH" ? cashMovementId : null,
      input.reasonCode,
      input.operatorUserId, input.operatorUserId, refundKey, input.requestChecksum,
      input.correlationId, input.causationId, nowIso, nowIso, refundStatus === "COMPLETED" ? nowIso : null,
    );
    chosen.forEach(({ item }, index) => {
      this.database.native.prepare(
        `INSERT INTO payments_refund_items(
          id, tenant_id, refund_id, payment_allocation_id, sale_return_line_id,
          amount, currency_code, item_sequence, created_at
        ) VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run(
        uuidV7(), scope.tenantId, refundId, allocation.id, lineIds.get(item.id) as string,
        item.line_total_amount, sale.currency_code, index + 1, nowIso,
      );
    });

    for (const [presentationId, units] of restockByPresentation) {
      this.inventory.appendReturnRestock({
        scope,
        sessionId: input.sessionId,
        operatorUserId: input.operatorUserId,
        saleId: input.saleId,
        saleReturnId,
        presentationId,
        quantity: bigIntToScale6(units),
        businessDate,
        correlationId: input.correlationId,
        causationId: input.causationId,
      });
    }

    const fiscalCorrection = this.fiscalCorrection(scope, input.saleId);
    const returnDetails = {
      commercial_amount: commercialText,
      fiscal_correction: fiscalCorrection,
      lines: chosen.map(({ item, condition }) => ({ line_number: item.line_number, physical_condition: condition })),
      reason_code: input.reasonCode,
      rounding_adjustment: roundingText,
      sale_id: input.saleId,
      sale_return_id: saleReturnId,
    };
    const refundDetails: Record<string, unknown> = {
      amount: refundText,
      payment_id: payment.id,
      refund_id: refundId,
      refund_method: refundMethod,
      sale_return_id: saleReturnId,
    };
    if (refundMethod === "CASH") {
      refundDetails["cash_movement_id"] = cashMovementId;
      refundDetails["cash_shift_id"] = (shift as { shiftId: string }).shiftId;
    }
    const refundActionCode = refundStatus === "COMPLETED" ? "REFUND_COMPLETED" : "REFUND_PROCESSING_STARTED";
    this.writeAudit(input, "SALE_RETURN_COMPLETED", "SALE_RETURN", saleReturnId, returnDetails, nowIso);
    this.writeAudit(input, refundActionCode, "REFUND", refundId, refundDetails, nowIso);
    this.enqueue(input, returnOperationId, input.idempotencyKey, "SALE_RETURN", saleReturnId,
      "SALE_RETURN_COMPLETED", returnDetails, nowIso);
    this.enqueue(input, refundOperationId, refundKey, "REFUND", refundId, refundActionCode, refundDetails, nowIso);

    return {
      kind: "COMPLETED",
      saleReturnId,
      refundId,
      commercialAmount: commercialText,
      roundingAdjustment: roundingText,
      refundedAmount: refundText,
      restockedLines,
      fiscalCorrection,
      refundStatus,
    };
  }

  /** Lo que una devolución ya hecha respondió, reconstruido de lo que dejó escrito. */
  private readSummary(scope: SyncScope, idempotencyKey: string): SaleReturnSummary | null {
    const row = this.database.native.prepare(
      `SELECT r.id AS sale_return_id, r.sale_id, f.id AS refund_id, f.commercial_refund_amount,
              f.refund_rounding_adjustment, f.requested_amount, f.status,
              (SELECT count(*) FROM sales_sale_return_lines l
                WHERE l.tenant_id = r.tenant_id AND l.sale_return_id = r.id
                  AND l.inventory_resolution = 'RETURN_TO_AVAILABLE') AS restocked
         FROM sales_sale_returns r
         JOIN payments_refunds f ON f.tenant_id = r.tenant_id AND f.sale_return_id = r.id
        WHERE r.tenant_id=? AND r.idempotency_key=?`,
    ).get(scope.tenantId, idempotencyKey) as {
      sale_return_id: string; sale_id: string; refund_id: string; commercial_refund_amount: string;
      refund_rounding_adjustment: string; requested_amount: string; status: string; restocked: number;
    } | undefined;
    if (row === undefined) return null;
    return {
      saleReturnId: row.sale_return_id,
      refundId: row.refund_id,
      commercialAmount: row.commercial_refund_amount,
      roundingAdjustment: row.refund_rounding_adjustment,
      refundedAmount: row.requested_amount,
      restockedLines: row.restocked,
      fiscalCorrection: this.fiscalCorrection(scope, row.sale_id),
      refundStatus: row.status === "COMPLETED" ? "COMPLETED" : "PROCESSING",
    };
  }

  /**
   * Confirma un reembolso de transferencia pendiente — `UC-PAY-004`
   * §Reembolso de transferencia o QR manual, reglas 5–7: un actor **distinto**
   * del que solicitó la devolución declara la evidencia financiera que vio, y
   * sólo entonces el componente pasa a `COMPLETED`. No verifica esa evidencia
   * contra ningún banco — «no se inventa una API de Nequi, Daviplata, banco o
   * QR»—; registra quién la declaró, y por eso exige que no sea la misma
   * persona que inició la devolución.
   */
  confirmRefund(input: ConfirmRefundInput): ConfirmRefundOutcome {
    const nowIso = this.now().toISOString();
    return this.database.native.transaction((): ConfirmRefundOutcome => {
      const operation = this.database.native.prepare(
        "SELECT payload_checksum FROM runtime_operations WHERE idempotency_key=?",
      ).get(input.idempotencyKey) as { payload_checksum: string } | undefined;
      if (operation !== undefined) {
        if (operation.payload_checksum !== input.requestChecksum) return { kind: "IDEMPOTENCY_CONFLICT" };
        const row = this.database.native.prepare(
          "SELECT id, completed_amount FROM payments_refunds WHERE tenant_id=? AND id=? AND confirmed_by_actor_id=?",
        ).get(input.scope.tenantId, input.refundId, input.operatorUserId) as
          { id: string; completed_amount: string } | undefined;
        // La clave la consumió otra operación, o confirmó otro actor con el
        // mismo checksum por casualidad: ninguno es un reintento legítimo.
        if (row === undefined) return { kind: "IDEMPOTENCY_CONFLICT" };
        return { kind: "IDEMPOTENT", refundId: row.id, completedAmount: row.completed_amount };
      }

      const refund = this.database.native.prepare(
        `SELECT id, status, refund_method, requested_amount, requested_by_actor_id
           FROM payments_refunds WHERE tenant_id=? AND id=?`,
      ).get(input.scope.tenantId, input.refundId) as
        | { id: string; status: string; refund_method: string; requested_amount: string; requested_by_actor_id: string }
        | undefined;
      if (refund === undefined || refund.refund_method !== "TRANSFER") return { kind: "REFUND_NOT_FOUND" };
      if (refund.status !== "PROCESSING") return { kind: "REFUND_NOT_PENDING" };
      if (refund.requested_by_actor_id === input.operatorUserId) return { kind: "SAME_ACTOR_NOT_ALLOWED" };

      this.insertOperation(uuidV7(), input.idempotencyKey, input.requestChecksum, "REFUND_CONFIRMED", nowIso);
      this.database.native.prepare(
        `UPDATE payments_refunds
            SET status='COMPLETED', completed_amount=requested_amount, completed_at=?,
                provider_reference=?, destination_reference=?, confirmed_by_actor_id=?
          WHERE tenant_id=? AND id=?`,
      ).run(nowIso, input.providerReference, input.destinationReference, input.operatorUserId, input.scope.tenantId, refund.id);

      const details = {
        destination_reference: input.destinationReference,
        provider_reference: input.providerReference,
        refund_id: refund.id,
      };
      this.writeAuditEntry(input, "REFUND_CONFIRMED", "REFUND", refund.id, null, details, nowIso);
      this.enqueueOperation(
        input, uuidV7(), input.idempotencyKey, input.requestChecksum,
        "REFUND", refund.id, "REFUND_CONFIRMED", details, nowIso,
      );

      return { kind: "CONFIRMED", refundId: refund.id, completedAmount: refund.requested_amount };
    })();
  }

  /**
   * Si la venta tiene un documento electrónico vivo, la devolución exige una
   * corrección fiscal que todavía no existe. Se lee, no se decide aquí:
   * `sale-return-schema.md` §Fiscal deja el tipo de documento a Electronic
   * Invoicing.
   */
  private fiscalCorrection(scope: SyncScope, saleId: string): "NO_FISCAL_DOCUMENT" | "REQUIRED_NOT_AVAILABLE" {
    const document = this.database.native.prepare(
      `SELECT 1 AS found FROM fiscal_electronic_document
        WHERE tenant_id=? AND sale_id=? AND transport_status <> 'CANCELLED' LIMIT 1`,
    ).get(scope.tenantId, saleId) as { found: number } | undefined;
    return document === undefined ? "NO_FISCAL_DOCUMENT" : "REQUIRED_NOT_AVAILABLE";
  }

  private insertOperation(operationId: string, idempotencyKey: string, checksum: string, resultCode: string, nowIso: string): void {
    this.database.native.prepare(
      `INSERT INTO runtime_operations(operation_id, idempotency_key, payload_checksum, status, result_code, created_at, updated_at)
       VALUES (?,?,?,'SUCCEEDED',?,?,?)`,
    ).run(operationId, idempotencyKey, checksum, resultCode, nowIso, nowIso);
  }

  private writeAudit(
    input: CreateSaleReturnInput, actionCode: string, resourceType: string, resourceId: string,
    details: Record<string, unknown>, nowIso: string,
  ): void {
    this.writeAuditEntry(input, actionCode, resourceType, resourceId, input.reasonCode, details, nowIso);
  }

  private enqueue(
    input: CreateSaleReturnInput, operationId: string, idempotencyKey: string,
    aggregateType: string, aggregateId: string, operationType: string,
    payload: Record<string, unknown>, nowIso: string,
  ): void {
    this.enqueueOperation(
      input, operationId, idempotencyKey, input.requestChecksum,
      aggregateType, aggregateId, operationType, payload, nowIso,
    );
  }

  /** Contexto mínimo común a toda operación de este store, para auditoría y outbox. */
  private writeAuditEntry(
    ctx: {
      readonly scope: SyncScope; readonly sessionId: string; readonly operatorUserId: string;
      readonly correlationId: string; readonly causationId: string | null;
    },
    actionCode: string, resourceType: string, resourceId: string, reasonCode: string | null,
    details: Record<string, unknown>, nowIso: string,
  ): void {
    this.database.native.prepare(
      `INSERT INTO local_operation_audit(
        tenant_id, company_id, branch_id, device_id,
        actor_type, actor_id, session_id,
        action_code, resource_type, resource_id,
        correlation_id, causation_id, reason_code, details_json, created_at
      ) VALUES (?,?,?,?,'USER',?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      ctx.scope.tenantId, ctx.scope.companyId, ctx.scope.branchId, ctx.scope.deviceId,
      ctx.operatorUserId, ctx.sessionId, actionCode, resourceType, resourceId,
      ctx.correlationId, ctx.causationId, reasonCode, canonicalJson(details), nowIso,
    );
  }

  private enqueueOperation(
    ctx: {
      readonly scope: SyncScope; readonly sessionId: string; readonly operatorUserId: string;
      readonly correlationId: string; readonly causationId: string | null;
    },
    operationId: string, idempotencyKey: string, requestChecksum: string,
    aggregateType: string, aggregateId: string, operationType: string,
    payload: Record<string, unknown>, nowIso: string,
  ): void {
    const { scope } = ctx;
    const nextSequence = (this.database.native.prepare(
      `SELECT COALESCE(MAX(local_sequence), 0) + 1 AS next_sequence FROM local_sync_outbox
       WHERE tenant_id=? AND company_id=? AND branch_id=? AND device_id=? AND installation_id=?`,
    ).get(scope.tenantId, scope.companyId, scope.branchId, scope.deviceId, scope.installationId) as
      { next_sequence: number }).next_sequence;

    this.durableSync.enqueue({
      operation_id: operationId,
      tenant_id: scope.tenantId,
      company_id: scope.companyId,
      branch_id: scope.branchId,
      device_id: scope.deviceId,
      installation_id: scope.installationId,
      session_id: ctx.sessionId,
      actor_id: ctx.operatorUserId,
      aggregate_type: aggregateType,
      aggregate_id: aggregateId,
      operation_type: operationType,
      authority_policy: "LOCAL_AUTHORITATIVE_UNTIL_SYNC",
      local_sequence: nextSequence,
      idempotency_key: idempotencyKey,
      expected_version: null,
      payload_schema_version: RETURN_PAYLOAD_SCHEMA_VERSION,
      payload,
      payload_checksum: requestChecksum,
      causation_id: ctx.causationId,
      correlation_id: ctx.correlationId,
      occurred_at_local: nowIso,
      recorded_at_local: nowIso,
    });
  }

  // ── sales.return.request / .approve / .execute — `D-50` ─────────────────────

  requestReturn(input: RequestSaleReturnInput): RequestSaleReturnOutcome {
    return this.database.native.transaction((): RequestSaleReturnOutcome => this.requestInTransaction(input))();
  }

  private requestInTransaction(input: RequestSaleReturnInput): RequestSaleReturnOutcome {
    const { scope } = input;
    const nowIso = this.now().toISOString();

    const operation = this.database.native.prepare(
      "SELECT payload_checksum FROM runtime_operations WHERE idempotency_key=?",
    ).get(input.idempotencyKey) as { payload_checksum: string } | undefined;
    if (operation !== undefined) {
      if (operation.payload_checksum !== input.requestChecksum) return { kind: "IDEMPOTENCY_CONFLICT" };
      const row = this.database.native.prepare(
        "SELECT id, requested_return_amount FROM sales_sale_returns WHERE tenant_id=? AND idempotency_key=?",
      ).get(scope.tenantId, input.idempotencyKey) as { id: string; requested_return_amount: string } | undefined;
      if (row === undefined) return { kind: "IDEMPOTENCY_CONFLICT" };
      return { kind: "IDEMPOTENT", saleReturnId: row.id, requestedAmount: row.requested_return_amount };
    }

    const sale = this.database.native.prepare(
      `SELECT company_id, branch_id, status, currency_code, payable_amount, commercial_rounding_adjustment,
              pricing_pipeline_version, tax_policy_version, rounding_policy_version, version
         FROM sales_sales WHERE tenant_id=? AND id=?`,
    ).get(scope.tenantId, input.saleId) as SaleRow | undefined;
    if (sale === undefined || sale.company_id !== scope.companyId || sale.branch_id !== scope.branchId) {
      return { kind: "SALE_NOT_FOUND" };
    }
    if (sale.status !== "COMPLETED") return { kind: "SALE_NOT_COMPLETED" };

    // Elegibilidad de reembolso: se comprueba ahora para no aceptar una
    // solicitud que `execute` no podría cumplir nunca. El pago de una venta
    // ya `COMPLETED` no cambia después, así que no hace falta repetir esto en
    // `execute` — sólo redescubrir *cuál* es, porque el store no lo recuerda
    // entre operaciones.
    const payments = this.database.native.prepare(
      `SELECT p.id, p.payment_method, p.status FROM payments_payments p
         JOIN payments_payment_groups g ON g.tenant_id = p.tenant_id AND g.id = p.payment_group_id
        WHERE p.tenant_id=? AND g.collection_subject_type='SALE' AND g.collection_subject_id=?
          AND p.status NOT IN ('CANCELLED','FAILED')`,
    ).all(scope.tenantId, input.saleId) as { id: string; payment_method: string; status: string }[];
    const payment = payments[0];
    if (payments.length !== 1 || payment === undefined
      || (payment.payment_method !== "CASH" && payment.payment_method !== "TRANSFER")
      || payment.status !== "CONFIRMED") {
      return { kind: "REFUND_METHOD_NOT_SUPPORTED" };
    }
    const allocations = this.database.native.prepare(
      "SELECT id FROM payments_payment_allocations WHERE tenant_id=? AND payment_id=?",
    ).all(scope.tenantId, payment.id) as { id: string }[];
    if (allocations.length !== 1) return { kind: "REFUND_METHOD_NOT_SUPPORTED" };

    const items = this.database.native.prepare(
      `SELECT i.id, i.line_number, i.presentation_id, i.lot_id, i.unit_id, i.quantity, i.unit_price_amount,
              i.discount_amount, i.taxable_amount, i.tax_amount, i.line_total_amount, p.stock_controlled
         FROM sales_sale_items i
         JOIN catalog_product p ON p.tenant_id = i.tenant_id AND p.id = i.product_id
        WHERE i.tenant_id=? AND i.sale_id=?`,
    ).all(scope.tenantId, input.saleId) as ItemRow[];
    const byNumber = new Map(items.map((item) => [item.line_number, item]));
    const claimed = new Set((this.database.native.prepare(
      `SELECT l.sale_item_id FROM sales_sale_return_lines l
         JOIN sales_sale_returns r ON r.tenant_id = l.tenant_id AND r.id = l.sale_return_id
        WHERE l.tenant_id=? AND r.sale_id=? AND r.status NOT IN ${RETURN_LINE_CLAIM_STATUSES}`,
    ).all(scope.tenantId, input.saleId) as { sale_item_id: string }[]).map((row) => row.sale_item_id));

    const chosen: { item: ItemRow; condition: PhysicalCondition }[] = [];
    for (const line of input.lines) {
      const item = byNumber.get(line.lineNumber);
      if (item === undefined) return { kind: "LINE_NOT_FOUND" };
      if (CONDITIONS_WITHOUT_DESTINATION.has(line.physicalCondition)) return { kind: "CONDITION_NOT_SUPPORTED" };
      if (claimed.has(item.id)) return { kind: "LINE_ALREADY_RETURNED" };
      chosen.push({ item, condition: line.physicalCondition });
    }

    const commercial = chosen.reduce((total, c) => total + scale6ToBigInt(c.item.line_total_amount), 0n);
    const tax = chosen.reduce((total, c) => total + scale6ToBigInt(c.item.tax_amount), 0n);
    const closesSale = claimed.size + chosen.length === items.length;
    const saleAdjustment = scale6ToBigInt(sale.commercial_rounding_adjustment);
    if (!closesSale && saleAdjustment !== 0n) return { kind: "ROUNDING_SHARE_NOT_SUPPORTED" };
    const rounding = closesSale ? saleAdjustment : 0n;
    const commercialText = bigIntToScale6(commercial);
    const roundingText = bigIntToScale6(rounding);

    const saleReturnId = uuidV7();
    const returnOperationId = uuidV7();
    this.insertOperation(returnOperationId, input.idempotencyKey, input.requestChecksum, "SALE_RETURN_REQUESTED", nowIso);

    this.database.native.prepare(
      `INSERT INTO sales_sale_returns(
        id, tenant_id, company_id, branch_id, sale_id, origin_device_id,
        requested_by_actor_id, approved_by_actor_id, reason_code, reason_detail, status, effective_at,
        currency_code, original_sale_payable_amount, requested_return_amount, approved_return_amount,
        completed_return_amount, returned_tax_amount, returned_rounding_adjustment,
        pricing_pipeline_version, tax_policy_version, rounding_policy_version,
        operation_id, idempotency_key, request_checksum, expected_sale_version,
        correlation_id, causation_id, requested_at, approved_at, completed_at, created_at, updated_at, version
      ) VALUES (?,?,?,?,?,?,?,NULL,?,?,'RETURN_REQUESTED',?,?,?,?,NULL,'0.000000',?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,?,?,1)`,
    ).run(
      saleReturnId, scope.tenantId, scope.companyId, scope.branchId, input.saleId, scope.deviceId,
      input.operatorUserId, input.reasonCode, input.reasonDetail, nowIso,
      sale.currency_code, sale.payable_amount, commercialText,
      bigIntToScale6(tax), roundingText,
      sale.pricing_pipeline_version, sale.tax_policy_version, sale.rounding_policy_version,
      returnOperationId, input.idempotencyKey, input.requestChecksum, sale.version,
      input.correlationId, input.causationId, nowIso, nowIso, nowIso,
    );

    for (const { item, condition } of chosen) {
      const resolution = item.stock_controlled !== 1
        ? "NOT_STOCK_CONTROLLED"
        : condition === "RESTOCKABLE" ? "RETURN_TO_AVAILABLE" : "NO_RESTOCK";
      this.database.native.prepare(
        `INSERT INTO sales_sale_return_lines(
          id, tenant_id, sale_return_id, sale_item_id, presentation_id, lot_id, unit_id,
          sold_quantity_snapshot, previously_returned_quantity_snapshot, requested_quantity, approved_quantity,
          completed_quantity, physical_condition, inventory_resolution,
          original_unit_price, original_discount_amount, original_taxable_amount, original_tax_amount,
          original_line_total, requested_return_amount, approved_return_amount, completed_return_amount,
          returned_tax_amount, created_at
        ) VALUES (?,?,?,?,?,?,?,?,'0.000000',?,NULL,'0.000000',?,?,?,?,?,?,?,?,NULL,'0.000000',?,?)`,
      ).run(
        uuidV7(), scope.tenantId, saleReturnId, item.id, item.presentation_id, item.lot_id, item.unit_id,
        item.quantity, item.quantity, condition, resolution,
        item.unit_price_amount, item.discount_amount, item.taxable_amount, item.tax_amount,
        item.line_total_amount, item.line_total_amount,
        item.tax_amount, nowIso,
      );
    }

    const details = {
      commercial_amount: commercialText, reason_code: input.reasonCode, rounding_adjustment: roundingText,
      sale_id: input.saleId, sale_return_id: saleReturnId,
    };
    this.writeAuditEntry(input, "SALE_RETURN_REQUESTED", "SALE_RETURN", saleReturnId, input.reasonCode, details, nowIso);
    this.enqueueOperation(
      input, returnOperationId, input.idempotencyKey, input.requestChecksum,
      "SALE_RETURN", saleReturnId, "SALE_RETURN_REQUESTED", details, nowIso,
    );

    return { kind: "REQUESTED", saleReturnId, requestedAmount: commercialText };
  }

  approveReturn(input: ApproveSaleReturnInput): ApproveSaleReturnOutcome {
    const nowIso = this.now().toISOString();
    return this.database.native.transaction((): ApproveSaleReturnOutcome => {
      const operation = this.database.native.prepare(
        "SELECT payload_checksum FROM runtime_operations WHERE idempotency_key=?",
      ).get(input.idempotencyKey) as { payload_checksum: string } | undefined;
      if (operation !== undefined) {
        if (operation.payload_checksum !== input.requestChecksum) return { kind: "IDEMPOTENCY_CONFLICT" };
        const row = this.database.native.prepare(
          "SELECT id FROM sales_sale_returns WHERE tenant_id=? AND id=? AND approved_by_actor_id=?",
        ).get(input.scope.tenantId, input.saleReturnId, input.operatorUserId) as { id: string } | undefined;
        if (row === undefined) return { kind: "IDEMPOTENCY_CONFLICT" };
        return { kind: "IDEMPOTENT", saleReturnId: row.id };
      }

      const ret = this.database.native.prepare(
        "SELECT id, status, requested_return_amount FROM sales_sale_returns WHERE tenant_id=? AND id=?",
      ).get(input.scope.tenantId, input.saleReturnId) as
        { id: string; status: string; requested_return_amount: string } | undefined;
      if (ret === undefined) return { kind: "RETURN_NOT_FOUND" };
      if (ret.status !== "RETURN_REQUESTED") return { kind: "RETURN_NOT_PENDING" };

      this.insertOperation(uuidV7(), input.idempotencyKey, input.requestChecksum, "SALE_RETURN_APPROVED", nowIso);
      this.database.native.prepare(
        `UPDATE sales_sale_returns
            SET status='RETURN_APPROVED', approved_by_actor_id=?, approved_at=?,
                approved_return_amount=requested_return_amount, updated_at=?
          WHERE tenant_id=? AND id=?`,
      ).run(input.operatorUserId, nowIso, nowIso, input.scope.tenantId, ret.id);
      // `sales_sale_return_lines` es append-only (no admite `UPDATE`): la
      // aprobación es binaria y no ajusta cantidades, así que lo que se pidió
      // en `requested_quantity`/`requested_return_amount` —ya congelado— seguirá
      // siendo lo aprobado. `approved_quantity`/`approved_return_amount` por
      // línea quedan `NULL` para siempre; la autoridad de la aprobación vive en
      // la cabecera (`sales_sale_returns.approved_return_amount`).

      const details = { requested_return_amount: ret.requested_return_amount, sale_return_id: ret.id };
      this.writeAuditEntry(input, "SALE_RETURN_APPROVED", "SALE_RETURN", ret.id, null, details, nowIso);
      this.enqueueOperation(
        input, uuidV7(), input.idempotencyKey, input.requestChecksum,
        "SALE_RETURN", ret.id, "SALE_RETURN_APPROVED", details, nowIso,
      );

      return { kind: "APPROVED", saleReturnId: ret.id };
    })();
  }

  executeReturn(input: ExecuteSaleReturnInput): ExecuteSaleReturnOutcome {
    try {
      return this.database.native.transaction((): ExecuteSaleReturnOutcome => this.executeInTransaction(input))();
    } catch (thrown) {
      if (thrown instanceof ExecuteRollback) return thrown.outcome;
      throw thrown;
    }
  }

  private executeInTransaction(input: ExecuteSaleReturnInput): ExecuteSaleReturnOutcome {
    const { scope } = input;
    const nowIso = this.now().toISOString();

    const operation = this.database.native.prepare(
      "SELECT payload_checksum FROM runtime_operations WHERE idempotency_key=?",
    ).get(input.idempotencyKey) as { payload_checksum: string } | undefined;
    if (operation !== undefined) {
      if (operation.payload_checksum !== input.requestChecksum) return { kind: "IDEMPOTENCY_CONFLICT" };
      const replay = this.readExecutedSummary(scope, input.idempotencyKey);
      if (replay === null) return { kind: "IDEMPOTENCY_CONFLICT" };
      return { kind: "IDEMPOTENT", ...replay };
    }

    const ret = this.database.native.prepare(
      `SELECT id, sale_id, reason_code FROM sales_sale_returns WHERE tenant_id=? AND id=? AND status='RETURN_APPROVED'`,
    ).get(scope.tenantId, input.saleReturnId) as { id: string; sale_id: string; reason_code: string } | undefined;
    if (ret === undefined) {
      const exists = this.database.native.prepare(
        "SELECT 1 AS found FROM sales_sale_returns WHERE tenant_id=? AND id=?",
      ).get(scope.tenantId, input.saleReturnId) as { found: number } | undefined;
      return exists === undefined ? { kind: "RETURN_NOT_FOUND" } : { kind: "RETURN_NOT_APPROVED" };
    }

    const sale = this.database.native.prepare(
      `SELECT currency_code FROM sales_sales WHERE tenant_id=? AND id=?`,
    ).get(scope.tenantId, ret.sale_id) as { currency_code: string };

    const payments = this.database.native.prepare(
      `SELECT p.id, p.payment_method FROM payments_payments p
         JOIN payments_payment_groups g ON g.tenant_id = p.tenant_id AND g.id = p.payment_group_id
        WHERE p.tenant_id=? AND g.collection_subject_type='SALE' AND g.collection_subject_id=?
          AND p.status NOT IN ('CANCELLED','FAILED')`,
    ).all(scope.tenantId, ret.sale_id) as { id: string; payment_method: string }[];
    const payment = payments[0];
    if (payments.length !== 1 || payment === undefined
      || (payment.payment_method !== "CASH" && payment.payment_method !== "TRANSFER")) {
      return { kind: "REFUND_METHOD_NOT_SUPPORTED" };
    }
    const refundMethod = payment.payment_method as "CASH" | "TRANSFER";
    if (refundMethod === "CASH" && input.cashRegisterId === null) return { kind: "CASH_REGISTER_REQUIRED" };
    const allocation = this.database.native.prepare(
      "SELECT id FROM payments_payment_allocations WHERE tenant_id=? AND payment_id=?",
    ).get(scope.tenantId, payment.id) as { id: string } | undefined;
    if (allocation === undefined) return { kind: "REFUND_METHOD_NOT_SUPPORTED" };

    // `requested_quantity`, no `approved_quantity`: la línea se congeló entera
    // en `sales.return.request` y la tabla es append-only (no admite
    // `UPDATE`), así que `approved_quantity` se queda `NULL` para siempre —
    // ver la nota en `approveReturn`. La aprobación es binaria y no ajusta
    // cantidades, de modo que lo pedido es exactamente lo aprobado.
    const lines = this.database.native.prepare(
      `SELECT id, sale_item_id, presentation_id, physical_condition, inventory_resolution,
              requested_quantity, original_line_total, returned_tax_amount
         FROM sales_sale_return_lines WHERE tenant_id=? AND sale_return_id=?`,
    ).all(scope.tenantId, ret.id) as {
      id: string; sale_item_id: string; presentation_id: string; physical_condition: string;
      inventory_resolution: string; requested_quantity: string; original_line_total: string;
      returned_tax_amount: string;
    }[];

    const commercial = lines.reduce((total, l) => total + scale6ToBigInt(l.original_line_total), 0n);
    const returnRow = this.database.native.prepare(
      "SELECT returned_rounding_adjustment FROM sales_sale_returns WHERE tenant_id=? AND id=?",
    ).get(scope.tenantId, ret.id) as { returned_rounding_adjustment: string };
    const rounding = scale6ToBigInt(returnRow.returned_rounding_adjustment);
    const refund = commercial + rounding;
    const commercialText = bigIntToScale6(commercial);
    const roundingText = bigIntToScale6(rounding);
    const refundText = bigIntToScale6(refund);

    const shift = refundMethod === "CASH"
      ? this.cash.findActiveShiftForRegister(scope, input.cashRegisterId as string)
      : null;
    if (refundMethod === "CASH") {
      if (shift === null) return { kind: "CASH_SHIFT_MISSING" };
      if (shift.status !== "OPEN") return { kind: "CASH_SHIFT_NOT_OPEN" };
    }
    const businessDate = refundMethod === "CASH"
      ? this.cash.shiftBusinessDate(scope, (shift as { shiftId: string }).shiftId)
      : nowIso.slice(0, 10);
    if (businessDate === null) return { kind: "CASH_SHIFT_MISSING" };

    const refundId = uuidV7();
    const returnOperationId = uuidV7();
    const refundOperationId = uuidV7();
    const cashMovementId = uuidV7();
    const refundKey = `refund:${input.idempotencyKey}`;

    this.insertOperation(returnOperationId, input.idempotencyKey, input.requestChecksum, "SALE_RETURN_COMPLETED", nowIso);
    this.insertOperation(refundOperationId, refundKey, input.requestChecksum, "REFUND_COMPLETED", nowIso);

    this.database.native.prepare(
      `UPDATE sales_sale_returns
          SET status='RETURN_COMPLETED', completed_return_amount=?, completed_at=?, updated_at=?
        WHERE tenant_id=? AND id=?`,
    ).run(commercialText, nowIso, nowIso, scope.tenantId, ret.id);
    // Sin `UPDATE` a `sales_sale_return_lines`: es append-only. `completed_quantity`/
    // `completed_return_amount` por línea se quedan en su valor de solicitud
    // ('0.000000'/`NULL` según la columna) para siempre; la finalización real
    // vive en la cabecera (`sales_sale_returns.status='RETURN_COMPLETED'`).

    let restockedLines = 0;
    const restockByPresentation = new Map<string, bigint>();
    for (const line of lines) {
      if (line.inventory_resolution === "RETURN_TO_AVAILABLE") {
        restockedLines += 1;
        restockByPresentation.set(
          line.presentation_id,
          (restockByPresentation.get(line.presentation_id) ?? 0n) + scale6ToBigInt(line.requested_quantity),
        );
      }
    }

    if (refundMethod === "CASH") {
      const cash = this.cash.appendCashRefund({
        scope, movementId: cashMovementId, cashShiftId: (shift as { shiftId: string }).shiftId,
        amount: refundText, currencyCode: sale.currency_code, operatorUserId: input.operatorUserId,
        businessDate, idempotencyKey: `cash_refund:${input.idempotencyKey}`,
        requestChecksum: input.requestChecksum, correlationId: input.correlationId, reasonCode: "SALE_RETURN",
      });
      if (cash.kind === "SHIFT_NOT_FOUND") throw new ExecuteRollback({ kind: "CASH_SHIFT_MISSING" });
      if (cash.kind === "SHIFT_NOT_OPEN") throw new ExecuteRollback({ kind: "CASH_SHIFT_NOT_OPEN" });
      if (cash.kind === "CURRENCY_MISMATCH") throw new ExecuteRollback({ kind: "CURRENCY_MISMATCH" });
      if (cash.kind === "INSUFFICIENT_CASH") throw new ExecuteRollback({ kind: "INSUFFICIENT_CASH" });
    }

    const refundStatus: "COMPLETED" | "PROCESSING" = refundMethod === "CASH" ? "COMPLETED" : "PROCESSING";
    this.database.native.prepare(
      `INSERT INTO payments_refunds(
        id, tenant_id, company_id, branch_id, payment_id, sale_return_id,
        commercial_refund_amount, refund_rounding_adjustment, requested_amount, completed_amount,
        currency_code, refund_method, status, cash_movement_id, reason_code,
        requested_by_actor_id, approved_by_actor_id, idempotency_key, request_checksum,
        correlation_id, causation_id, version, requested_at, approved_at, completed_at, server_recorded_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,NULL)`,
    ).run(
      refundId, scope.tenantId, scope.companyId, scope.branchId, payment.id, ret.id,
      commercialText, roundingText, refundText, refundStatus === "COMPLETED" ? refundText : "0.000000",
      sale.currency_code, refundMethod, refundStatus, refundMethod === "CASH" ? cashMovementId : null,
      ret.reason_code,
      input.operatorUserId, input.operatorUserId, refundKey, input.requestChecksum,
      input.correlationId, input.causationId, nowIso, nowIso, refundStatus === "COMPLETED" ? nowIso : null,
    );
    lines.forEach((line, index) => {
      this.database.native.prepare(
        `INSERT INTO payments_refund_items(
          id, tenant_id, refund_id, payment_allocation_id, sale_return_line_id,
          amount, currency_code, item_sequence, created_at
        ) VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run(
        uuidV7(), scope.tenantId, refundId, (allocation as { id: string }).id, line.id,
        line.original_line_total, sale.currency_code, index + 1, nowIso,
      );
    });

    for (const [presentationId, units] of restockByPresentation) {
      this.inventory.appendReturnRestock({
        scope, sessionId: input.sessionId, operatorUserId: input.operatorUserId, saleId: ret.sale_id,
        saleReturnId: ret.id, presentationId, quantity: bigIntToScale6(units), businessDate,
        correlationId: input.correlationId, causationId: input.causationId,
      });
    }

    const fiscalCorrection = this.fiscalCorrection(scope, ret.sale_id);
    const returnDetails = {
      commercial_amount: commercialText, fiscal_correction: fiscalCorrection,
      rounding_adjustment: roundingText, sale_id: ret.sale_id, sale_return_id: ret.id,
    };
    const refundDetails: Record<string, unknown> = {
      amount: refundText, payment_id: payment.id, refund_id: refundId, refund_method: refundMethod,
      sale_return_id: ret.id,
    };
    if (refundMethod === "CASH") {
      refundDetails["cash_movement_id"] = cashMovementId;
      refundDetails["cash_shift_id"] = (shift as { shiftId: string }).shiftId;
    }
    const refundActionCode = refundStatus === "COMPLETED" ? "REFUND_COMPLETED" : "REFUND_PROCESSING_STARTED";
    this.writeAuditEntry(input, "SALE_RETURN_COMPLETED", "SALE_RETURN", ret.id, null, returnDetails, nowIso);
    this.writeAuditEntry(input, refundActionCode, "REFUND", refundId, null, refundDetails, nowIso);
    this.enqueueOperation(
      input, returnOperationId, input.idempotencyKey, input.requestChecksum,
      "SALE_RETURN", ret.id, "SALE_RETURN_COMPLETED", returnDetails, nowIso,
    );
    this.enqueueOperation(
      input, refundOperationId, refundKey, input.requestChecksum,
      "REFUND", refundId, refundActionCode, refundDetails, nowIso,
    );

    return {
      kind: "COMPLETED", saleReturnId: ret.id, refundId, commercialAmount: commercialText,
      roundingAdjustment: roundingText, refundedAmount: refundText, restockedLines, fiscalCorrection, refundStatus,
    };
  }

  /**
   * Lo que una ejecución ya hecha respondió, reconstruido de lo que dejó
   * escrito. **No busca por `sales_sale_returns.idempotency_key`**: esa
   * columna guarda la clave de la *solicitud* (`sales.return.request`), no la
   * de esta ejecución. La clave de `execute` sólo queda en el reembolso, con
   * el mismo prefijo `refund:` que usa `create()`.
   */
  private readExecutedSummary(scope: SyncScope, idempotencyKey: string): SaleReturnSummary | null {
    const row = this.database.native.prepare(
      `SELECT r.id AS sale_return_id, r.sale_id, f.id AS refund_id, f.commercial_refund_amount,
              f.refund_rounding_adjustment, f.requested_amount, f.status,
              (SELECT count(*) FROM sales_sale_return_lines l
                WHERE l.tenant_id = r.tenant_id AND l.sale_return_id = r.id
                  AND l.inventory_resolution = 'RETURN_TO_AVAILABLE') AS restocked
         FROM payments_refunds f
         JOIN sales_sale_returns r ON r.tenant_id = f.tenant_id AND r.id = f.sale_return_id
        WHERE f.tenant_id=? AND f.idempotency_key=?`,
    ).get(scope.tenantId, `refund:${idempotencyKey}`) as {
      sale_return_id: string; sale_id: string; refund_id: string; commercial_refund_amount: string;
      refund_rounding_adjustment: string; requested_amount: string; status: string; restocked: number;
    } | undefined;
    if (row === undefined) return null;
    return {
      saleReturnId: row.sale_return_id,
      refundId: row.refund_id,
      commercialAmount: row.commercial_refund_amount,
      roundingAdjustment: row.refund_rounding_adjustment,
      refundedAmount: row.requested_amount,
      restockedLines: row.restocked,
      fiscalCorrection: this.fiscalCorrection(scope, row.sale_id),
      refundStatus: row.status === "COMPLETED" ? "COMPLETED" : "PROCESSING",
    };
  }
}
