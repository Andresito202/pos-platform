import type { LocalDatabase } from "@pos-platform/database-sqlite";

export interface SandboxProduct {
  readonly id: string;
  readonly tenant_id: string;
  readonly company_id: string;
  readonly branch_id: string;
  readonly name: string;
  readonly status: "ACTIVE" | "INACTIVE";
  readonly stock_controlled: boolean;
}

export interface SandboxPresentation {
  readonly id: string;
  readonly tenant_id: string;
  readonly product_id: string;
  readonly name: string;
  readonly unit_id: string;
  readonly unit_code: string;
  readonly unit_precision: number;
  readonly status: "ACTIVE" | "INACTIVE";
}

export interface SandboxPriceRule {
  readonly id: string;
  readonly tenant_id: string;
  readonly presentation_id: string;
  /** TEXT scale-6 amount, e.g. "1000.000000" */
  readonly amount: string;
  readonly currency_code: string;
  readonly status: "ACTIVE" | "INACTIVE";
}

/**
 * Atributos fiscales de una presentación — `MIGRATION_013`.
 *
 * **No es fixture de SANDBOX.** La tabla no cuelga de `sandbox_catalog_*` y
 * sobrevive al catálogo real; vive aquí porque el caso de uso de venta resuelve
 * producto, presentación, precio y atributo fiscal en la misma operación, y
 * partirlo en una clase aparte sólo para una consulta añadiría indirección sin
 * añadir frontera.
 */
export interface CatalogFiscalAttribute {
  readonly presentation_id: string;
  readonly code_reference: string;
  readonly unit_measure_code: string;
  readonly standard_code: string;
  readonly tax_code: string;
  /** Tasa en porcentaje, escala 6. `"19.000000"` es el 19 %. */
  readonly tax_rate: string;
}

export interface SandboxCatalogItem {
  readonly product: SandboxProduct;
  readonly presentation: SandboxPresentation;
  readonly activePrice: SandboxPriceRule;
}

interface ProductRow {
  id: string;
  tenant_id: string;
  company_id: string;
  branch_id: string;
  name: string;
  status: string;
  stock_controlled: number;
}

interface PresentationRow {
  id: string;
  tenant_id: string;
  product_id: string;
  name: string;
  unit_id: string;
  unit_code: string;
  unit_precision: number;
  status: string;
}

interface PriceRuleRow {
  id: string;
  tenant_id: string;
  presentation_id: string;
  amount: string;
  currency_code: string;
  status: string;
}

/**
 * Acceso a los datos de catálogo SANDBOX.
 *
 * No implementa distribución de snapshots CATALOG/PRICING (MATERIALIZATION GATE
 * NO-GO por DEC-013). Solo existe para BLOQUE 4C SANDBOX.
 */
export class SandboxCatalogStore {
  constructor(private readonly database: LocalDatabase) {}

