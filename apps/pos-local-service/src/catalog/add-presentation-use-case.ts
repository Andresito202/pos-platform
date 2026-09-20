import { createHash } from "node:crypto";
import {
  createActor,
  createOperationScope,
  evaluatePermission,
  toRoleAssignments,
} from "@pos-platform/application";
import { uuidV7 } from "@pos-platform/contracts";
import { canonicalJson } from "../channel/canonical-json.js";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import { PERMISSION_CATALOG_PRODUCT_REGISTER } from "./register-product-use-case.js";
import type { AddPresentationOutcome, SqliteCatalogStore } from "./sqlite-catalog-store.js";

/**
 * Añade una presentación a un producto que ya existe.
 *
 * `DEC-004` fija `Product 1 ─── 1..N ProductPresentation`, y el esquema lo
 * admite desde `MIGRATION_014`. Lo que no existía era la vía para llegar a la
 * segunda: `catalog.product.register` crea producto, presentación y precio en
 * una sola transacción, y era la única escritura de catálogo. Una tienda de
 * barrio que vende la unidad y el paquete del mismo artículo no podía
 * representarlo.
 *
 * **No declara conversión, y eso hay que saberlo antes de usarla.** Cada
 * presentación lleva su propia existencia —`DEC-004` §1129: «el inventario
 * operativo pertenece a `ProductPresentation`»— así que vender una paca de 12
 * **no** descuenta 12 unidades de la presentación «unidad». Son dos saldos
 * independientes. Abrirla y convertirla exige `contained_quantity` y
 * `conversion_factor` (`DEC-004` §747), que `MIGRATION_014` no materializó.
 *
 * **Permiso.** Reutiliza `CATALOG_PRODUCT_REGISTER`: quien da de alta el
 * producto es quien declara sus presentaciones, y un permiso nuevo exigiría
 * sembrarlo en los roles, que es una decisión de autorización que este cambio
 * no tiene autorizada.
 */
export interface AddPresentationRequest {
  readonly productId: string;
  readonly name: string;
  readonly unitCode: string;
  readonly unitPrecision: number;
  readonly barcode: string | null;
  readonly priceAmount: string;
  readonly currencyCode: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

export type AddPresentationResult =
  | AddPresentationOutcome
  | { readonly kind: "UNAUTHORIZED"; readonly reason: string };

function requestChecksum(request: AddPresentationRequest, operatorUserId: string): string {
  return createHash("sha256")
    .update(canonicalJson({
      barcode: request.barcode,
      currency_code: request.currencyCode,
      idempotency_key: request.idempotencyKey,
      name: request.name,
      operator_user_id: operatorUserId,
      price_amount: request.priceAmount,
      product_id: request.productId,
      unit_code: request.unitCode,
      unit_precision: request.unitPrecision,
    }))
    .digest("hex");
}

export class AddPresentationUseCase {
  constructor(private readonly catalogStore: SqliteCatalogStore) {}

  execute(
    scope: SyncScope,
    sessionId: string,
    authSnapshot: StoredAuthorizationSnapshot,
    request: AddPresentationRequest,
    at: Date = new Date(),
  ): AddPresentationResult {
    const operatorUserId = authSnapshot.claims.user_id;
    const decision = evaluatePermission({
      actor: createActor("USER", operatorUserId),
      permission: PERMISSION_CATALOG_PRODUCT_REGISTER,
      scope: createOperationScope(scope.tenantId, scope.companyId, scope.branchId),
      at,
      assignments: toRoleAssignments(authSnapshot.claims),
    });
    if (!decision.allowed) return { kind: "UNAUTHORIZED", reason: decision.reason };

    return this.catalogStore.addPresentation({
      scope,
      sessionId,
      operatorUserId,
      productId: request.productId,
      presentationId: uuidV7(),
      priceId: uuidV7(),
      operationId: uuidV7(),
      name: request.name,
      unitCode: request.unitCode,
      unitPrecision: request.unitPrecision,
      barcode: request.barcode,
      priceAmount: request.priceAmount,
      currencyCode: request.currencyCode,
      idempotencyKey: request.idempotencyKey,
      requestChecksum: requestChecksum(request, operatorUserId),
      correlationId: request.correlationId,
      causationId: request.causationId,
    });
  }
}
