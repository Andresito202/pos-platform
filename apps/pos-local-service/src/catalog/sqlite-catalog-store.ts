import type { LocalDatabase } from "@pos-platform/database-sqlite";
import { canonicalJson } from "../channel/canonical-json.js";
import type { DurableSyncStore, SyncScope } from "../sync/durable-sync-store.js";

/**
 * Catálogo real — `MIGRATION_014`.
 *
 * Sustituye a `SandboxCatalogStore`, que era fixture de `BLOQUE 4C` poblado
 * únicamente por pruebas. **Es la única fuente de catálogo de la venta**: no
 * quedan dos lecturas del mismo producto, que es la clase de defecto que este
 * proyecto ya pagó con la aritmética del dinero.
 *
 * Guarda lo que los diez comercios prioritarios necesitan para vender —
 * referencia, presentación con su unidad, código de barras y precio— y nada
 * más. Categorías y variantes no están porque ningún comercio de la lista está
 * bloqueado hoy por no tenerlas.
 */

const CATALOG_PAYLOAD_SCHEMA_VERSION = "1.0.0";

/** Alcance del catálogo: compañía. Un producto no pertenece a una caja. */
export interface CatalogScope {
  readonly tenantId: string;
  readonly companyId: string;
}

export interface CatalogProduct {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly stockControlled: boolean;
}

export interface CatalogPresentation {
  readonly id: string;
  readonly productId: string;
  readonly name: string;
  readonly unitCode: string;
  readonly unitPrecision: number;
  readonly barcode: string | null;
}

export interface CatalogPrice {
  readonly amount: string;
  readonly currencyCode: string;
}

/** Lo que la caja necesita de un escaneo: qué es, cómo se mide y cuánto vale. */
export interface CatalogItem {
  readonly product: CatalogProduct;
  readonly presentation: CatalogPresentation;
  readonly price: CatalogPrice | null;
}

/** Atributos fiscales de la presentación — `MIGRATION_013`. */
export interface CatalogFiscalAttribute {
  readonly codeReference: string;
  readonly unitMeasureCode: string;
  readonly standardCode: string;
  readonly taxCode: string;
  /** Tasa en porcentaje, escala 6. `"19.000000"` es el 19 %. */
  readonly taxRate: string;
}

