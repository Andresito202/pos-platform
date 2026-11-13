import type { LocalDatabase } from "@pos-platform/database-sqlite";
import { canonicalJson } from "../channel/canonical-json.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import type { DurableSyncStore } from "../sync/durable-sync-store.js";
import { bigIntToScale6 } from "../money.js";
import type { SaleLineCalculation, SaleTotalsCalculation } from "./sale-calculation.js";

const SALE_PAYLOAD_SCHEMA_VERSION = "1.0.0";

export interface SaleLineInput {
  readonly itemId: string;
  readonly productId: string;
  readonly presentationId: string;
  readonly productName: string;
  readonly presentationName: string;
  readonly unitId: string;
  readonly unitCode: string;
  readonly unitPrecision: number;
  readonly identifierSnapshot: string | null;
  readonly calculation: SaleLineCalculation;
  readonly pricingResolutionSnapshot: unknown;
  readonly taxCalculationSnapshot: unknown;
}

export interface CreateSaleInput {
  /** Trusted adapter policy, never accepted from renderer payload. */
  readonly requireOpenCashShift?: boolean;
  readonly saleId: string;
  readonly operationId: string;
  readonly scope: SyncScope;
  readonly operatorUserId: string;
  readonly sessionId: string;
  readonly channel: string;
  readonly businessDate: string;
  readonly timezoneId: string;
  readonly utcOffsetMinutes: number;
  readonly documentSeries: string;
  readonly currencyCode: string;
  readonly pricingPipelineVersion: string;
  readonly pricingPolicyVersion: string;
  readonly taxPolicyVersion: string;
  readonly roundingPolicyVersion: string;
  readonly pricingSnapshot: unknown;
  readonly taxSnapshot: unknown;
  readonly calculationChecksum: string;
  readonly idempotencyKey: string;
  readonly requestChecksum: string;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly lines: readonly SaleLineInput[];
  readonly totals: SaleTotalsCalculation;
  /**
   * Caja y turno en los que nace la venta, o `null` si no pasa por caja.
   *
   * Viajan **juntos** porque el esquema lo impone:
   * `CHECK((cash_register_id IS NULL) = (cash_shift_id IS NULL))`. Por eso es un
   * objeto y no dos campos sueltos que pudieran desparejarse.
   */
  readonly cashShift: { readonly cashRegisterId: string; readonly shiftId: string } | null;
}

export type CreateSaleOutcome =
  | {
      readonly kind: "CREATED";
      readonly saleId: string;
      readonly saleNumber: number;
      readonly calculationChecksum: string;
    }
  | {
      readonly kind: "IDEMPOTENT";
      readonly saleId: string;
      readonly saleNumber: number;
      readonly calculationChecksum: string;
    }
  | { readonly kind: "IDEMPOTENCY_CONFLICT" }
  | { readonly kind: "CASH_SHIFT_NOT_OPEN" };

interface SaleRow {
  id: string;
  sale_number: number;
  calculation_checksum: string;
  request_checksum: string;
}

/**
 * Persistencia atómica del agregado Sale.
 *
 * Una sola transacción escribe: runtime_operations, sales_sales, sales_sale_items,
 * sales_document_series_counter (incremento), local_operation_audit y
 * local_sync_outbox. No se escribe nada fuera de la transacción.
 */
