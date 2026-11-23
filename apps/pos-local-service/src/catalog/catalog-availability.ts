import { bigIntToScale6 } from "../money.js";
import type { SqliteInventoryStore } from "../inventory/sqlite-inventory-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";

/**
 * Sellable availability for cashier tiles. Physical on-hand and reserved units
 * are reported separately; React must never invent or mutate these figures.
 *
 * LOW / RESTRICTED commercial labels are not emitted here: no branch reorder
 * threshold or pharmacy restriction projection is wired into catalog list yet.
 */
export type CatalogAvailabilityState = "AVAILABLE" | "OUT_OF_STOCK" | "NOT_TRACKED";

export interface CatalogAvailability {
  readonly quantity_available: string | null;
  readonly quantity_on_hand: string | null;
  readonly quantity_reserved: string | null;
  readonly availability_state: CatalogAvailabilityState;
}

export function readCatalogAvailability(
  inventory: SqliteInventoryStore,
  scope: SyncScope,
  presentationId: string,
  stockControlled: boolean,
): CatalogAvailability {
  if (!stockControlled) {
    return {
      quantity_available: null,
      quantity_on_hand: null,
      quantity_reserved: null,
      availability_state: "NOT_TRACKED",
    };
  }

  const inventoryScope = {
    tenantId: scope.tenantId,
    companyId: scope.companyId,
    branchId: scope.branchId,
  };
  const stock = inventory.getStock(inventoryScope, presentationId);
  const available = inventory.availableUnits(inventoryScope, presentationId);
  const reserved = inventory.reservedUnits(inventoryScope, presentationId);

  return {
    quantity_available: bigIntToScale6(available),
    quantity_on_hand: stock?.quantityOnHand ?? "0.000000",
    quantity_reserved: bigIntToScale6(reserved),
    availability_state: available > 0n ? "AVAILABLE" : "OUT_OF_STOCK",
  };
}
