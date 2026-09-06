import { CompanyScope, type ProductPresentation } from "@pos-platform/domain";
import type { ProductPresentationRepository } from "../ports/product-presentation-repository.js";

/** Either `TenantScope` or `CompanyScope` carry these two fields — Transfer (`CompanyScope`) and every other Inventory operation (`TenantScope`) can both call this without a cast. */
interface ScopeWithCompany {
  readonly tenantId: string;
  readonly companyId: string;
}

export type PresentationValidationResult =
  | { readonly kind: "VALID"; readonly presentation: ProductPresentation }
  | { readonly kind: "NOT_FOUND" }
  | { readonly kind: "NOT_INVENTORY_ENABLED" }
  | { readonly kind: "STOCK_MODE_NOT_SUPPORTED" };

/**
 * B32: closes the gap B25 first flagged and B31 confirmed still open —
 * `InventoryMovement.presentationId` was never validated against a real
 * `ProductPresentation`. "Catalog owns identity, Inventory owns physical
 * stock" (B31 prompt §8): this reads Catalog's own repository, it never
 * re-derives or duplicates presentation identity.
 *
 * `stockMode = NON_STOCK` (`inventoryEnabled = false`) is unambiguously
 * rejected. `CONVERTED_TO_BASE`/`DERIVED` are ALSO rejected here — not
 * because the physical model forbids them, but because HD-INV-05
 * (`traceability.md` B31) leaves undecided whether Inventory tracks them
 * directly on this `presentationId` or must route through
 * `UnitConversion` to a different "base" presentation. Silently picking
 * either reading would resolve a registered human decision by
 * inference. Only `INDEPENDENT` (direct tracking, unambiguous) is
 * supported until the owner resolves HD-INV-05.
 */
export async function validateInventoryPresentation(
  repository: ProductPresentationRepository,
  scope: ScopeWithCompany,
  presentationId: string,
): Promise<PresentationValidationResult> {
  const companyScope = new CompanyScope(scope.tenantId, scope.companyId);
  const presentation = await repository.findById(companyScope, presentationId);
  if (!presentation || presentation.status !== "ACTIVE") return { kind: "NOT_FOUND" };
  if (!presentation.inventoryEnabled) return { kind: "NOT_INVENTORY_ENABLED" };
  if (presentation.stockMode !== "INDEPENDENT") return { kind: "STOCK_MODE_NOT_SUPPORTED" };
  return { kind: "VALID", presentation };
}