export class SqliteSaleStore {
  constructor(
    private readonly database: LocalDatabase,
    private readonly durableSync: DurableSyncStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  create(input: CreateSaleInput): CreateSaleOutcome {
    const nowIso = this.now().toISOString();

    const transaction = this.database.native.transaction((): CreateSaleOutcome => {
      // 1. Idempotencia: (tenant_id, origin_device_id, idempotency_key)
      const existing = this.database.native.prepare(
        `SELECT id, sale_number, calculation_checksum, request_checksum
         FROM sales_sales
         WHERE tenant_id=? AND origin_device_id=? AND idempotency_key=?`,
      ).get(
        input.scope.tenantId,
        input.scope.deviceId,
        input.idempotencyKey,
      ) as SaleRow | undefined;

      if (existing) {
        if (existing.request_checksum !== input.requestChecksum) {
          return { kind: "IDEMPOTENCY_CONFLICT" };
        }
        return {
          kind: "IDEMPOTENT",
          saleId: existing.id,
          saleNumber: existing.sale_number,
          calculationChecksum: existing.calculation_checksum,
        };
      }

      // Counter IPC requires OPEN even for transfers. Check in the writer transaction,
      // after replay resolution and before numbering, audit, outbox or any sale write.
      if (input.requireOpenCashShift) {
        const shift = input.cashShift;
        if (shift === null || !this.database.native.prepare(`SELECT 1 FROM cash_shift
          WHERE tenant_id=? AND company_id=? AND branch_id=? AND cash_register_id=? AND id=? AND status='OPEN'`)
          .get(input.scope.tenantId, input.scope.companyId, input.scope.branchId, shift.cashRegisterId, shift.shiftId)) {
          return { kind: "CASH_SHIFT_NOT_OPEN" };
        }
      }

      // 2. Contador de serie documental — incremento atómico
      const counterRow = this.database.native.prepare(
        `SELECT last_number FROM sales_document_series_counter
         WHERE tenant_id=? AND branch_id=? AND series=?`,
      ).get(
        input.scope.tenantId,
        input.scope.branchId,
        input.documentSeries,
      ) as { last_number: number } | undefined;

      const saleNumber = (counterRow?.last_number ?? 0) + 1;

      if (counterRow) {
        this.database.native.prepare(
          `UPDATE sales_document_series_counter
           SET last_number=?, updated_at=?
           WHERE tenant_id=? AND branch_id=? AND series=?`,
        ).run(saleNumber, nowIso, input.scope.tenantId, input.scope.branchId, input.documentSeries);
      } else {
        this.database.native.prepare(
          `INSERT INTO sales_document_series_counter(tenant_id, branch_id, series, last_number, updated_at)
           VALUES (?,?,?,?,?)`,
        ).run(input.scope.tenantId, input.scope.branchId, input.documentSeries, saleNumber, nowIso);
      }

      // 3. runtime_operations (1:1 con el sale)
      this.database.native.prepare(
        `INSERT INTO runtime_operations(operation_id, idempotency_key, payload_checksum, status, result_code, created_at, updated_at)
         VALUES (?,?,?,'SUCCEEDED','SALE_CREATED',?,?)`,
      ).run(input.operationId, input.idempotencyKey, input.requestChecksum, nowIso, nowIso);

      // 4. sale principal
      const subtotal = bigIntToScale6(input.totals.subtotalUnits);
      const discount = bigIntToScale6(input.totals.discountUnits);
      const tax = bigIntToScale6(input.totals.taxUnits);
      const fiscalTotal = bigIntToScale6(input.totals.fiscalTotalUnits);
      const rounding = bigIntToScale6(input.totals.commercialRoundingAdjustmentUnits);
      const payable = bigIntToScale6(input.totals.payableUnits);

      this.database.native.prepare(
        `INSERT INTO sales_sales(
          id, tenant_id, company_id, branch_id, cash_register_id, cash_shift_id,
          origin_device_id, installation_id, operator_actor_type, operator_actor_id,
          channel, status, business_date, timezone_id, utc_offset_minutes,
          document_series, sale_number, currency_code,
          subtotal_amount, discount_amount, tax_amount, fiscal_total_amount,
          commercial_rounding_adjustment, payable_amount,
          pricing_pipeline_version, pricing_policy_version, promotion_policy_version,
          tax_policy_version, rounding_policy_version,
          pricing_snapshot, tax_snapshot, calculation_checksum,
          operation_id, idempotency_key, request_checksum,
          correlation_id, causation_id, version, created_at,
          completed_at, cancelled_at, expired_at, server_recorded_at
        ) VALUES (
          ?,?,?,?,?,?,
          ?,?,?,?,
          ?,?,?,?,?,
          ?,?,?,
          ?,?,?,?,
          ?,?,
          ?,?,NULL,
          ?,?,
          ?,?,?,
          ?,?,?,
          ?,?,?,?,
          NULL,NULL,NULL,NULL
        )`,
      ).run(
        input.saleId,
        input.scope.tenantId,
        input.scope.companyId,
        input.scope.branchId,
        input.cashShift?.cashRegisterId ?? null,
        input.cashShift?.shiftId ?? null,
        input.scope.deviceId,
        input.scope.installationId,
        "USER",
        input.operatorUserId,
        input.channel,
        "READY_FOR_PAYMENT",
        input.businessDate,
        input.timezoneId,
        input.utcOffsetMinutes,
        input.documentSeries,
        saleNumber,
        input.currencyCode,
        subtotal,
        discount,
        tax,
        fiscalTotal,
        rounding,
        payable,
        input.pricingPipelineVersion,
        input.pricingPolicyVersion,
        input.taxPolicyVersion,
        input.roundingPolicyVersion,
        canonicalJson(input.pricingSnapshot),
        canonicalJson(input.taxSnapshot),
        input.calculationChecksum,
        input.operationId,
        input.idempotencyKey,
        input.requestChecksum,
        input.correlationId,
        input.causationId,
        1,
        nowIso,
      );

      // 5. items
      let lineNumber = 1;
      for (const line of input.lines) {
        this.database.native.prepare(
          `INSERT INTO sales_sale_items(
            id, tenant_id, sale_id, line_number,
            product_id, variant_id, presentation_id,
            product_name_snapshot, presentation_name_snapshot, identifier_snapshot,
            unit_id, unit_code_snapshot, unit_precision_snapshot,
            quantity, unit_price_amount, gross_amount,
            discount_amount, taxable_amount, tax_amount, line_total_amount,
            pricing_resolution_snapshot, tax_calculation_snapshot,
            lot_id, measurement_source_type, measurement_evidence_snapshot, measurement_evidence_checksum
          ) VALUES (
            ?,?,?,?,
            ?,NULL,?,
            ?,?,?,
            ?,?,?,
            ?,?,?,
            ?,?,?,?,
            ?,?,
            NULL,NULL,NULL,NULL
          )`,
        ).run(
          line.itemId,
          input.scope.tenantId,
          input.saleId,
          lineNumber,
          line.productId,
          line.presentationId,
          line.productName,
          line.presentationName,
          line.identifierSnapshot,
          line.unitId,
          line.unitCode,
          line.unitPrecision,
          bigIntToScale6(line.calculation.quantityUnits),
          bigIntToScale6(line.calculation.unitPriceUnits),
          bigIntToScale6(line.calculation.grossUnits),
          bigIntToScale6(line.calculation.discountUnits),
          bigIntToScale6(line.calculation.taxableUnits),
          bigIntToScale6(line.calculation.taxUnits),
          bigIntToScale6(line.calculation.lineTotalUnits),
          canonicalJson(line.pricingResolutionSnapshot),
          canonicalJson(line.taxCalculationSnapshot),
        );
        lineNumber += 1;
      }

      // 6. Auditoría
      this.database.native.prepare(
        `INSERT INTO local_operation_audit(
          tenant_id, company_id, branch_id, device_id,
          actor_type, actor_id, session_id,
          action_code, resource_type, resource_id,
          correlation_id, causation_id, reason_code,
          details_json, created_at
        ) VALUES (?,?,?,?,?,?,?,'SALE_CREATED','SALE',?,?,?,NULL,?,?)`,
      ).run(
        input.scope.tenantId,
        input.scope.companyId,
        input.scope.branchId,
        input.scope.deviceId,
        "USER",
        input.operatorUserId,
        input.sessionId,
        input.saleId,
        input.correlationId,
        input.causationId,
        canonicalJson({
          sale_id: input.saleId,
          document_series: input.documentSeries,
          sale_number: saleNumber,
          calculation_checksum: input.calculationChecksum,
          payable_amount: payable,
          currency_code: input.currencyCode,
        }),
        nowIso,
      );

      // 7. Outbox
      const nextSequence = (this.database.native.prepare(
        `SELECT COALESCE(MAX(local_sequence), 0) + 1 AS next_sequence FROM local_sync_outbox
         WHERE tenant_id=? AND company_id=? AND branch_id=? AND device_id=? AND installation_id=?`,
      ).get(
        input.scope.tenantId,
        input.scope.companyId,
        input.scope.branchId,
        input.scope.deviceId,
        input.scope.installationId,
      ) as { next_sequence: number }).next_sequence;

      this.durableSync.enqueue({
        operation_id: input.operationId,
        tenant_id: input.scope.tenantId,
        company_id: input.scope.companyId,
        branch_id: input.scope.branchId,
        device_id: input.scope.deviceId,
        installation_id: input.scope.installationId,
        session_id: input.sessionId,
        actor_id: input.operatorUserId,
        aggregate_type: "SALE",
        aggregate_id: input.saleId,
        operation_type: "SALE_CREATED",
        authority_policy: "LOCAL_AUTHORITATIVE_UNTIL_SYNC",
        local_sequence: nextSequence,
        idempotency_key: input.idempotencyKey,
        expected_version: null,
        payload_schema_version: SALE_PAYLOAD_SCHEMA_VERSION,
        payload: {
          sale_id: input.saleId,
          document_series: input.documentSeries,
          sale_number: saleNumber,
          calculation_checksum: input.calculationChecksum,
          currency_code: input.currencyCode,
          payable_amount: payable,
        },
        payload_checksum: input.requestChecksum,
        causation_id: input.causationId,
        correlation_id: input.correlationId,
        occurred_at_local: nowIso,
        recorded_at_local: nowIso,
      });

      return {
        kind: "CREATED",
        saleId: input.saleId,
        saleNumber,
        calculationChecksum: input.calculationChecksum,
      };
    });

    return transaction();
  }
}
