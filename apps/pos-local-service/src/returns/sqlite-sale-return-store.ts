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
  readonly cashRegisterId: string;
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
  | { readonly kind: "CASH_SHIFT_MISSING" }
  | { readonly kind: "CASH_SHIFT_NOT_OPEN" }
  | { readonly kind: "CURRENCY_MISMATCH" }
  | { readonly kind: "INSUFFICIENT_CASH" };

type Rejection = Exclude<CreateSaleReturnOutcome, { readonly kind: "COMPLETED" | "IDEMPOTENT" }>;

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

    // 3. Un único pago en efectivo confirmado, con una sola imputación.
    const payments = this.database.native.prepare(
      `SELECT p.id, p.payment_method, p.status FROM payments_payments p
         JOIN payments_payment_groups g ON g.tenant_id = p.tenant_id AND g.id = p.payment_group_id
        WHERE p.tenant_id=? AND g.collection_subject_type='SALE' AND g.collection_subject_id=?
          AND p.status NOT IN ('CANCELLED','FAILED')`,
    ).all(scope.tenantId, input.saleId) as { id: string; payment_method: string; status: string }[];
    const payment = payments[0];
    if (payments.length !== 1 || payment === undefined
      || payment.payment_method !== "CASH" || payment.status !== "CONFIRMED") {
      return { kind: "REFUND_METHOD_NOT_SUPPORTED" };
    }
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
        WHERE l.tenant_id=? AND r.sale_id=? AND r.status IN ('RETURN_COMPLETED','RETURN_PARTIALLY_COMPLETED')`,
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

    // 6. Caja: el turno abierto ahora en la caja nombrada.
    const shift = this.cash.findActiveShiftForRegister(scope, input.cashRegisterId);
    if (shift === null) return { kind: "CASH_SHIFT_MISSING" };
    if (shift.status !== "OPEN") return { kind: "CASH_SHIFT_NOT_OPEN" };
    const businessDate = this.cash.shiftBusinessDate(scope, shift.shiftId);
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

    // El efectivo sale del turno abierto; si no alcanza, todo se deshace.
    const cash = this.cash.appendCashRefund({
      scope,
      movementId: cashMovementId,
      cashShiftId: shift.shiftId,
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

    this.database.native.prepare(
      `INSERT INTO payments_refunds(
        id, tenant_id, company_id, branch_id, payment_id, sale_return_id,
        commercial_refund_amount, refund_rounding_adjustment, requested_amount, completed_amount,
        currency_code, refund_method, status, cash_movement_id, reason_code,
        requested_by_actor_id, approved_by_actor_id, idempotency_key, request_checksum,
        correlation_id, causation_id, version, requested_at, approved_at, completed_at, server_recorded_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,'CASH','COMPLETED',?,?,?,?,?,?,?,?,1,?,?,?,NULL)`,
    ).run(
      refundId, scope.tenantId, scope.companyId, scope.branchId, payment.id, saleReturnId,
      commercialText, roundingText, refundText, refundText,
      sale.currency_code, cashMovementId, input.reasonCode,
      input.operatorUserId, input.operatorUserId, refundKey, input.requestChecksum,
      input.correlationId, input.causationId, nowIso, nowIso, nowIso,
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
    const refundDetails = {
      amount: refundText,
      cash_movement_id: cashMovementId,
      cash_shift_id: shift.shiftId,
      payment_id: payment.id,
      refund_id: refundId,
      sale_return_id: saleReturnId,
    };
    this.writeAudit(input, "SALE_RETURN_COMPLETED", "SALE_RETURN", saleReturnId, returnDetails, nowIso);
    this.writeAudit(input, "REFUND_COMPLETED", "REFUND", refundId, refundDetails, nowIso);
    this.enqueue(input, returnOperationId, input.idempotencyKey, "SALE_RETURN", saleReturnId,
      "SALE_RETURN_COMPLETED", returnDetails, nowIso);
    this.enqueue(input, refundOperationId, refundKey, "REFUND", refundId, "REFUND_COMPLETED", refundDetails, nowIso);

    return {
      kind: "COMPLETED",
      saleReturnId,
      refundId,
      commercialAmount: commercialText,
      roundingAdjustment: roundingText,
      refundedAmount: refundText,
      restockedLines,
      fiscalCorrection,
    };
  }

  /** Lo que una devolución ya hecha respondió, reconstruido de lo que dejó escrito. */
  private readSummary(scope: SyncScope, idempotencyKey: string): SaleReturnSummary | null {
    const row = this.database.native.prepare(
      `SELECT r.id AS sale_return_id, r.sale_id, f.id AS refund_id, f.commercial_refund_amount,
              f.refund_rounding_adjustment, f.completed_amount,
              (SELECT count(*) FROM sales_sale_return_lines l
                WHERE l.tenant_id = r.tenant_id AND l.sale_return_id = r.id
                  AND l.inventory_resolution = 'RETURN_TO_AVAILABLE') AS restocked
         FROM sales_sale_returns r
         JOIN payments_refunds f ON f.tenant_id = r.tenant_id AND f.sale_return_id = r.id
        WHERE r.tenant_id=? AND r.idempotency_key=?`,
    ).get(scope.tenantId, idempotencyKey) as {
      sale_return_id: string; sale_id: string; refund_id: string; commercial_refund_amount: string;
      refund_rounding_adjustment: string; completed_amount: string; restocked: number;
    } | undefined;
    if (row === undefined) return null;
    return {
      saleReturnId: row.sale_return_id,
      refundId: row.refund_id,
      commercialAmount: row.commercial_refund_amount,
      roundingAdjustment: row.refund_rounding_adjustment,
      refundedAmount: row.completed_amount,
      restockedLines: row.restocked,
      fiscalCorrection: this.fiscalCorrection(scope, row.sale_id),
    };
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
    this.database.native.prepare(
      `INSERT INTO local_operation_audit(
        tenant_id, company_id, branch_id, device_id,
        actor_type, actor_id, session_id,
        action_code, resource_type, resource_id,
        correlation_id, causation_id, reason_code, details_json, created_at
      ) VALUES (?,?,?,?,'USER',?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      input.scope.tenantId, input.scope.companyId, input.scope.branchId, input.scope.deviceId,
      input.operatorUserId, input.sessionId, actionCode, resourceType, resourceId,
      input.correlationId, input.causationId, input.reasonCode, canonicalJson(details), nowIso,
    );
  }

  private enqueue(
    input: CreateSaleReturnInput, operationId: string, idempotencyKey: string,
    aggregateType: string, aggregateId: string, operationType: string,
    payload: Record<string, unknown>, nowIso: string,
  ): void {
    const { scope } = input;
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
      session_id: input.sessionId,
      actor_id: input.operatorUserId,
      aggregate_type: aggregateType,
      aggregate_id: aggregateId,
      operation_type: operationType,
      authority_policy: "LOCAL_AUTHORITATIVE_UNTIL_SYNC",
      local_sequence: nextSequence,
      idempotency_key: idempotencyKey,
      expected_version: null,
      payload_schema_version: RETURN_PAYLOAD_SCHEMA_VERSION,
      payload,
      payload_checksum: input.requestChecksum,
      causation_id: input.causationId,
      correlation_id: input.correlationId,
      occurred_at_local: nowIso,
      recorded_at_local: nowIso,
    });
  }
}