export interface RegisterProductInput {
  readonly scope: SyncScope;
  readonly sessionId: string;
  readonly operatorUserId: string;
  readonly productId: string;
  readonly presentationId: string;
  readonly priceId: string;
  readonly operationId: string;
  readonly code: string;
  readonly name: string;
  readonly stockControlled: boolean;
  readonly presentationName: string;
  readonly unitCode: string;
  readonly unitPrecision: number;
  readonly barcode: string | null;
  readonly priceAmount: string;
  readonly currencyCode: string;
  readonly idempotencyKey: string;
  readonly requestChecksum: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

export type RegisterProductOutcome =
  | { readonly kind: "REGISTERED"; readonly productId: string; readonly presentationId: string }
  | { readonly kind: "IDEMPOTENT"; readonly productId: string; readonly presentationId: string }
  | { readonly kind: "IDEMPOTENCY_CONFLICT" }
  | { readonly kind: "CODE_ALREADY_REGISTERED"; readonly productId: string }
  | { readonly kind: "BARCODE_ALREADY_REGISTERED"; readonly presentationId: string };

interface ProductRow {
  id: string; code: string; name: string; stock_controlled: number;
}
interface PresentationRow {
  id: string; product_id: string; name: string;
  unit_code: string; unit_precision: number; barcode: string | null;
}
interface PriceRow { amount: string; currency_code: string }
interface NextSequenceRow { next_sequence: number }

const PRODUCT_COLUMNS = "id, code, name, stock_controlled";
const PRESENTATION_COLUMNS = "id, product_id, name, unit_code, unit_precision, barcode";

function toProduct(row: ProductRow): CatalogProduct {
  return {
    id: row.id, code: row.code, name: row.name,
    stockControlled: row.stock_controlled === 1,
  };
}

function toPresentation(row: PresentationRow): CatalogPresentation {
  return {
    id: row.id, productId: row.product_id, name: row.name,
    unitCode: row.unit_code, unitPrecision: row.unit_precision, barcode: row.barcode,
  };
}

export class SqliteCatalogStore {
  constructor(
    private readonly database: LocalDatabase,
    private readonly durableSync: DurableSyncStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  // ── Lectura: lo que consume la venta ────────────────────────────────────────

  findActiveProduct(scope: CatalogScope, productId: string): CatalogProduct | null {
    const row = this.database.native.prepare(
      `SELECT ${PRODUCT_COLUMNS} FROM catalog_product
       WHERE tenant_id=? AND company_id=? AND id=? AND status='ACTIVE'`,
    ).get(scope.tenantId, scope.companyId, productId) as ProductRow | undefined;
    return row === undefined ? null : toProduct(row);
  }

  findActivePresentation(scope: CatalogScope, presentationId: string): CatalogPresentation | null {
    const row = this.database.native.prepare(
      `SELECT ${PRESENTATION_COLUMNS} FROM catalog_presentation
       WHERE tenant_id=? AND id=? AND status='ACTIVE'`,
    ).get(scope.tenantId, presentationId) as PresentationRow | undefined;
    return row === undefined ? null : toPresentation(row);
  }

  getActivePrice(scope: CatalogScope, presentationId: string): CatalogPrice | null {
    const row = this.database.native.prepare(
      `SELECT amount, currency_code FROM catalog_price
       WHERE tenant_id=? AND presentation_id=? AND status='ACTIVE'`,
    ).get(scope.tenantId, presentationId) as PriceRow | undefined;
    return row === undefined ? null : { amount: row.amount, currencyCode: row.currency_code };
  }

  /**
   * Atributos fiscales `ACTIVE` de la presentación, o `null` si no los declara.
   *
   * `null` significa «esta presentación no se puede facturar todavía», nunca
   * «está exenta». Quien lo consume tiene que distinguir las dos cosas.
   */
  getFiscalAttribute(scope: CatalogScope, presentationId: string): CatalogFiscalAttribute | null {
    const row = this.database.native.prepare(
      `SELECT code_reference, unit_measure_code, standard_code, tax_code, tax_rate
       FROM catalog_fiscal_attribute
       WHERE tenant_id=? AND presentation_id=? AND status='ACTIVE'`,
    ).get(scope.tenantId, presentationId) as
      | {
          code_reference: string; unit_measure_code: string; standard_code: string;
          tax_code: string; tax_rate: string;
        }
      | undefined;
    if (row === undefined) return null;
    return {
      codeReference: row.code_reference,
      unitMeasureCode: row.unit_measure_code,
      standardCode: row.standard_code,
      taxCode: row.tax_code,
      taxRate: row.tax_rate,
    };
  }

  /**
   * Lo que hace un lector de código de barras: del código al artículo completo.
   *
   * El índice único garantiza que un código identifica **una sola**
   * presentación; sin esa garantía el cajero cobraría un producto distinto del
   * escaneado sin forma de notarlo.
   */
  findByBarcode(scope: CatalogScope, barcode: string): CatalogItem | null {
    const presentation = this.database.native.prepare(
      `SELECT ${PRESENTATION_COLUMNS} FROM catalog_presentation
       WHERE tenant_id=? AND barcode=? AND status='ACTIVE'`,
    ).get(scope.tenantId, barcode) as PresentationRow | undefined;
    if (presentation === undefined) return null;
    return this.assembleItem(scope, presentation);
  }

  findItemByPresentation(scope: CatalogScope, presentationId: string): CatalogItem | null {
    const presentation = this.database.native.prepare(
      `SELECT ${PRESENTATION_COLUMNS} FROM catalog_presentation
       WHERE tenant_id=? AND id=? AND status='ACTIVE'`,
    ).get(scope.tenantId, presentationId) as PresentationRow | undefined;
    if (presentation === undefined) return null;
    return this.assembleItem(scope, presentation);
  }

  /**
   * Une presentación, producto y precio.
   *
   * Devuelve `null` si el producto no está activo: una presentación de un
   * producto retirado no es vendible aunque la fila siga ahí.
   */
  private assembleItem(scope: CatalogScope, row: PresentationRow): CatalogItem | null {
    const product = this.findActiveProduct(scope, row.product_id);
    if (product === null) return null;
    return {
      product,
      presentation: toPresentation(row),
      price: this.getActivePrice(scope, row.id),
    };
  }

  /**
   * Lista presentaciones vendibles para la caja.
   *
   * Sólo devuelve productos/presentaciones ACTIVOS con precio ACTIVO. El
   * renderer no recibe filas que no pueda cobrar y nunca inventa un precio.
   */
  listSellableItems(
    scope: CatalogScope,
    query: string,
    limit: number,
    offset: number,
  ): { readonly items: CatalogItem[]; readonly hasMore: boolean } {
    const normalizedQuery = query.trim();
    const like = normalizedQuery === "" ? null : `%${normalizedQuery}%`;
    const rows = this.database.native.prepare(
      `SELECT
         p.id AS product_id, p.code AS product_code, p.name AS product_name,
         p.stock_controlled,
         cp.id AS presentation_id, cp.name AS presentation_name,
         cp.unit_code, cp.unit_precision, cp.barcode,
         pr.amount AS price_amount, pr.currency_code
       FROM catalog_product p
       INNER JOIN catalog_presentation cp
         ON cp.tenant_id=p.tenant_id AND cp.product_id=p.id AND cp.status='ACTIVE'
       INNER JOIN catalog_price pr
         ON pr.tenant_id=cp.tenant_id AND pr.presentation_id=cp.id AND pr.status='ACTIVE'
       WHERE p.tenant_id=? AND p.company_id=? AND p.status='ACTIVE'
         AND (? IS NULL OR p.name LIKE ? OR p.code LIKE ? OR cp.barcode LIKE ?)
       ORDER BY p.name COLLATE NOCASE ASC, cp.name COLLATE NOCASE ASC, cp.id ASC
       LIMIT ? OFFSET ?`,
    ).all(
      scope.tenantId, scope.companyId, like, like, like, like, limit + 1, offset,
    ) as Array<{
      product_id: string; product_code: string; product_name: string; stock_controlled: number;
      presentation_id: string; presentation_name: string; unit_code: string; unit_precision: number;
      barcode: string | null; price_amount: string; currency_code: string;
    }>;

    const hasMore = rows.length > limit;
    const visibleRows = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: visibleRows.map((row) => ({
        product: {
          id: row.product_id,
          code: row.product_code,
          name: row.product_name,
          stockControlled: row.stock_controlled === 1,
        },
        presentation: {
          id: row.presentation_id,
          productId: row.product_id,
          name: row.presentation_name,
          unitCode: row.unit_code,
          unitPrecision: row.unit_precision,
          barcode: row.barcode,
        },
        price: { amount: row.price_amount, currencyCode: row.currency_code },
      })),
      hasMore,
    };
  }

