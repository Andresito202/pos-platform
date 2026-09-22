import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import type { RegisterProductUseCase } from "./register-product-use-case.js";
import type { SetFiscalAttributeUseCase } from "./set-fiscal-attribute-use-case.js";
import type { ReceiveStockUseCase } from "../inventory/receive-stock-use-case.js";

/**
 * Carga inicial del catálogo — `catalog.item.import`.
 *
 * ## Qué hace, y por qué no hace más
 *
 * **Compone los tres casos de uso que ya existen**; no escribe una tabla. Una
 * ruta de importación con sus propias validaciones acabaría admitiendo lo que
 * la ruta normal rechaza, y esa divergencia no la vería nadie hasta que un
 * artículo importado se comportara distinto a uno capturado a mano.
 *
 * Eso tiene un coste deliberado: cada fila paga la autorización y la
 * idempotencia completas de cada operación. Es más lento que un `INSERT`
 * masivo y es **la única forma de que un artículo importado sea el mismo
 * artículo**.
 *
 * ## Fila a fila, no todo o nada
 *
 * Tres mil filas y la 1.742 trae un código repetido: descartar las 2.999
 * buenas obligaría a corregir a ciegas. Cada fila es atómica en sí misma y
 * devuelve su desenlace con su índice.
 *
 * ## Dónde se detiene una fila
 *
 * El orden es artículo → códigos fiscales → existencia, y **no se revierte**
 * lo anterior cuando falla lo siguiente. Un artículo creado sin sus códigos
 * fiscales existe y no se factura —fail-closed, y el resultado lo dice—; uno
 * con códigos y sin existencia existe y no se vende hasta que llegue. Las dos
 * situaciones son recuperables reimportando la fila corregida. Deshacer el
 * artículo para «dejar limpio» perdería el trabajo bueno de la fila y
 * obligaría a repetirlo entero.
 */

export interface ImportCatalogItem {
  readonly code: string;
  readonly name: string;
  readonly stockControlled: boolean;
  readonly presentationName: string;
  readonly unitCode: string;
  readonly unitPrecision: number;
  readonly barcode: string | null;
  readonly priceAmount: string;
  readonly currencyCode: string;
  readonly initialQuantity: string | null;
  readonly fiscal: {
    readonly codeReference: string;
    readonly unitMeasureCode: string;
    readonly standardCode: string;
    readonly taxCode: string;
    readonly taxRate: string;
  } | null;
}

export interface ImportCatalogRequest {
  readonly items: readonly ImportCatalogItem[];
  readonly businessDate: string;
  readonly reasonCode: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

export type ImportRowOutcome =
  | "IMPORTED"
  | "CODE_ALREADY_REGISTERED"
  | "BARCODE_ALREADY_REGISTERED"
  | "FISCAL_CODES_NOT_VERIFIED"
  | "STOCK_NOT_APPLIED";

export interface ImportRejectedRow {
  readonly index: number;
  readonly code: string;
  readonly outcome: ImportRowOutcome;
}

export type ImportCatalogResult =
  | { readonly kind: "COMPLETED"; readonly imported: number; readonly rejected: readonly ImportRejectedRow[] }
  | { readonly kind: "UNAUTHORIZED"; readonly reason: string };

export class ImportCatalogUseCase {
  constructor(
    private readonly registerProduct: RegisterProductUseCase,
    private readonly setFiscalAttribute: SetFiscalAttributeUseCase,
    private readonly receiveStock: ReceiveStockUseCase,
  ) {}

  execute(
    scope: SyncScope,
    sessionId: string,
    authSnapshot: StoredAuthorizationSnapshot,
    request: ImportCatalogRequest,
    at: Date = new Date(),
  ): ImportCatalogResult {
    const rejected: ImportRejectedRow[] = [];
    let imported = 0;

    for (const [index, item] of request.items.entries()) {
      // La clave de cada fila deriva de la del lote y del código del artículo.
      // Reimportar el mismo lote no duplica nada, y reimportar sólo las filas
      // corregidas tampoco choca con las que ya entraron.
      const rowKey = `${request.idempotencyKey}:${item.code}`;

      const product = this.registerProduct.execute(scope, sessionId, authSnapshot, {
        code: item.code,
        name: item.name,
        stockControlled: item.stockControlled,
        presentationName: item.presentationName,
        unitCode: item.unitCode,
        unitPrecision: item.unitPrecision,
        barcode: item.barcode,
        priceAmount: item.priceAmount,
        currencyCode: item.currencyCode,
        idempotencyKey: rowKey,
        correlationId: request.correlationId,
        causationId: request.causationId,
      }, at);

      // La autorización no es de la fila sino del lote: si falta el permiso,
      // falta para las quinientas. Se corta en vez de repetir el mismo
      // rechazo quinientas veces.
      if (product.kind === "UNAUTHORIZED") return product;

      if (product.kind === "CODE_ALREADY_REGISTERED" || product.kind === "BARCODE_ALREADY_REGISTERED") {
        rejected.push({ index, code: item.code, outcome: product.kind });
        continue;
      }
      if (product.kind !== "REGISTERED" && product.kind !== "IDEMPOTENT") {
        rejected.push({ index, code: item.code, outcome: "CODE_ALREADY_REGISTERED" });
        continue;
      }

      if (item.fiscal !== null) {
        const fiscal = this.setFiscalAttribute.execute(scope, sessionId, authSnapshot, {
          presentationId: product.presentationId,
          codeReference: item.fiscal.codeReference,
          unitMeasureCode: item.fiscal.unitMeasureCode,
          standardCode: item.fiscal.standardCode,
          taxCode: item.fiscal.taxCode,
          taxRate: item.fiscal.taxRate,
          status: "ACTIVE",
          idempotencyKey: `${rowKey}:fiscal`,
          correlationId: request.correlationId,
          causationId: request.causationId,
        }, at);
        if (fiscal.kind === "UNAUTHORIZED") return fiscal;
        if (fiscal.kind !== "SET" && fiscal.kind !== "IDEMPOTENT") {
          rejected.push({ index, code: item.code, outcome: "FISCAL_CODES_NOT_VERIFIED" });
          continue;
        }
      }

      if (item.initialQuantity !== null) {
        const stock = this.receiveStock.execute(scope, sessionId, authSnapshot, {
          presentationId: product.presentationId,
          movementType: "OPENING_COUNT",
          quantity: item.initialQuantity,
          reasonCode: request.reasonCode,
          businessDate: request.businessDate,
          idempotencyKey: `${rowKey}:stock`,
          correlationId: request.correlationId,
          causationId: request.causationId,
        }, at);
        if (stock.kind === "UNAUTHORIZED") return stock;
        if (stock.kind !== "POSTED" && stock.kind !== "IDEMPOTENT") {
          rejected.push({ index, code: item.code, outcome: "STOCK_NOT_APPLIED" });
          continue;
        }
      }

      imported += 1;
    }

    return { kind: "COMPLETED", imported, rejected };
  }
}
