import type { Actor, CompanyScope } from "@pos-platform/domain";

/**
 * UC-CAT-001 precondition: "Permiso catalog.product.create". Same posture
 * as CashAuthorizationPort — no implementation targets production;
 * SEC-003 authentication (UC-AUTH-001) still does not exist, so nothing
 * can construct a genuinely authenticated USER actor to pass in here.
 */
export interface CatalogAuthorizationPort {
  canCreateProduct(actor: Actor, scope: CompanyScope): Promise<boolean>;
}
