import { createHash, randomUUID } from "node:crypto";
import { createActor, createOperationScope, evaluatePermission, toRoleAssignments } from "@pos-platform/application";
import { uuidV7 } from "@pos-platform/contracts";
import { canonicalJson } from "../channel/canonical-json.js";
import { bigIntToScale6, scale6ToBigInt } from "../money.js";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { CatalogFiscalAttribute, SqliteCatalogStore } from "../catalog/index.js";
import type { SqliteInventoryStore } from "../inventory/index.js";
import type { SqliteCashShiftStore } from "../cash/sqlite-cash-shift-store.js";
import { buildChecksumInput, computeSaleChecksum } from "./sale-checksum.js";
import { calculateSaleLine, calculateSaleTotals, quantityFitsUnitPrecision } from "./sale-calculation.js";
import type { SqliteSaleStore } from "./sqlite-sale-store.js";
import type { CreateSaleOutcome } from "./sqlite-sale-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";

export const PRICING_PIPELINE_VERSION = "PRICING_PIPELINE_V1";
export const PRICING_POLICY_VERSION = "SANDBOX_PRICE_V1";
export const TAX_POLICY_VERSION = "TAX_POLICY_LINE_RATE_V1";
export const ROUNDING_POLICY_VERSION = "NEAREST_50_HALF_AWAY_FROM_ZERO_V1";
export const PERMISSION_SALES_SALE_CREATE = "SALES_SALE_CREATE";

export interface CreateSaleRequestLine {
  readonly productId: string;
  readonly presentationId: string;
  /** TEXT a escala 6, e.g. "1.000000" */
  readonly quantity: string;
}

export interface CreateSaleRequest {
  /** Caja seleccionada, o `null` cuando la venta no pasa por caja. */
  readonly cashRegisterId: string | null;
  readonly idempotencyKey: string;
  readonly channel: string;
  readonly businessDate: string;
  readonly timezoneId: string;
  readonly utcOffsetMinutes: number;
  readonly documentSeries: string;
  readonly currencyCode: string;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly lines: readonly CreateSaleRequestLine[];
}

export type CreateSaleResult =
  | { readonly kind: "CREATED"; readonly saleId: string; readonly saleNumber: number; readonly payableAmount: string; readonly calculationChecksum: string }
  | { readonly kind: "IDEMPOTENT"; readonly saleId: string; readonly saleNumber: number; readonly payableAmount: string; readonly calculationChecksum: string }
  | { readonly kind: "UNAUTHORIZED"; readonly reason: string }
  | { readonly kind: "CATALOG_NOT_FOUND"; readonly productId: string; readonly presentationId: string }
  | { readonly kind: "PRICE_NOT_FOUND"; readonly presentationId: string }
  | { readonly kind: "CURRENCY_MISMATCH"; readonly presentationId: string }
  | { readonly kind: "QUANTITY_PRECISION_EXCEEDED"; readonly presentationId: string; readonly unitPrecision: number }
  | { readonly kind: "INSUFFICIENT_STOCK"; readonly presentationId: string; readonly available: string; readonly requested: string }
  | { readonly kind: "IDEMPOTENCY_CONFLICT" };

function requestChecksum(request: CreateSaleRequest, operatorUserId: string): string {
  return createHash("sha256")
    .update(canonicalJson({
      idempotency_key: request.idempotencyKey,
      channel: request.channel,
      business_date: request.businessDate,
      currency_code: request.currencyCode,
      document_series: request.documentSeries,
      lines: request.lines.map((line) => ({
        product_id: line.productId,
        presentation_id: line.presentationId,
        quantity: line.quantity,
      })),
      operator_user_id: operatorUserId,
    }))
    .digest("hex");
}

