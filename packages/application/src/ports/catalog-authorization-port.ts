import type { Actor, CompanyScope } from "@pos-platform/domain";

/**
 * UC-CAT-001 precondition: "Permiso catalog.product.create". Same posture
 * as CashAuthorizationPort — no implementation targets production;
 * SEC-003 authentication (UC-AUTH-001) still does not exist, so nothing
 * can construct a genuinely authenticated USER actor to pass in here.
 *
 * Bloque 27 extends this beyond CreateProduct. `canCreateVariant`/
 * `canCreatePresentation`/`canAssignIdentifier`/`canDefineConversion` cover
 * operations B26 registered as HD-01/HD-02/HD-03 (plus a B27 finding for
 * conversion definition) — permission-matrix.md has no row for any of
 * them. The port exists so `CreateVariantUseCase` etc. can be built and
 * tested now; `RoleBasedCatalogAuthorization`'s real implementation fails
 * closed for all of them until a human decision closes that gap.
 */
export interface CatalogAuthorizationPort {
  canCreateProduct(actor: Actor, scope: CompanyScope): Promise<boolean>;
  canUpdateProduct(actor: Actor, scope: CompanyScope): Promise<boolean>;
  canDeactivateProduct(actor: Actor, scope: CompanyScope): Promise<boolean>;
  canCreateVariant(actor: Actor, scope: CompanyScope): Promise<boolean>;
  canCreatePresentation(actor: Actor, scope: CompanyScope): Promise<boolean>;
  canAssignIdentifier(actor: Actor, scope: CompanyScope): Promise<boolean>;
  canDefineConversion(actor: Actor, scope: CompanyScope): Promise<boolean>;
}