  // ── Escritura ───────────────────────────────────────────────────────────────

  /**
   * Registra producto, presentación y precio **en una sola transacción**.
   *
   * No se parten en tres operaciones porque un producto sin presentación
   * vendible, o una presentación sin precio, no sirven en una caja: dejarlos a
   * medias sería un estado que ninguna pantalla puede resolver.
   */
  register(input: RegisterProductInput): RegisterProductOutcome {
    return this.database.native.transaction((): RegisterProductOutcome => {
      const nowIso = this.now().toISOString();
      // Idempotencia antes de escribir: dejar saltar la restricción UNIQUE
      // convertiría una repetición legítima en una excepción no controlada.
      const operation = this.database.native.prepare(
        "SELECT payload_checksum FROM runtime_operations WHERE idempotency_key=?",
      ).get(input.idempotencyKey) as { payload_checksum: string } | undefined;

      if (operation !== undefined) {
        if (operation.payload_checksum !== input.requestChecksum) {
          return { kind: "IDEMPOTENCY_CONFLICT" };
        }
        const existing = this.database.native.prepare(
          "SELECT id FROM catalog_product WHERE tenant_id=? AND idempotency_key=?",
        ).get(input.scope.tenantId, input.idempotencyKey) as { id: string } | undefined;
        if (existing === undefined) return { kind: "IDEMPOTENCY_CONFLICT" };
        const presentation = this.database.native.prepare(
          "SELECT id FROM catalog_presentation WHERE tenant_id=? AND product_id=?",
        ).get(input.scope.tenantId, existing.id) as { id: string } | undefined;
        return {
          kind: "IDEMPOTENT",
          productId: existing.id,
          presentationId: presentation?.id ?? "",
        };
      }

      // La referencia identifica al producto dentro de la compañía. Se devuelve
      // cuál es el que ya existe: quien registra necesita ir a él, no reintentar.
      const duplicateCode = this.database.native.prepare(
        "SELECT id FROM catalog_product WHERE tenant_id=? AND company_id=? AND code=?",
      ).get(input.scope.tenantId, input.scope.companyId, input.code) as { id: string } | undefined;
      if (duplicateCode !== undefined) {
        return { kind: "CODE_ALREADY_REGISTERED", productId: duplicateCode.id };
      }

      if (input.barcode !== null) {
        const duplicateBarcode = this.database.native.prepare(
          "SELECT id FROM catalog_presentation WHERE tenant_id=? AND barcode=?",
        ).get(input.scope.tenantId, input.barcode) as { id: string } | undefined;
        if (duplicateBarcode !== undefined) {
          return { kind: "BARCODE_ALREADY_REGISTERED", presentationId: duplicateBarcode.id };
        }
      }

      this.database.native.prepare(
        `INSERT INTO catalog_product(
          id, tenant_id, company_id, code, name, status, stock_controlled,
          registered_by_actor_id, idempotency_key, correlation_id,
          version, created_at, updated_at
        ) VALUES (?,?,?,?,?,'ACTIVE',?,?,?,?,1,?,?)`,
      ).run(
        input.productId, input.scope.tenantId, input.scope.companyId,
        input.code, input.name, input.stockControlled ? 1 : 0,
        input.operatorUserId, input.idempotencyKey, input.correlationId,
        nowIso, nowIso,
      );

      this.database.native.prepare(
        `INSERT INTO catalog_presentation(
          id, tenant_id, product_id, name, unit_code, unit_precision,
          barcode, status, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,'ACTIVE',?,?)`,
      ).run(
        input.presentationId, input.scope.tenantId, input.productId,
        input.presentationName, input.unitCode, input.unitPrecision,
        input.barcode, nowIso, nowIso,
      );

      this.database.native.prepare(
        `INSERT INTO catalog_price(
          id, tenant_id, presentation_id, amount, currency_code,
          status, created_at, updated_at
        ) VALUES (?,?,?,?,?,'ACTIVE',?,?)`,
      ).run(
        input.priceId, input.scope.tenantId, input.presentationId,
        input.priceAmount, input.currencyCode, nowIso, nowIso,
      );

      this.database.native.prepare(
        `INSERT INTO runtime_operations(
          operation_id, idempotency_key, payload_checksum, status, result_code, created_at, updated_at)
         VALUES (?,?,?,'SUCCEEDED','REGISTERED',?,?)`,
      ).run(input.operationId, input.idempotencyKey, input.requestChecksum, nowIso, nowIso);

      // Auditoría: qué se hizo y con qué referencia, no el precio. El importe es
      // el dato que un rastro no necesita y que su filtración sí facilita.
      this.database.native.prepare(
        `INSERT INTO local_operation_audit(
          tenant_id, company_id, branch_id, device_id,
          actor_type, actor_id, session_id,
          action_code, resource_type, resource_id,
          correlation_id, causation_id, reason_code, details_json, created_at
        ) VALUES (?,?,?,?,'USER',?,?,'CATALOG_PRODUCT_REGISTER','CATALOG_PRODUCT',?,?,?,NULL,?,?)`,
      ).run(
        input.scope.tenantId, input.scope.companyId, input.scope.branchId, input.scope.deviceId,
        input.operatorUserId, input.sessionId,
        input.productId, input.correlationId, input.causationId,
        canonicalJson({ code: input.code, unit_code: input.unitCode }),
        nowIso,
      );

      this.enqueue(input, nowIso);
      return {
        kind: "REGISTERED",
        productId: input.productId,
        presentationId: input.presentationId,
      };
    })();
  }

