import { createHash } from "node:crypto";
import {
  createActor,
  createOperationScope,
  evaluatePermission,
  toRoleAssignments,
} from "@pos-platform/application";
import { canonicalJson } from "../channel/canonical-json.js";
import { bigIntToScale6, scale6ToBigInt } from "../money.js";
import { quantityFitsUnitPrecision } from "../sales/sale-calculation.js";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import type { SqliteCatalogStore } from "../catalog/sqlite-catalog-store.js";
import { PERMISSION_INVENTORY_STOCK_ADJUST } from "./adjust-stock-use-case.js";
import type { ApplyConversionOutcome, SqliteInventoryStore } from "./sqlite-inventory-store.js";

/** Escala 6: `a × b` en unidades enteras vuelve a escala 6 dividiendo por 10⁶. */
const SCALE6 = 1_000_000n;

export interface ApplyConversionRequest {
  readonly sourcePresentationId: string;
  readonly targetPresentationId: string;
  /** Cuánto del origen se transforma. Escala 6. */
  readonly sourceQuantity: string;
  readonly reasonCode: string;
  readonly businessDate: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

export type ApplyConversionResult =
  | ApplyConversionOutcome
  | { readonly kind: "UNAUTHORIZED"; readonly reason: string }
  | { readonly kind: "CONVERSION_NOT_DECLARED" }
  /** El producto de la conversión resultaría fraccionario para la unidad destino. */
  | { readonly kind: "TARGET_PRECISION_EXCEEDED"; readonly targetQuantity: string };

function requestChecksum(request: ApplyConversionRequest, operatorUserId: string): string {
  return createHash("sha256")
    .update(canonicalJson({
      business_date: request.businessDate,
      idempotency_key: request.idempotencyKey,
      operator_user_id: operatorUserId,
      reason_code: request.reasonCode,
      source_presentation_id: request.sourcePresentationId,
      source_quantity: request.sourceQuantity,
      target_presentation_id: request.targetPresentationId,
    }))
    .digest("hex");
}

/**
 * Abre una paca y la convierte en unidades — `DEC-004` §1736, conversión
 * atómica.
 *
 * **El factor no se teclea aquí.** Llega de `catalog_unit_conversion`, que es
 * donde lo dejó quien configuró el catálogo. Permitir que el mostrador
 * aportara el factor convertiría la conversión en un ajuste de existencia con
 * otro nombre, y un ajuste ya existe y se audita como tal.
 *
 * **La multiplicación no redondea.** `cantidad × factor` en escala 6 produce
 * unidades de escala 12; volver a escala 6 sólo es exacto si el resto es cero.
 * Si no lo es, la operación se rechaza en vez de inventar una cantidad: es la
 * misma disciplina de `toProviderDecimal`, y por la misma razón —un redondeo
 * silencioso aquí descuadra el inventario de un comerciante, no un registro
 * nuestro—.
 *
 * Además el resultado tiene que caber en la precisión de la unidad destino:
 * convertir a media unidad de un artículo que se vende entero no es una
 * conversión, es un error de captura.
 */
export class ApplyConversionUseCase {
  constructor(
    private readonly catalogStore: SqliteCatalogStore,
    private readonly inventoryStore: SqliteInventoryStore,
  ) {}

  execute(
    scope: SyncScope,
    sessionId: string,
    authSnapshot: StoredAuthorizationSnapshot,
    request: ApplyConversionRequest,
    at: Date = new Date(),
  ): ApplyConversionResult {
    const operatorUserId = authSnapshot.claims.user_id;
    const decision = evaluatePermission({
      actor: createActor("USER", operatorUserId),
      permission: PERMISSION_INVENTORY_STOCK_ADJUST,
      scope: createOperationScope(scope.tenantId, scope.companyId, scope.branchId),
      at,
      assignments: toRoleAssignments(authSnapshot.claims),
    });
    if (!decision.allowed) return { kind: "UNAUTHORIZED", reason: decision.reason };

    const conversion = this.catalogStore.findActiveConversion(
      scope, request.sourcePresentationId, request.targetPresentationId,
    );
    if (conversion === null) return { kind: "CONVERSION_NOT_DECLARED" };

    const product = scale6ToBigInt(request.sourceQuantity) * scale6ToBigInt(conversion.factor);
    if (product % SCALE6 !== 0n) {
      // Sin cantidad exacta no hay conversión. No se redondea.
      return { kind: "TARGET_PRECISION_EXCEEDED", targetQuantity: bigIntToScale6(product / SCALE6) };
    }
    const targetQuantity = bigIntToScale6(product / SCALE6);

    const target = this.catalogStore.findActivePresentation(scope, request.targetPresentationId);
    if (target === null) return { kind: "PRESENTATION_NOT_FOUND" };
    if (!quantityFitsUnitPrecision(targetQuantity, target.unitPrecision)) {
      return { kind: "TARGET_PRECISION_EXCEEDED", targetQuantity };
    }

    return this.inventoryStore.applyConversion({
      scope,
      sessionId,
      operatorUserId,
      sourcePresentationId: request.sourcePresentationId,
      targetPresentationId: request.targetPresentationId,
      sourceQuantity: request.sourceQuantity,
      targetQuantity,
      reasonCode: request.reasonCode,
      businessDate: request.businessDate,
      idempotencyKey: request.idempotencyKey,
      requestChecksum: requestChecksum(request, operatorUserId),
      correlationId: request.correlationId,
      causationId: request.causationId,
    });
  }
}