export class CreateSaleUseCase {
  constructor(
    private readonly catalogStore: SqliteCatalogStore,
    private readonly inventoryStore: SqliteInventoryStore,
    private readonly cashShiftStore: SqliteCashShiftStore,
    private readonly saleStore: SqliteSaleStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  execute(
    scope: SyncScope,
    sessionId: string,
    authSnapshot: StoredAuthorizationSnapshot,
    request: CreateSaleRequest,
  ): CreateSaleResult {
    const at = this.now();
    const actor = createActor("USER", authSnapshot.claims.user_id);
    const operatorUserId = authSnapshot.claims.user_id;
    const assignments = toRoleAssignments(authSnapshot.claims);
    const operationScope = createOperationScope(scope.tenantId, scope.companyId, scope.branchId);
    const decision = evaluatePermission({ actor, permission: PERMISSION_SALES_SALE_CREATE, scope: operationScope, at, assignments });
    if (!decision.allowed) return { kind: "UNAUTHORIZED", reason: decision.reason };

    const resolvedLines: Array<{
      productId: string;
      presentationId: string;
      productName: string;
      presentationName: string;
      unitId: string;
      unitCode: string;
      unitPrecision: number;
      identifierSnapshot: string | null;
      priceAmount: string;
      quantity: string;
      fiscal: CatalogFiscalAttribute | null;
    }> = [];

    const catalogScope = { tenantId: scope.tenantId, companyId: scope.companyId };
    const requestedByPresentation = new Map<string, bigint>();
    for (const line of request.lines) {
      const accumulated = requestedByPresentation.get(line.presentationId) ?? 0n;
      requestedByPresentation.set(line.presentationId, accumulated + scale6ToBigInt(line.quantity));
    }

    for (const line of request.lines) {
      const product = this.catalogStore.findActiveProduct(catalogScope, line.productId);
      if (!product) return { kind: "CATALOG_NOT_FOUND", productId: line.productId, presentationId: line.presentationId };
      const presentation = this.catalogStore.findActivePresentation(catalogScope, line.presentationId);
      if (!presentation || presentation.productId !== line.productId) {
        return { kind: "CATALOG_NOT_FOUND", productId: line.productId, presentationId: line.presentationId };
      }
      if (!quantityFitsUnitPrecision(line.quantity, presentation.unitPrecision)) {
        return { kind: "QUANTITY_PRECISION_EXCEEDED", presentationId: line.presentationId, unitPrecision: presentation.unitPrecision };
      }
      const price = this.catalogStore.getActivePrice(catalogScope, line.presentationId);
      if (!price) return { kind: "PRICE_NOT_FOUND", presentationId: line.presentationId };
      if (price.currencyCode !== request.currencyCode) return { kind: "CURRENCY_MISMATCH", presentationId: line.presentationId };
      if (product.stockControlled) {
        const requestedUnits = requestedByPresentation.get(line.presentationId) ?? 0n;
        const available = this.inventoryStore.availableUnits(scope, line.presentationId);
        if (available < requestedUnits) {
          return { kind: "INSUFFICIENT_STOCK", presentationId: line.presentationId, available: bigIntToScale6(available), requested: bigIntToScale6(requestedUnits) };
        }
      }
      resolvedLines.push({
        productId: line.productId,
        presentationId: line.presentationId,
        productName: product.name,
        presentationName: presentation.name,
        unitId: presentation.id,
        unitCode: presentation.unitCode,
        unitPrecision: presentation.unitPrecision,
        identifierSnapshot: presentation.barcode ?? product.code,
        priceAmount: price.amount,
        quantity: line.quantity,
        fiscal: this.catalogStore.getFiscalAttribute(catalogScope, line.presentationId),
      });
    }

    const calculatedLines = resolvedLines.map((resolved) => ({
      productId: resolved.productId,
      presentationId: resolved.presentationId,
      calculation: calculateSaleLine(resolved.priceAmount, resolved.quantity, resolved.fiscal?.taxRate ?? null),
    }));
    const totals = calculateSaleTotals(calculatedLines.map((l) => l.calculation));
    const checksumInput = buildChecksumInput(PRICING_PIPELINE_VERSION, TAX_POLICY_VERSION, ROUNDING_POLICY_VERSION, request.currencyCode, calculatedLines, totals);
    const calculationChecksum = computeSaleChecksum(checksumInput);

    const pricingSnapshot = {
      schema_version: 1,
      pipeline_version: PRICING_PIPELINE_VERSION,
      policy_version: PRICING_POLICY_VERSION,
      environment: "SANDBOX",
      lines: resolvedLines.map((resolved, index) => ({
        product_id: resolved.productId,
        presentation_id: resolved.presentationId,
        price_rule_amount: resolved.priceAmount,
        currency_code: request.currencyCode,
        gross_amount: checksumInput.lines[index]!.gross_amount,
      })),
    };
    const linesWithoutFiscalAttributes = resolvedLines.filter((r) => r.fiscal === null).length;
    const taxSnapshot = {
      schema_version: 2,
      snapshot_type: "TAX",
      policy_version: TAX_POLICY_VERSION,
      environment: "SANDBOX",
      lines_without_fiscal_attributes: linesWithoutFiscalAttributes,
      tax_amount: bigIntToScale6(totals.taxUnits),
    };

    const saleId = randomUUID();
    const operationId = uuidV7();
    const reqChecksum = requestChecksum(request, operatorUserId);
    const registerId = request.cashRegisterId;
    const activeShift = registerId === null ? null : this.cashShiftStore.findActiveShiftForRegister(scope, registerId);
    const cashShift = registerId === null || activeShift === null ? null : { cashRegisterId: registerId, shiftId: activeShift.shiftId };

    const storeInput = {
      saleId,
      operationId,
      scope,
      operatorUserId,
      sessionId,
      channel: request.channel,
      businessDate: request.businessDate,
      timezoneId: request.timezoneId,
      utcOffsetMinutes: request.utcOffsetMinutes,
      documentSeries: request.documentSeries,
      currencyCode: request.currencyCode,
      pricingPipelineVersion: PRICING_PIPELINE_VERSION,
      pricingPolicyVersion: PRICING_POLICY_VERSION,
      taxPolicyVersion: TAX_POLICY_VERSION,
      roundingPolicyVersion: ROUNDING_POLICY_VERSION,
      pricingSnapshot,
      taxSnapshot,
      calculationChecksum,
      idempotencyKey: request.idempotencyKey,
      requestChecksum: reqChecksum,
      correlationId: request.correlationId,
      causationId: request.causationId,
      cashShift,
      lines: resolvedLines.map((resolved, index) => ({
        itemId: randomUUID(),
        productId: resolved.productId,
        presentationId: resolved.presentationId,
        productName: resolved.productName,
        presentationName: resolved.presentationName,
        unitId: resolved.unitId,
        unitCode: resolved.unitCode,
        unitPrecision: resolved.unitPrecision,
        identifierSnapshot: resolved.identifierSnapshot,
        calculation: calculatedLines[index]!.calculation,
        pricingResolutionSnapshot: {
          schema_version: 1,
          price_rule_amount: resolved.priceAmount,
          currency_code: request.currencyCode,
          pipeline_version: PRICING_PIPELINE_VERSION,
          policy_version: PRICING_POLICY_VERSION,
        },
        taxCalculationSnapshot: resolved.fiscal === null
          ? {
              schema_version: 2,
              model: "NO_FISCAL_ATTRIBUTES",
              tax_policy_version: TAX_POLICY_VERSION,
              taxable_amount: checksumInput.lines[index]!.taxable_amount,
              tax_amount: "0.000000",
            }
          : {
              schema_version: 2,
              model: "RATE_APPLIED",
              tax_policy_version: TAX_POLICY_VERSION,
              tax_code: resolved.fiscal.taxCode,
              rate: resolved.fiscal.taxRate,
              taxable_amount: checksumInput.lines[index]!.taxable_amount,
              tax_amount: bigIntToScale6(calculatedLines[index]!.calculation.taxUnits),
            },
      })),
      totals,
    };

    const outcome: CreateSaleOutcome = this.saleStore.create(storeInput);
    if (outcome.kind === "IDEMPOTENCY_CONFLICT") return { kind: "IDEMPOTENCY_CONFLICT" };
    return {
      kind: outcome.kind === "CREATED" ? "CREATED" : "IDEMPOTENT",
      saleId: outcome.saleId,
      saleNumber: outcome.saleNumber,
      payableAmount: checksumInput.payable_amount,
      calculationChecksum: outcome.calculationChecksum,
    };
  }
}