  findActiveProduct(tenantId: string, productId: string): SandboxProduct | null {
    const row = this.database.native.prepare(
      `SELECT id, tenant_id, company_id, branch_id, name, status, stock_controlled
       FROM sandbox_catalog_product
       WHERE tenant_id=? AND id=? AND status='ACTIVE'`,
    ).get(tenantId, productId) as ProductRow | undefined;
    if (!row) return null;
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      company_id: row.company_id,
      branch_id: row.branch_id,
      name: row.name,
      status: row.status as "ACTIVE" | "INACTIVE",
      stock_controlled: row.stock_controlled === 1,
    };
  }

  findActivePresentation(tenantId: string, presentationId: string): SandboxPresentation | null {
    const row = this.database.native.prepare(
      `SELECT id, tenant_id, product_id, name, unit_id, unit_code, unit_precision, status
       FROM sandbox_catalog_presentation
       WHERE tenant_id=? AND id=? AND status='ACTIVE'`,
    ).get(tenantId, presentationId) as PresentationRow | undefined;
    if (!row) return null;
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      product_id: row.product_id,
      name: row.name,
      unit_id: row.unit_id,
      unit_code: row.unit_code,
      unit_precision: row.unit_precision,
      status: row.status as "ACTIVE" | "INACTIVE",
    };
  }

  /** `GetActivePrice` — devuelve el precio ACTIVE para la presentación. */
  getActivePrice(tenantId: string, presentationId: string): SandboxPriceRule | null {
    const row = this.database.native.prepare(
      `SELECT id, tenant_id, presentation_id, amount, currency_code, status
       FROM sandbox_price_rule
       WHERE tenant_id=? AND presentation_id=? AND status='ACTIVE'`,
    ).get(tenantId, presentationId) as PriceRuleRow | undefined;
    if (!row) return null;
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      presentation_id: row.presentation_id,
      amount: row.amount,
      currency_code: row.currency_code,
      status: row.status as "ACTIVE" | "INACTIVE",
    };
  }

  /**
   * Atributos fiscales `ACTIVE` de la presentación, o `null` si no los declara.
   *
   * `null` significa «esta presentación no se puede facturar todavía», nunca
   * «está exenta». Quien lo consume tiene que distinguir las dos cosas.
   */
  getFiscalAttribute(tenantId: string, presentationId: string): CatalogFiscalAttribute | null {
    const row = this.database.native.prepare(
      `SELECT presentation_id, code_reference, unit_measure_code, standard_code, tax_code, tax_rate
       FROM catalog_fiscal_attribute
       WHERE tenant_id=? AND presentation_id=? AND status='ACTIVE'`,
    ).get(tenantId, presentationId) as CatalogFiscalAttribute | undefined;
    return row ?? null;
  }

  /** Escritura de fixture para tests. */
  insertFixture(
    product: Omit<SandboxProduct, "stock_controlled"> & { stock_controlled: boolean },
    presentation: SandboxPresentation,
    priceRule: SandboxPriceRule,
    fiscalAttribute?: CatalogFiscalAttribute,
  ): void {
    this.database.native.prepare(
      `INSERT INTO sandbox_catalog_product(id,tenant_id,company_id,branch_id,name,status,stock_controlled)
       VALUES (?,?,?,?,?,?,?)`,
    ).run(
      product.id,
      product.tenant_id,
      product.company_id,
      product.branch_id,
      product.name,
      product.status,
      product.stock_controlled ? 1 : 0,
    );

    this.database.native.prepare(
      `INSERT INTO sandbox_catalog_presentation(id,tenant_id,product_id,name,unit_id,unit_code,unit_precision,status)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run(
      presentation.id,
      presentation.tenant_id,
      presentation.product_id,
      presentation.name,
      presentation.unit_id,
      presentation.unit_code,
      presentation.unit_precision,
      presentation.status,
    );

    this.database.native.prepare(
      `INSERT INTO sandbox_price_rule(id,tenant_id,presentation_id,amount,currency_code,status)
       VALUES (?,?,?,?,?,?)`,
    ).run(
      priceRule.id,
      priceRule.tenant_id,
      priceRule.presentation_id,
      priceRule.amount,
      priceRule.currency_code,
      priceRule.status,
    );

    if (fiscalAttribute) {
      const at = new Date(0).toISOString();
      this.database.native.prepare(
        `INSERT INTO catalog_fiscal_attribute(
          tenant_id, presentation_id, code_reference, unit_measure_code,
          standard_code, tax_code, tax_rate, status, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,'ACTIVE',?,?)`,
      ).run(
        presentation.tenant_id,
        fiscalAttribute.presentation_id,
        fiscalAttribute.code_reference,
        fiscalAttribute.unit_measure_code,
        fiscalAttribute.standard_code,
        fiscalAttribute.tax_code,
        fiscalAttribute.tax_rate,
        at,
        at,
      );
    }
  }
}
