import type { LocalDatabase } from "@pos-platform/database-sqlite";
import { uuidV7 } from "@pos-platform/contracts";
import { FiscalDocumentItemSchema, validateFiscalDocumentItem } from "@pos-platform/fiscal-adapters";
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
  readonly description: string | null;
  readonly brand: string | null;
  readonly category: string | null;
  readonly stockControlled: boolean;
  readonly version: number;
  readonly primaryMediaId: string | null;
}

export interface CatalogPresentation {
  readonly id: string;
  readonly productId: string;
  readonly name: string;
  readonly unitCode: string;
  readonly unitPrecision: number;
  readonly barcode: string | null;
  readonly version: number;
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

/** List query guarantees an ACTIVE price through its INNER JOIN. */
export type SellableCatalogItem = Omit<CatalogItem, "price"> & {
  readonly price: CatalogPrice;
};

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
  readonly description: string | null;
  readonly brand: string | null;
  readonly category: string | null;
  readonly stockControlled: boolean;
  readonly presentationName: string;
  readonly unitCode: string;
  readonly unitPrecision: number;
  readonly barcode: string | null;
  readonly priceAmount: string;
  readonly currencyCode: string;
  readonly fiscalAttributes?: CatalogFiscalAttribute;
  readonly idempotencyKey: string;
  readonly requestChecksum: string;
  readonly correlationId: string;
  readonly causationId: string | null;
}

export type RegisterProductOutcome =
  | { readonly kind: "REGISTERED"; readonly productId: string; readonly presentationId: string }
  | { readonly kind: "IDEMPOTENT"; readonly productId: string; readonly presentationId: string }
  | { readonly kind: "IDEMPOTENCY_CONFLICT" }
  | { readonly kind: "INVALID_FISCAL_ATTRIBUTES" }
  | { readonly kind: "CODE_ALREADY_REGISTERED"; readonly productId: string }
  | { readonly kind: "BARCODE_ALREADY_REGISTERED"; readonly presentationId: string };

interface ProductRow {
  id: string; code: string; name: string;
  description: string | null; brand: string | null; category: string | null;
  stock_controlled: number;
  version: number; primary_media_id: string | null;
}
interface PresentationRow {
  id: string; product_id: string; name: string;
  unit_code: string; unit_precision: number; barcode: string | null; version: number;
}
interface PriceRow { amount: string; currency_code: string }
interface NextSequenceRow { next_sequence: number }

const PRODUCT_COLUMNS =
  "id, code, name, description, brand, category, stock_controlled, version, primary_media_id";
const PRESENTATION_COLUMNS = "id, product_id, name, unit_code, unit_precision, barcode, version";

function toProduct(row: ProductRow): CatalogProduct {
  return {
    id: row.id, code: row.code, name: row.name,
    description: row.description,
    brand: row.brand,
    category: row.category,
    stockControlled: row.stock_controlled === 1,
    version: row.version,
    primaryMediaId: row.primary_media_id,
  };
}

