import { createHash } from "node:crypto";
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
  /**
   * Adquiriente, cuando la operación lo nombra. Ausente o `null` es la venta
   * de mostrador anónima, que sigue siendo el caso normal.
   *
   * Decir quién compra no dice que deba: esto no abre crédito. `DEC-005` sigue
   * pendiente y `CUST-002` con él.
   */
  readonly customerId?: string | null;
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
  | {
      readonly kind: "CREATED";
      readonly saleId: string;
      readonly saleNumber: number;
      readonly payableAmount: string;
      readonly calculationChecksum: string;
    }
  | {
      readonly kind: "IDEMPOTENT";
      readonly saleId: string;
      readonly saleNumber: number;
      readonly payableAmount: string;
      readonly calculationChecksum: string;
    }
  | { readonly kind: "UNAUTHORIZED"; readonly reason: string }
  | { readonly kind: "CATALOG_NOT_FOUND"; readonly productId: string; readonly presentationId: string }
  | { readonly kind: "PRICE_NOT_FOUND"; readonly presentationId: string }
  | { readonly kind: "CURRENCY_MISMATCH"; readonly presentationId: string }
  | {
      readonly kind: "QUANTITY_PRECISION_EXCEEDED";
      readonly presentationId: string;
      readonly unitPrecision: number;
    }
  | {
      readonly kind: "INSUFFICIENT_STOCK";
      readonly presentationId: string;
      readonly available: string;
      readonly requested: string;
    }
  | { readonly kind: "CUSTOMER_NOT_FOUND"; readonly customerId: string }
  | { readonly kind: "IDEMPOTENCY_CONFLICT" };

