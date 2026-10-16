import { CanonicalPermission } from "@pos-platform/contracts";
import {
  createActor,
  createOperationScope,
  evaluatePermission,
  toRoleAssignments,
} from "@pos-platform/application";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import type { Receipt } from "./receipt.js";
import type { SqliteReceiptStore } from "./sqlite-receipt-store.js";

export const PERMISSION_SALES_RECEIPT_READ = CanonicalPermission.SALES_RECEIPT_READ;

export type GetReceiptResult =
  | { readonly kind: "FOUND"; readonly receipt: Receipt }
  | { readonly kind: "NOT_FOUND" }
  | { readonly kind: "NOT_COMPLETED" }
  | { readonly kind: "UNAUTHORIZED"; readonly reason: string };

/**
 * Obtener el recibo de una venta cobrada (`DEC-019`).
 *
 * `NOT_FOUND` y `NOT_COMPLETED` no se colapsan, y la diferencia importa en el
 * mostrador: «esa venta no es de esta caja» y «esa venta todavía no está
 * cobrada» piden dos reacciones distintas del cajero. Colapsarlas en un único
 * error le haría buscar un problema donde no lo hay.
 *
 * Permiso propio, `SALES_RECEIPT_READ`, y no el de crear la venta: reimprimir un
 * recibo es leer lo que se vendió y cuánto se cobró, y quien atiende el mostrador
 * no tiene por qué poder hacer ambas cosas.
 */
export class GetReceiptUseCase {
  constructor(private readonly receiptStore: SqliteReceiptStore) {}

  execute(
    scope: SyncScope,
    authSnapshot: StoredAuthorizationSnapshot,
    saleId: string,
    at: Date = new Date(),
  ): GetReceiptResult {
    const decision = evaluatePermission({
      actor: createActor("USER", authSnapshot.claims.user_id),
      permission: PERMISSION_SALES_RECEIPT_READ,
      scope: createOperationScope(scope.tenantId, scope.companyId, scope.branchId),
      at,
      assignments: toRoleAssignments(authSnapshot.claims),
    });
    if (!decision.allowed) return { kind: "UNAUTHORIZED", reason: decision.reason };

    const receipt = this.receiptStore.getReceipt(scope, saleId);
    if (receipt !== null) return { kind: "FOUND", receipt };

    // El almacén devuelve `null` en dos situaciones distintas. Distinguirlas
    // exige una segunda consulta, y se prefiere eso a devolver un error que
    // mienta sobre cuál de las dos ocurrió.
    return this.receiptStore.saleExists(scope, saleId) ? { kind: "NOT_COMPLETED" } : { kind: "NOT_FOUND" };
  }
}