function toPresentation(row: PresentationRow): CatalogPresentation {
  return {
    id: row.id, productId: row.product_id, name: row.name,
    unitCode: row.unit_code, unitPrecision: row.unit_precision, barcode: row.barcode,
    version: row.version,
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
  ): { readonly items: SellableCatalogItem[]; readonly hasMore: boolean } {
    const normalizedQuery = query.trim();
    const like = normalizedQuery === "" ? null : `%${normalizedQuery}%`;
    const rows = this.database.native.prepare(
      `SELECT
         p.id AS product_id, p.code AS product_code, p.name AS product_name,
         p.description AS product_description, p.brand AS product_brand, p.category AS product_category,
         p.stock_controlled, p.version AS product_version, p.primary_media_id,
         cp.id AS presentation_id, cp.name AS presentation_name,
         cp.unit_code, cp.unit_precision, cp.barcode, cp.version AS presentation_version,
         pr.amount AS price_amount, pr.currency_code
       FROM catalog_product p
       INNER JOIN catalog_presentation cp
         ON cp.tenant_id=p.tenant_id AND cp.product_id=p.id AND cp.status='ACTIVE'
       INNER JOIN catalog_price pr
         ON pr.tenant_id=cp.tenant_id AND pr.presentation_id=cp.id AND pr.status='ACTIVE'
       WHERE p.tenant_id=? AND p.company_id=? AND p.status='ACTIVE'
         AND (? IS NULL OR p.name LIKE ? OR p.code LIKE ? OR cp.barcode LIKE ?
              OR IFNULL(p.brand,'') LIKE ? OR IFNULL(p.category,'') LIKE ?)
       ORDER BY p.name COLLATE NOCASE ASC, cp.name COLLATE NOCASE ASC, cp.id ASC
       LIMIT ? OFFSET ?`,
    ).all(
      scope.tenantId, scope.companyId, like, like, like, like, like, like, limit + 1, offset,
    ) as Array<{
      product_id: string; product_code: string; product_name: string;
      product_description: string | null; product_brand: string | null; product_category: string | null;
      stock_controlled: number;
      product_version: number; primary_media_id: string | null;
      presentation_id: string; presentation_name: string; unit_code: string; unit_precision: number;
      barcode: string | null; presentation_version: number;
      price_amount: string; currency_code: string;
    }>;

    const hasMore = rows.length > limit;
    const visibleRows = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: visibleRows.map((row) => ({
        product: {
          id: row.product_id,
          code: row.product_code,
          name: row.product_name,
          description: row.product_description,
          brand: row.product_brand,
          category: row.product_category,
          stockControlled: row.stock_controlled === 1,
          version: row.product_version,
          primaryMediaId: row.primary_media_id,
        },
        presentation: {
          id: row.presentation_id,
          productId: row.product_id,
          name: row.presentation_name,
          unitCode: row.unit_code,
          unitPrecision: row.unit_precision,
          barcode: row.barcode,
          version: row.presentation_version,
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
    if (input.fiscalAttributes !== undefined) {
      const fiscal = input.fiscalAttributes;
      const parsed = FiscalDocumentItemSchema.safeParse({
        codeReference: fiscal.codeReference, name: input.name, quantity: "1.000000", unitPrice: input.priceAmount,
        unitMeasureCode: fiscal.unitMeasureCode, standardCode: fiscal.standardCode,
        discount: null, taxes: [{ code: fiscal.taxCode, rate: fiscal.taxRate }],
      });
      if (!parsed.success || validateFiscalDocumentItem(parsed.data).length > 0) return { kind: "INVALID_FISCAL_ATTRIBUTES" };
    }
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
          "SELECT id FROM catalog_product WHERE tenant_id=? AND company_id=? AND idempotency_key=?",
        ).get(input.scope.tenantId, input.scope.companyId, input.idempotencyKey) as { id: string } | undefined;
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
          id, tenant_id, company_id, code, name, description, brand, category,
          status, stock_controlled,
          registered_by_actor_id, idempotency_key, correlation_id,
          version, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,'ACTIVE',?,?,?,?,1,?,?)`,
      ).run(
        input.productId, input.scope.tenantId, input.scope.companyId,
        input.code, input.name, input.description, input.brand, input.category,
        input.stockControlled ? 1 : 0,
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

      if (input.fiscalAttributes !== undefined) {
        const fiscal = input.fiscalAttributes;
        this.database.native.prepare(
          `INSERT INTO catalog_fiscal_attribute(tenant_id,presentation_id,code_reference,unit_measure_code,
            standard_code,tax_code,tax_rate,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'ACTIVE',?,?)`,
        ).run(input.scope.tenantId,input.presentationId,fiscal.codeReference,fiscal.unitMeasureCode,
          fiscal.standardCode,fiscal.taxCode,fiscal.taxRate,nowIso,nowIso);
      }

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
        description: input.description,
        brand: input.brand,
        category: input.category,
        stock_controlled: input.stockControlled,
        presentation_name: input.presentationName,
        unit_code: input.unitCode,
        unit_precision: input.unitPrecision,
        barcode: input.barcode,
        price_amount: input.priceAmount,
        currency_code: input.currencyCode,
        ...(input.fiscalAttributes === undefined ? {} : { fiscal_attributes: {
          code_reference: input.fiscalAttributes.codeReference, unit_measure_code: input.fiscalAttributes.unitMeasureCode,
          standard_code: input.fiscalAttributes.standardCode, tax_code: input.fiscalAttributes.taxCode, tax_rate: input.fiscalAttributes.taxRate,
        } }),
      },
      payload_checksum: input.requestChecksum,
      causation_id: input.causationId,
      correlation_id: input.correlationId,
      occurred_at_local: nowIso,
      recorded_at_local: nowIso,
    });
  }

  /**
   * Adds a secondary presentation + ACTIVE price to an existing product.
   * Never creates inventory_stock — reception/transform create balances later.
   */
  addPresentation(input: {
    readonly scope: SyncScope;
    readonly sessionId: string;
    readonly operatorUserId: string;
    readonly productId: string;
    readonly presentationId: string;
    readonly priceId: string;
    readonly operationId: string;
    readonly presentationName: string;
    readonly unitCode: string;
    readonly unitPrecision: number;
    readonly barcode: string | null;
    readonly priceAmount: string;
    readonly currencyCode: string;
    readonly fiscalAttributes?: CatalogFiscalAttribute;
    readonly idempotencyKey: string;
    readonly requestChecksum: string;
    readonly correlationId: string;
    readonly causationId: string | null;
  }):
    | { readonly kind: "REGISTERED"; readonly productId: string; readonly presentationId: string }
    | { readonly kind: "IDEMPOTENT"; readonly productId: string; readonly presentationId: string }
    | { readonly kind: "IDEMPOTENCY_CONFLICT" }
    | { readonly kind: "PRODUCT_NOT_FOUND" }
    | { readonly kind: "BARCODE_ALREADY_REGISTERED"; readonly presentationId: string }
    | { readonly kind: "INVALID_FISCAL_ATTRIBUTES" }
    | { readonly kind: "INVALID_QUANTITY" } {
    if (input.unitPrecision < 0 || input.unitPrecision > 6) return { kind: "INVALID_QUANTITY" };
    if (input.fiscalAttributes !== undefined) {
      const fiscal = input.fiscalAttributes;
      const parsed = FiscalDocumentItemSchema.safeParse({
        codeReference: fiscal.codeReference, name: input.presentationName, quantity: "1.000000",
        unitPrice: input.priceAmount, unitMeasureCode: fiscal.unitMeasureCode,
        standardCode: fiscal.standardCode, discount: null,
        taxes: [{ code: fiscal.taxCode, rate: fiscal.taxRate }],
      });
      if (!parsed.success || validateFiscalDocumentItem(parsed.data).length > 0) {
        return { kind: "INVALID_FISCAL_ATTRIBUTES" };
      }
    }
    return this.database.native.transaction(() => {
      const nowIso = this.now().toISOString();
      const operation = this.database.native.prepare(
        "SELECT payload_checksum FROM runtime_operations WHERE idempotency_key=?",
      ).get(input.idempotencyKey) as { payload_checksum: string } | undefined;
      if (operation !== undefined) {
        if (operation.payload_checksum !== input.requestChecksum) return { kind: "IDEMPOTENCY_CONFLICT" as const };
        const outbox = this.database.native.prepare(
          "SELECT aggregate_id FROM local_sync_outbox WHERE tenant_id=? AND idempotency_key=?",
        ).get(input.scope.tenantId, input.idempotencyKey) as { aggregate_id: string } | undefined;
        const presentation = outbox === undefined ? undefined : this.database.native.prepare(
          "SELECT id, product_id FROM catalog_presentation WHERE tenant_id=? AND id=?",
        ).get(input.scope.tenantId, outbox.aggregate_id) as { id: string; product_id: string } | undefined;
        return {
          kind: "IDEMPOTENT" as const,
          productId: presentation?.product_id ?? input.productId,
          presentationId: presentation?.id ?? "",
        };
      }

      const product = this.database.native.prepare(
        "SELECT id FROM catalog_product WHERE tenant_id=? AND company_id=? AND id=? AND status='ACTIVE'",
      ).get(input.scope.tenantId, input.scope.companyId, input.productId) as { id: string } | undefined;
      if (!product) return { kind: "PRODUCT_NOT_FOUND" as const };

      if (input.barcode !== null) {
        const duplicateBarcode = this.database.native.prepare(
          "SELECT id FROM catalog_presentation WHERE tenant_id=? AND barcode=?",
        ).get(input.scope.tenantId, input.barcode) as { id: string } | undefined;
        if (duplicateBarcode !== undefined) {
          return { kind: "BARCODE_ALREADY_REGISTERED" as const, presentationId: duplicateBarcode.id };
        }
      }

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
      if (input.fiscalAttributes !== undefined) {
        const fiscal = input.fiscalAttributes;
        this.database.native.prepare(
          `INSERT INTO catalog_fiscal_attribute(tenant_id,presentation_id,code_reference,unit_measure_code,
            standard_code,tax_code,tax_rate,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'ACTIVE',?,?)`,
        ).run(input.scope.tenantId, input.presentationId, fiscal.codeReference, fiscal.unitMeasureCode,
          fiscal.standardCode, fiscal.taxCode, fiscal.taxRate, nowIso, nowIso);
      }
      this.database.native.prepare(
        `INSERT INTO runtime_operations(
          operation_id, idempotency_key, payload_checksum, status, result_code, created_at, updated_at)
         VALUES (?,?,?,'SUCCEEDED','PRESENTATION_REGISTERED',?,?)`,
      ).run(input.operationId, input.idempotencyKey, input.requestChecksum, nowIso, nowIso);
      this.database.native.prepare(
        `INSERT INTO local_operation_audit(
          tenant_id, company_id, branch_id, device_id,
          actor_type, actor_id, session_id,
          action_code, resource_type, resource_id,
          correlation_id, causation_id, reason_code, details_json, created_at
        ) VALUES (?,?,?,?,'USER',?,?,'CATALOG_PRESENTATION_REGISTER','CATALOG_PRESENTATION',?,?,?,NULL,?,?)`,
      ).run(
        input.scope.tenantId, input.scope.companyId, input.scope.branchId, input.scope.deviceId,
        input.operatorUserId, input.sessionId,
        input.presentationId, input.correlationId, input.causationId,
        canonicalJson({
          product_id: input.productId,
          presentation_name: input.presentationName,
          unit_code: input.unitCode,
          unit_precision: input.unitPrecision,
        }),
        nowIso,
      );
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
        aggregate_type: "CATALOG_PRESENTATION",
        aggregate_id: input.presentationId,
        operation_type: "CATALOG_PRESENTATION_REGISTER",
        authority_policy: "LOCAL_AUTHORITATIVE_UNTIL_SYNC",
        local_sequence: nextSequence,
        idempotency_key: input.idempotencyKey,
        expected_version: null,
        payload_schema_version: CATALOG_PAYLOAD_SCHEMA_VERSION,
        payload: {
          product_id: input.productId,
          presentation_id: input.presentationId,
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
      return {
        kind: "REGISTERED" as const,
        productId: input.productId,
        presentationId: input.presentationId,
      };
    })();
  }

  upsertFoodPolicy(input: {
    readonly scope: SyncScope;
    readonly sessionId: string;
    readonly operatorUserId: string;
    readonly productId: string;
    readonly conservationCode: "AMBIENT" | "CHILLED" | "FROZEN" | "CONTROLLED";
    readonly requiresLotTracking: boolean;
    readonly requiresExpiry: boolean;
    readonly notes: string | null;
    readonly idempotencyKey: string;
    readonly requestChecksum: string;
    readonly correlationId: string;
    readonly causationId: string | null;
  }):
    | { readonly kind: "SAVED"; readonly version: number }
    | { readonly kind: "IDEMPOTENT"; readonly version: number }
    | { readonly kind: "IDEMPOTENCY_CONFLICT" }
    | { readonly kind: "PRODUCT_NOT_FOUND" } {
    return this.database.native.transaction(() => {
      const nowIso = this.now().toISOString();
      const operation = this.database.native.prepare(
        "SELECT payload_checksum FROM runtime_operations WHERE idempotency_key=?",
      ).get(input.idempotencyKey) as { payload_checksum: string } | undefined;
      if (operation !== undefined) {
        if (operation.payload_checksum !== input.requestChecksum) return { kind: "IDEMPOTENCY_CONFLICT" as const };
        const existing = this.database.native.prepare(
          "SELECT version FROM catalog_food_policy WHERE tenant_id=? AND product_id=?",
        ).get(input.scope.tenantId, input.productId) as { version: number } | undefined;
        return { kind: "IDEMPOTENT" as const, version: existing?.version ?? 0 };
      }
      const product = this.database.native.prepare(
        "SELECT id FROM catalog_product WHERE tenant_id=? AND company_id=? AND id=?",
      ).get(input.scope.tenantId, input.scope.companyId, input.productId) as { id: string } | undefined;
      if (!product) return { kind: "PRODUCT_NOT_FOUND" as const };
      const prior = this.database.native.prepare(
        "SELECT version FROM catalog_food_policy WHERE tenant_id=? AND product_id=?",
      ).get(input.scope.tenantId, input.productId) as { version: number } | undefined;
      const version = (prior?.version ?? 0) + 1;
      if (prior) {
        this.database.native.prepare(
          `UPDATE catalog_food_policy
           SET company_id=?, conservation_code=?, requires_lot_tracking=?, requires_expiry=?,
               notes=?, version=?, updated_by=?, updated_at=?
           WHERE tenant_id=? AND product_id=?`,
        ).run(
          input.scope.companyId, input.conservationCode, input.requiresLotTracking ? 1 : 0,
          input.requiresExpiry ? 1 : 0, input.notes, version, input.operatorUserId, nowIso,
          input.scope.tenantId, input.productId,
        );
      } else {
        this.database.native.prepare(
          `INSERT INTO catalog_food_policy(
            tenant_id, company_id, product_id, conservation_code, requires_lot_tracking,
            requires_expiry, notes, version, updated_by, updated_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        ).run(
          input.scope.tenantId, input.scope.companyId, input.productId, input.conservationCode,
          input.requiresLotTracking ? 1 : 0, input.requiresExpiry ? 1 : 0, input.notes,
          version, input.operatorUserId, nowIso,
        );
      }
      this.database.native.prepare(
        `INSERT INTO runtime_operations(
          operation_id, idempotency_key, payload_checksum, status, result_code, created_at, updated_at)
         VALUES (?,?,?,'SUCCEEDED','FOOD_POLICY_SAVED',?,?)`,
      ).run(uuidV7(), input.idempotencyKey, input.requestChecksum, nowIso, nowIso);
      this.database.native.prepare(
        `INSERT INTO local_operation_audit(
          tenant_id, company_id, branch_id, device_id,
          actor_type, actor_id, session_id,
          action_code, resource_type, resource_id,
          correlation_id, causation_id, reason_code, details_json, created_at
        ) VALUES (?,?,?,?,'USER',?,?,'CATALOG_FOOD_POLICY_UPSERT','CATALOG_PRODUCT',?,?,?,NULL,?,?)`,
      ).run(
        input.scope.tenantId, input.scope.companyId, input.scope.branchId, input.scope.deviceId,
        input.operatorUserId, input.sessionId, input.productId, input.correlationId, input.causationId,
        canonicalJson({
          conservation_code: input.conservationCode,
          requires_lot_tracking: input.requiresLotTracking,
          requires_expiry: input.requiresExpiry,
          version,
        }),
        nowIso,
      );
      return { kind: "SAVED" as const, version };
    })();
  }

  getFoodPolicy(scope: CatalogScope, productId: string): {
    conservationCode: string;
    requiresLotTracking: boolean;
    requiresExpiry: boolean;
    notes: string | null;
    version: number;
  } | null {
    const row = this.database.native.prepare(
      `SELECT conservation_code, requires_lot_tracking, requires_expiry, notes, version
       FROM catalog_food_policy WHERE tenant_id=? AND company_id=? AND product_id=?`,
    ).get(scope.tenantId, scope.companyId, productId) as {
      conservation_code: string; requires_lot_tracking: number; requires_expiry: number;
      notes: string | null; version: number;
    } | undefined;
    if (!row) return null;
    return {
      conservationCode: row.conservation_code,
      requiresLotTracking: row.requires_lot_tracking === 1,
      requiresExpiry: row.requires_expiry === 1,
      notes: row.notes,
      version: row.version,
    };
  }

  updateProduct(input: {
    readonly scope: SyncScope;
    readonly sessionId: string;
    readonly operatorUserId: string;
    readonly operationId: string;
    readonly productId: string;
    readonly expectedVersion: number;
    readonly name?: string;
    readonly code?: string;
    readonly description?: string | null;
    readonly brand?: string | null;
    readonly category?: string | null;
    readonly status?: "ACTIVE" | "INACTIVE";
    readonly presentationId?: string;
    readonly presentationExpectedVersion?: number;
    readonly presentationName?: string;
    readonly barcode?: string | null;
    readonly reason: string | null;
    readonly idempotencyKey: string;
    readonly requestChecksum: string;
    readonly correlationId: string;
    readonly causationId: string | null;
  }):
    | { readonly kind: "UPDATED"; readonly productId: string; readonly version: number; readonly presentationVersion: number | null }
    | { readonly kind: "IDEMPOTENT"; readonly productId: string; readonly version: number; readonly presentationVersion: number | null }
    | { readonly kind: "NOT_FOUND" }
    | { readonly kind: "VERSION_CONFLICT"; readonly currentVersion: number }
    | { readonly kind: "PRESENTATION_VERSION_CONFLICT"; readonly currentVersion: number }
    | { readonly kind: "CODE_ALREADY_REGISTERED"; readonly productId: string }
    | { readonly kind: "BARCODE_ALREADY_REGISTERED"; readonly presentationId: string }
    | { readonly kind: "IDEMPOTENCY_CONFLICT" } {
    return this.database.native.transaction(() => {
      const nowIso = this.now().toISOString();
      const priorOp = this.database.native.prepare(
        "SELECT payload_checksum FROM runtime_operations WHERE idempotency_key=?",
      ).get(input.idempotencyKey) as { payload_checksum: string } | undefined;
      if (priorOp !== undefined) {
        if (priorOp.payload_checksum !== input.requestChecksum) return { kind: "IDEMPOTENCY_CONFLICT" as const };
        const product = this.database.native.prepare(
          `SELECT version FROM catalog_product WHERE tenant_id=? AND company_id=? AND id=?`,
        ).get(input.scope.tenantId, input.scope.companyId, input.productId) as { version: number } | undefined;
        if (!product) return { kind: "NOT_FOUND" as const };
        let presentationVersion: number | null = null;
        if (input.presentationId) {
          const presentation = this.database.native.prepare(
            `SELECT version FROM catalog_presentation WHERE tenant_id=? AND id=? AND product_id=?`,
          ).get(input.scope.tenantId, input.presentationId, input.productId) as { version: number } | undefined;
          presentationVersion = presentation?.version ?? null;
        }
        return {
          kind: "IDEMPOTENT" as const,
          productId: input.productId,
          version: product.version,
          presentationVersion,
        };
      }

      const current = this.database.native.prepare(
        `SELECT version FROM catalog_product WHERE tenant_id=? AND company_id=? AND id=?`,
      ).get(input.scope.tenantId, input.scope.companyId, input.productId) as { version: number } | undefined;
      if (!current) return { kind: "NOT_FOUND" as const };
      if (current.version !== input.expectedVersion) {
        return { kind: "VERSION_CONFLICT" as const, currentVersion: current.version };
      }

      if (input.code !== undefined) {
        const duplicate = this.database.native.prepare(
          `SELECT id FROM catalog_product
           WHERE tenant_id=? AND company_id=? AND code=? AND id<>?`,
        ).get(input.scope.tenantId, input.scope.companyId, input.code, input.productId) as { id: string } | undefined;
        if (duplicate) return { kind: "CODE_ALREADY_REGISTERED" as const, productId: duplicate.id };
      }

      const nextVersion = current.version + 1;
      const updated = this.database.native.prepare(
        `UPDATE catalog_product
         SET name=COALESCE(?, name),
             code=COALESCE(?, code),
             description=CASE WHEN ? THEN ? ELSE description END,
             brand=CASE WHEN ? THEN ? ELSE brand END,
             category=CASE WHEN ? THEN ? ELSE category END,
             status=COALESCE(?, status),
             version=?,
             updated_at=?
         WHERE tenant_id=? AND company_id=? AND id=? AND version=?`,
      ).run(
        input.name ?? null,
        input.code ?? null,
        input.description !== undefined ? 1 : 0,
        input.description === undefined ? null : input.description,
        input.brand !== undefined ? 1 : 0,
        input.brand === undefined ? null : input.brand,
        input.category !== undefined ? 1 : 0,
        input.category === undefined ? null : input.category,
        input.status ?? null,
        nextVersion,
        nowIso,
        input.scope.tenantId, input.scope.companyId, input.productId, input.expectedVersion,
      );
      if (updated.changes !== 1) {
        return { kind: "VERSION_CONFLICT" as const, currentVersion: current.version };
      }

      let presentationVersion: number | null = null;
      if (input.presentationId !== undefined) {
        const presentation = this.database.native.prepare(
          `SELECT version FROM catalog_presentation
           WHERE tenant_id=? AND id=? AND product_id=? AND status='ACTIVE'`,
        ).get(input.scope.tenantId, input.presentationId, input.productId) as { version: number } | undefined;
        if (!presentation) return { kind: "NOT_FOUND" as const };
        if (presentation.version !== input.presentationExpectedVersion) {
          return {
            kind: "PRESENTATION_VERSION_CONFLICT" as const,
            currentVersion: presentation.version,
          };
        }
        if (input.barcode !== undefined && input.barcode !== null) {
          const duplicateBarcode = this.database.native.prepare(
            `SELECT id FROM catalog_presentation
             WHERE tenant_id=? AND barcode=? AND id<>?`,
          ).get(input.scope.tenantId, input.barcode, input.presentationId) as { id: string } | undefined;
          if (duplicateBarcode) {
            return {
              kind: "BARCODE_ALREADY_REGISTERED" as const,
              presentationId: duplicateBarcode.id,
            };
          }
        }
        presentationVersion = presentation.version + 1;
        this.database.native.prepare(
          `UPDATE catalog_presentation
           SET name=COALESCE(?, name),
               barcode=CASE WHEN ? THEN ? ELSE barcode END,
               version=?,
               updated_at=?
           WHERE tenant_id=? AND id=? AND version=?`,
        ).run(
          input.presentationName ?? null,
          input.barcode !== undefined ? 1 : 0,
          input.barcode === undefined ? null : input.barcode,
          presentationVersion,
          nowIso,
          input.scope.tenantId, input.presentationId, presentation.version,
        );
      }

      this.database.native.prepare(
        `INSERT INTO runtime_operations(
          operation_id, idempotency_key, payload_checksum, status, result_code, created_at, updated_at)
         VALUES (?,?,?,'SUCCEEDED','PRODUCT_UPDATED',?,?)`,
      ).run(input.operationId, input.idempotencyKey, input.requestChecksum, nowIso, nowIso);
      this.database.native.prepare(
        `INSERT INTO local_operation_audit(
          tenant_id, company_id, branch_id, device_id,
          actor_type, actor_id, session_id,
          action_code, resource_type, resource_id,
          correlation_id, causation_id, reason_code, details_json, created_at
        ) VALUES (?,?,?,?,'USER',?,?,'CATALOG_PRODUCT_UPDATE','CATALOG_PRODUCT',?,?,?,?,?,?)`,
      ).run(
        input.scope.tenantId, input.scope.companyId, input.scope.branchId, input.scope.deviceId,
        input.operatorUserId, input.sessionId, input.productId, input.correlationId, input.causationId,
        input.reason,
        canonicalJson({
          expected_version: input.expectedVersion,
          version: nextVersion,
          name: input.name ?? null,
          code: input.code ?? null,
          description: input.description === undefined ? null : input.description,
          brand: input.brand === undefined ? null : input.brand,
          category: input.category === undefined ? null : input.category,
          status: input.status ?? null,
          presentation_id: input.presentationId ?? null,
        }),
        nowIso,
      );

      return {
        kind: "UPDATED" as const,
        productId: input.productId,
        version: nextVersion,
        presentationVersion,
      };
    })();
  }

  supersedePrice(input: {
    readonly scope: SyncScope;
    readonly sessionId: string;
    readonly operatorUserId: string;
    readonly operationId: string;
    readonly priceId: string;
    readonly presentationId: string;
    readonly amount: string;
    readonly currencyCode: string;
    readonly idempotencyKey: string;
    readonly requestChecksum: string;
    readonly correlationId: string;
    readonly causationId: string | null;
  }):
    | { readonly kind: "PUBLISHED"; readonly priceId: string; readonly presentationId: string }
    | { readonly kind: "IDEMPOTENT"; readonly priceId: string; readonly presentationId: string }
    | { readonly kind: "NOT_FOUND" }
    | { readonly kind: "IDEMPOTENCY_CONFLICT" } {
    return this.database.native.transaction(() => {
      const nowIso = this.now().toISOString();
      const priorOp = this.database.native.prepare(
        "SELECT payload_checksum FROM runtime_operations WHERE idempotency_key=?",
      ).get(input.idempotencyKey) as { payload_checksum: string } | undefined;
      if (priorOp !== undefined) {
        if (priorOp.payload_checksum !== input.requestChecksum) return { kind: "IDEMPOTENCY_CONFLICT" as const };
        const active = this.database.native.prepare(
          `SELECT id FROM catalog_price
           WHERE tenant_id=? AND presentation_id=? AND status='ACTIVE'`,
        ).get(input.scope.tenantId, input.presentationId) as { id: string } | undefined;
        return {
          kind: "IDEMPOTENT" as const,
          priceId: active?.id ?? input.priceId,
          presentationId: input.presentationId,
        };
      }

      const presentation = this.database.native.prepare(
        `SELECT cp.id
         FROM catalog_presentation cp
         JOIN catalog_product p ON p.tenant_id=cp.tenant_id AND p.id=cp.product_id
         WHERE cp.tenant_id=? AND cp.id=? AND p.company_id=? AND cp.status='ACTIVE' AND p.status='ACTIVE'`,
      ).get(input.scope.tenantId, input.presentationId, input.scope.companyId) as { id: string } | undefined;
      if (!presentation) return { kind: "NOT_FOUND" as const };

      this.database.native.prepare(
        `UPDATE catalog_price SET status='INACTIVE', updated_at=?
         WHERE tenant_id=? AND presentation_id=? AND status='ACTIVE'`,
      ).run(nowIso, input.scope.tenantId, input.presentationId);
      this.database.native.prepare(
        `INSERT INTO catalog_price(
          id, tenant_id, presentation_id, amount, currency_code, status, created_at, updated_at
        ) VALUES (?,?,?,?,?,'ACTIVE',?,?)`,
      ).run(
        input.priceId, input.scope.tenantId, input.presentationId,
        input.amount, input.currencyCode, nowIso, nowIso,
      );
      this.database.native.prepare(
        `INSERT INTO runtime_operations(
          operation_id, idempotency_key, payload_checksum, status, result_code, created_at, updated_at)
         VALUES (?,?,?,'SUCCEEDED','PRICE_PUBLISHED',?,?)`,
      ).run(input.operationId, input.idempotencyKey, input.requestChecksum, nowIso, nowIso);
      this.database.native.prepare(
        `INSERT INTO local_operation_audit(
          tenant_id, company_id, branch_id, device_id,
          actor_type, actor_id, session_id,
          action_code, resource_type, resource_id,
          correlation_id, causation_id, reason_code, details_json, created_at
        ) VALUES (?,?,?,?,'USER',?,?,'CATALOG_PRICE_PUBLISH','CATALOG_PRESENTATION',?,?,?,NULL,?,?)`,
      ).run(
        input.scope.tenantId, input.scope.companyId, input.scope.branchId, input.scope.deviceId,
        input.operatorUserId, input.sessionId, input.presentationId, input.correlationId, input.causationId,
        canonicalJson({ price_id: input.priceId, amount: input.amount, currency_code: input.currencyCode }),
        nowIso,
      );
      return {
        kind: "PUBLISHED" as const,
        priceId: input.priceId,
        presentationId: input.presentationId,
      };
    })();
  }

  attachPrimaryMedia(input: {
    readonly scope: SyncScope;
    readonly productId: string;
    readonly expectedVersion: number;
    readonly mediaId: string;
    readonly operatorUserId: string;
  }):
    | { readonly kind: "ATTACHED"; readonly version: number }
    | { readonly kind: "NOT_FOUND" }
    | { readonly kind: "VERSION_CONFLICT"; readonly currentVersion: number } {
    const nowIso = this.now().toISOString();
    const current = this.database.native.prepare(
      `SELECT version FROM catalog_product WHERE tenant_id=? AND company_id=? AND id=?`,
    ).get(input.scope.tenantId, input.scope.companyId, input.productId) as { version: number } | undefined;
    if (!current) return { kind: "NOT_FOUND" };
    if (current.version !== input.expectedVersion) {
      return { kind: "VERSION_CONFLICT", currentVersion: current.version };
    }
    const next = current.version + 1;
    const updated = this.database.native.prepare(
      `UPDATE catalog_product
       SET primary_media_id=?, version=?, updated_at=?
       WHERE tenant_id=? AND company_id=? AND id=? AND version=?`,
    ).run(
      input.mediaId, next, nowIso,
      input.scope.tenantId, input.scope.companyId, input.productId, input.expectedVersion,
    );
    if (updated.changes !== 1) return { kind: "VERSION_CONFLICT", currentVersion: current.version };
    return { kind: "ATTACHED", version: next };
  }

  clearPrimaryMedia(input: {
    readonly scope: SyncScope;
    readonly productId: string;
    readonly expectedVersion: number;
    readonly operatorUserId: string;
    readonly retireMedia: (mediaId: string) => boolean;
  }):
    | { readonly kind: "ATTACHED"; readonly version: number }
    | { readonly kind: "NOT_FOUND" }
    | { readonly kind: "VERSION_CONFLICT"; readonly currentVersion: number } {
    const nowIso = this.now().toISOString();
    const current = this.database.native.prepare(
      `SELECT version, primary_media_id FROM catalog_product
       WHERE tenant_id=? AND company_id=? AND id=?`,
    ).get(input.scope.tenantId, input.scope.companyId, input.productId) as {
      version: number; primary_media_id: string | null;
    } | undefined;
    if (!current) return { kind: "NOT_FOUND" };
    if (current.version !== input.expectedVersion) {
      return { kind: "VERSION_CONFLICT", currentVersion: current.version };
    }
    if (current.primary_media_id) input.retireMedia(current.primary_media_id);
    const next = current.version + 1;
    const updated = this.database.native.prepare(
      `UPDATE catalog_product
       SET primary_media_id=NULL, version=?, updated_at=?
       WHERE tenant_id=? AND company_id=? AND id=? AND version=?`,
    ).run(
      next, nowIso,
      input.scope.tenantId, input.scope.companyId, input.productId, input.expectedVersion,
    );
    if (updated.changes !== 1) return { kind: "VERSION_CONFLICT", currentVersion: current.version };
    return { kind: "ATTACHED", version: next };
  }
}