function requestChecksum(request: CreateSaleRequest, operatorUserId: string): string {
  return createHash("sha256")
    .update(canonicalJson({
      idempotency_key: request.idempotencyKey,
      channel: request.channel,
      business_date: request.businessDate,
      currency_code: request.currencyCode,
      // El adquiriente entra en el checksum: repetir la misma clave cambiando
      // de cliente es otra operación, no una repetición, y debe chocar en vez
      // de devolver en silencio la venta del cliente anterior.
      customer_id: request.customerId ?? null,
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

/**
 * Caso de uso: crear una venta en estado READY_FOR_PAYMENT.
 *
 * - El actor USER se deriva del snapshot de autorización; nunca del caller.
 * - Verifica SALES_SALE_CREATE antes de tocar el catálogo o persistir.
 * - PRICING_PIPELINE_V1 (Tax EXCLUDED): precio → gross → taxable = gross → tax = 0 →
 *   fiscal_total = gross → commercial_rounding NEAREST_50 → payable.
 * - Escribe sale, items, counter, runtime_operation, audit y outbox en una
 *   sola transacción SQLite.
 */
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

    // 1. Actor USER desde el snapshot autorizado — no del caller
    const actor = createActor("USER", authSnapshot.claims.user_id);
    const operatorUserId = authSnapshot.claims.user_id;

    // 2. Autorización: SALES_SALE_CREATE
    const assignments = toRoleAssignments(authSnapshot.claims);
    const operationScope = createOperationScope(scope.tenantId, scope.companyId, scope.branchId);
    const decision = evaluatePermission({
      actor,
      permission: PERMISSION_SALES_SALE_CREATE,
      scope: operationScope,
      at,
      assignments,
    });

    if (!decision.allowed) {
      return { kind: "UNAUTHORIZED", reason: decision.reason };
    }

    // 3. Resolución de catálogo y precio para cada línea
    const resolvedLines: Array<{
      productId: string;
      presentationId: string;
      productName: string;
      presentationName: string;
      unitId: string;
      unitCode: string;
      unitPrecision: number;
      barcode: string | null;
      priceAmount: string;
      quantity: string;
      fiscal: CatalogFiscalAttribute | null;
    }> = [];

    // El catálogo es de la compañía, no de la sucursal: un producto no cambia
    // de precio por la caja desde la que se venda.
    const catalogScope = { tenantId: scope.tenantId, companyId: scope.companyId };

    // La misma presentación puede venir en dos líneas. La disponibilidad se
    // compara contra el total pedido, no contra cada línea por separado:
    // comprobarlas de una en una dejaría pasar dos líneas de 3 con 4 en
    // existencia.
    const requestedByPresentation = new Map<string, bigint>();
    for (const line of request.lines) {
      const accumulated = requestedByPresentation.get(line.presentationId) ?? 0n;
      requestedByPresentation.set(line.presentationId, accumulated + scale6ToBigInt(line.quantity));
    }

    for (const line of request.lines) {
      const product = this.catalogStore.findActiveProduct(catalogScope, line.productId);
      if (!product) {
        return { kind: "CATALOG_NOT_FOUND", productId: line.productId, presentationId: line.presentationId };
      }

      const presentation = this.catalogStore.findActivePresentation(catalogScope, line.presentationId);
      if (!presentation || presentation.productId !== line.productId) {
        return { kind: "CATALOG_NOT_FOUND", productId: line.productId, presentationId: line.presentationId };
      }

      // La cantidad tiene que caber en la precisión de la unidad. Se comprueba
      // **antes** de resolver el precio: una cantidad imposible no debe llegar a
      // multiplicarse por nada.
      if (!quantityFitsUnitPrecision(line.quantity, presentation.unitPrecision)) {
        return {
          kind: "QUANTITY_PRECISION_EXCEEDED",
          presentationId: line.presentationId,
          unitPrecision: presentation.unitPrecision,
        };
      }

      // GetActivePrice (PRICING_PIPELINE_V1 paso 1)
      const price = this.catalogStore.getActivePrice(catalogScope, line.presentationId);
      if (!price) {
        return { kind: "PRICE_NOT_FOUND", presentationId: line.presentationId };
      }

      if (price.currencyCode !== request.currencyCode) {
        return { kind: "CURRENCY_MISMATCH", presentationId: line.presentationId };
      }

      // Disponibilidad, sólo si el producto lleva control de existencia.
      //
      // Se comprueba **al crear**, no al cobrar: rechazar después de que el
      // cliente pagó no es una opción, y la salida real ocurre en la
      // transacción que completa la venta. Entre ambos momentos la existencia
      // sólo puede bajar por otra venta o por un ajuste; si eso pasa, la
      // finalización revierte el cobro en vez de dejar existencia negativa.
      if (product.stockControlled) {
        const requestedUnits = requestedByPresentation.get(line.presentationId) ?? 0n;
        const available = this.inventoryStore.availableUnits(scope, line.presentationId);
        if (available < requestedUnits) {
          return {
            kind: "INSUFFICIENT_STOCK",
            presentationId: line.presentationId,
            available: bigIntToScale6(available),
            requested: bigIntToScale6(requestedUnits),
          };
        }
      }

      resolvedLines.push({
        productId: line.productId,
        presentationId: line.presentationId,
        productName: product.name,
        presentationName: presentation.name,
        // El catálogo real no tiene una entidad `Unit` propia: la unidad es el
        // código que declara la presentación. Se conserva el campo del snapshot
        // por compatibilidad con las ventas ya guardadas.
        unitId: presentation.id,
        unitCode: presentation.unitCode,
        unitPrecision: presentation.unitPrecision,
        barcode: presentation.barcode,
        priceAmount: price.amount,
        quantity: line.quantity,
        fiscal: this.catalogStore.getFiscalAttribute(catalogScope, line.presentationId),
      });
    }

    // 4. PRICING_PIPELINE_V1: cálculo de líneas y totales
    const calculatedLines = resolvedLines.map((resolved) => ({
      productId: resolved.productId,
      presentationId: resolved.presentationId,
      calculation: calculateSaleLine(
        resolved.priceAmount,
        resolved.quantity,
        resolved.fiscal?.taxRate ?? null,
      ),
    }));

    const totals = calculateSaleTotals(calculatedLines.map((l) => l.calculation));

    // 5. SALE_CALCULATION_CHECKSUM_V1
    const checksumInput = buildChecksumInput(
      PRICING_PIPELINE_VERSION,
      TAX_POLICY_VERSION,
      ROUNDING_POLICY_VERSION,
      request.currencyCode,
      calculatedLines,
      totals,
    );
    const calculationChecksum = computeSaleChecksum(checksumInput);

    // 6. Snapshot de pricing y tax para el sale
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

    // El impuesto es **por línea**: dos artículos de la misma venta pueden
    // tener tasas distintas. El snapshot de la venta ya no declara una tasa
    // única —afirmarlo era falso en cuanto hubiera dos tipos— y se limita a
    // decir cuántas líneas quedaron sin atributos fiscales, que es lo que
    // impide facturarla.
    const linesWithoutFiscalAttributes = resolvedLines.filter((r) => r.fiscal === null).length;
    const taxSnapshot = {
      schema_version: 2,
      snapshot_type: "TAX",
      policy_version: TAX_POLICY_VERSION,
      environment: "SANDBOX",
      lines_without_fiscal_attributes: linesWithoutFiscalAttributes,
      tax_amount: bigIntToScale6(totals.taxUnits),
    };

    // 7. IDs de operación y sale
    const saleId = uuidV7();
    const operationId = uuidV7();
    const reqChecksum = requestChecksum(request, operatorUserId);

    // 8. Caja y turno en los que nace la venta.
    //
    // La caja la nombra la operación; el turno lo resuelve la capa confiable.
    // `DEC-012` §25.2 garantiza como máximo un turno activo por caja, así que la
    // resolución es inequívoca y no hay nada que desempatar. El dispositivo no
    // participa: §25.3 le niega propiedad sobre la caja, y dos terminales pueden
    // trabajar la misma caja legítimamente.
    //
    // Sin caja nombrada la venta nace sin turno, con el par en `NULL`: el
    // esquema lo admite y hay canales que no pasan por caja. Con caja nombrada
    // pero sin turno activo tampoco se vincula, y el cobro en efectivo lo
    // rechaza luego con `CASH_SHIFT_MISSING`, que es exacto: no hay turno.
    //
    // Un turno en `CLOSING` **sí** se vincula, a propósito: existe, y el pago lo
    // rechaza con `CASH_SHIFT_NOT_OPEN` (`DEC-016` §10.3). Decir «no hay turno»
    // cuando se está cuadrando sería un diagnóstico falso.
    const registerId = request.cashRegisterId;
    const activeShift = registerId === null
      ? null
      : this.cashShiftStore.findActiveShiftForRegister(scope, registerId);
    const cashShift = registerId === null || activeShift === null
      ? null
      : { cashRegisterId: registerId, shiftId: activeShift.shiftId };

    // 9. Persistencia atómica
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
      // Se pasa tal cual y **no se comprueba aquí**: la existencia del
      // adquiriente sólo es cierta dentro de la transacción que escribe la
      // venta. Verificarla antes dejaría una ventana entre la comprobación y
      // la escritura.
      customerId: request.customerId ?? null,
      lines: resolvedLines.map((resolved, index) => ({
        itemId: uuidV7(),
        productId: resolved.productId,
        presentationId: resolved.presentationId,
        productName: resolved.productName,
        presentationName: resolved.presentationName,
        unitId: resolved.unitId,
        unitCode: resolved.unitCode,
        unitPrecision: resolved.unitPrecision,
        // `D-23`: la columna existía desde el origen y nunca guardó un valor.
        // Se congela el código de barras de la presentación con la que se
        // vendió, no el actual del catálogo: el sufijo `_snapshot` significa
        // que el dato no vuelve a cambiar aunque el catálogo sí. Sigue siendo
        // `null` cuando la presentación no declara ninguno, que es distinto de
        // no haberlo mirado nunca.
        identifierSnapshot: resolved.barcode,
        calculation: calculatedLines[index]!.calculation,
        pricingResolutionSnapshot: {
          schema_version: 1,
          price_rule_amount: resolved.priceAmount,
          currency_code: request.currencyCode,
          pipeline_version: PRICING_PIPELINE_VERSION,
          policy_version: PRICING_POLICY_VERSION,
        },
        // Dos formas, y la diferencia importa: `RATE_APPLIED` afirma que el
        // impuesto se calculó con una tasa concreta; `NO_FISCAL_ATTRIBUTES`
        // afirma que el cero es **desconocimiento**, no exención. Emitir una
        // factura desde una línea de la segunda forma sería declarar exento algo
        // que nadie ha declarado exento.
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

    if (outcome.kind === "IDEMPOTENCY_CONFLICT") {
      return { kind: "IDEMPOTENCY_CONFLICT" };
    }
    if (outcome.kind === "CUSTOMER_NOT_FOUND") {
      return { kind: "CUSTOMER_NOT_FOUND", customerId: outcome.customerId };
    }

    return {
      kind: outcome.kind === "CREATED" ? "CREATED" : "IDEMPOTENT",
      saleId: outcome.saleId,
      saleNumber: outcome.saleNumber,
      payableAmount: checksumInput.payable_amount,
      calculationChecksum: outcome.calculationChecksum,
    };
  }
}
