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

  /** Escritura de fixture para tests. */
  insertFixture(
    product: Omit<SandboxProduct, "stock_controlled"> & { stock_controlled: boolean },
    presentation: SandboxPresentation,
    priceRule: SandboxPriceRule,
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
  }
}