  private enqueue(input: RegisterProductInput, nowIso: string): void {
    const nextSequence = (this.database.native.prepare(
      `SELECT COALESCE(MAX(local_sequence), 0) + 1 AS next_sequence FROM local_sync_outbox
       WHERE tenant_id=? AND company_id=? AND branch_id=? AND device_id=? AND installation_id=?`,
    ).get(
      input.scope.tenantId, input.scope.companyId, input.scope.branchId,
      input.scope.deviceId, input.scope.installationId,
    ) as NextSequenceRow).next_sequence;

    this.durableSync.enqueue({
      operation_id: input.operationId,
      tenant_id: input.scope.tenantId,
      company_id: input.scope.companyId,
      branch_id: input.scope.branchId,
      device_id: input.scope.deviceId,
      installation_id: input.scope.installationId,
      session_id: input.sessionId,
      actor_id: input.operatorUserId,
      aggregate_type: "CATALOG_PRODUCT",
      aggregate_id: input.productId,
      operation_type: "CATALOG_PRODUCT_REGISTER",
      authority_policy: "LOCAL_AUTHORITATIVE_UNTIL_SYNC",
      local_sequence: nextSequence,
      idempotency_key: input.idempotencyKey,
      expected_version: null,
      payload_schema_version: CATALOG_PAYLOAD_SCHEMA_VERSION,
      payload: {
        product_id: input.productId,
        presentation_id: input.presentationId,
        code: input.code,
        name: input.name,
        stock_controlled: input.stockControlled,
        presentation_name: input.presentationName,
        unit_code: input.unitCode,
        unit_precision: input.unitPrecision,
        barcode: input.barcode,
        price_amount: input.priceAmount,
        currency_code: input.currencyCode,
      },
      payload_checksum: input.requestChecksum,
      causation_id: input.causationId,
      correlation_id: input.correlationId,
      occurred_at_local: nowIso,
      recorded_at_local: nowIso,
    });
  }
}
