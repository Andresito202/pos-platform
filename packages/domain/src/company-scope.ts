/**
 * Catalog is "compartido por empresa" (docs/architecture/tenant-model.md,
 * "Datos compartidos y datos locales") — a Product belongs to a tenant+
 * company, never to a specific branch, unlike CashShift (TenantScope).
 * A separate type, not a reuse of TenantScope with an empty branch: an
 * empty/sentinel branchId would be exactly the fictitious-id pattern
 * docs/architecture/conceptual-data-model.md explicitly forbids.
 */
export class CompanyScope {
  constructor(readonly tenantId: string, readonly companyId: string) {
    if (!tenantId) throw new TypeError("CompanyScope.tenantId must not be empty");
    if (!companyId) throw new TypeError("CompanyScope.companyId must not be empty");
  }

  equals(other: CompanyScope): boolean {
    return this.tenantId === other.tenantId && this.companyId === other.companyId;
  }
}
