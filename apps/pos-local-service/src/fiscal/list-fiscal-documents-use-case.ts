import {
  createActor,
  createOperationScope,
  evaluatePermission,
  toRoleAssignments,
} from "@pos-platform/application";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import { PERMISSION_SALES_RECEIPT_READ } from "../receipts/get-receipt-use-case.js";
import type {
  DocumentScope,
  SqliteFiscalDocumentStore,
  StoredElectronicDocument,
} from "./sqlite-fiscal-document-store.js";

export type ListFiscalDocumentsResult =
  | { readonly kind: "LISTED"; readonly documents: readonly StoredElectronicDocument[] }
  | { readonly kind: "UNAUTHORIZED"; readonly reason: string };

/**
 * Los documentos fiscales de una venta, con a quién se facturó cada uno.
 *
 * Lo pide el rastro de un retiro sanitario: con `D-40` una factura puede ir,
 * confirmada, a nombre de alguien distinto del cliente de la venta, y ese
 * alguien también compró la tanda.
 *
 * **Permiso: `SALES_RECEIPT_READ`.** No se inventa uno: un permiso nuevo
 * dejaría sin esta lectura a todo comercio ya configurado. El documento
 * fiscal de una venta es parte de lo que ve quien puede leer su recibo; el
 * nombre y el contacto del adquiriente siguen detrás de `customer.get`, con
 * el permiso de Clientes.
 *
 * Es sólo lectura del módulo dueño —Electronic Invoicing— y no necesita que
 * la emisión esté configurada: leer lo ya emitido no requiere credencial.
 */
export class ListFiscalDocumentsUseCase {
  constructor(private readonly documentStore: SqliteFiscalDocumentStore) {}

  execute(
    scope: DocumentScope,
    authSnapshot: StoredAuthorizationSnapshot,
    saleId: string,
    at: Date = new Date(),
  ): ListFiscalDocumentsResult {
    const decision = evaluatePermission({
      actor: createActor("USER", authSnapshot.claims.user_id),
      permission: PERMISSION_SALES_RECEIPT_READ,
      scope: createOperationScope(scope.tenantId, scope.companyId, scope.branchId),
      at,
      assignments: toRoleAssignments(authSnapshot.claims),
    });
    if (!decision.allowed) return { kind: "UNAUTHORIZED", reason: decision.reason };
    return { kind: "LISTED", documents: this.documentStore.listForSale(scope, saleId) };
  }
}
