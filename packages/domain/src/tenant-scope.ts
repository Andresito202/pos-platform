/**
 * Authorized tenancy context for a domain operation. Never constructed from
 * a client-supplied id directly — the caller (application layer, via a port)
 * is responsible for deriving this from an authorized source, per the
 * platform-wide rule that a client-sent id is not authority on its own.
 */
export class TenantScope {
  constructor(
    readonly tenantId: string,
    readonly companyId: string,
    readonly branchId: string,
  ) {
    for (const [name, value] of [["tenantId", tenantId], ["companyId", companyId], ["branchId", branchId]] as const) {
      if (!value) throw new TypeError(`TenantScope.${name} must not be empty`);
    }
  }

  equals(other: TenantScope): boolean {
    return this.tenantId === other.tenantId
      && this.companyId === other.companyId
      && this.branchId === other.branchId;
  }
}
