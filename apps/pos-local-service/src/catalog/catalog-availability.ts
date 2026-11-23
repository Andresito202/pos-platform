import { bigIntToScale6, scale6ToBigInt } from "../money.js";
import type { SqliteInventoryStore } from "../inventory/sqlite-inventory-store.js";
import type { PharmacyProfile } from "../pharmacy/sqlite-pharmacy-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";

/**
 * Sellable availability for cashier tiles. Physical on-hand, reserved and
 * dispensable units are reported separately; React must never invent them.
 *
 * For lot-tracked presentations, dispensable quantity comes from AVAILABLE
 * non-expired lots minus ACTIVE reservations (same rules as sale reservation).
 * Pharmacy prescription/controlled profiles never claim unconstrained sale on
 * the tile: they surface VERIFICATION_REQUIRED while backend remains authoritative.
 */
export type CatalogAvailabilityState =
  | "AVAILABLE"
  | "LOW"
  | "OUT_OF_STOCK"
  | "RESTRICTED"
  | "VERIFICATION_REQUIRED"
  | "NOT_TRACKED";

export interface CatalogAvailability {
  readonly quantity_available: string | null;
  readonly quantity_on_hand: string | null;
  readonly quantity_reserved: string | null;
  /** Physical units that are not dispensable (expired / blocked / quarantine). */
  readonly quantity_unsellable: string | null;
  readonly low_stock_threshold: string | null;
  readonly availability_state: CatalogAvailabilityState;
}

export interface CatalogAvailabilityOptions {
  readonly lowStockThreshold?: string | null;
  readonly pharmacyProfile?: PharmacyProfile | null;
  readonly at?: Date;
}

function compareScale6(left: string, right: string): number {
  const a = scale6ToBigInt(left);
  const b = scale6ToBigInt(right);
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function readCatalogAvailability(
  inventory: SqliteInventoryStore,
  scope: SyncScope,
  presentationId: string,
  stockControlled: boolean,
  options: CatalogAvailabilityOptions = {},
): CatalogAvailability {
  if (!stockControlled) {
    return {
      quantity_available: null,
      quantity_on_hand: null,
      quantity_reserved: null,
      quantity_unsellable: null,
      low_stock_threshold: null,
      availability_state: "NOT_TRACKED",
    };
  }

  const inventoryScope = {
    tenantId: scope.tenantId,
    companyId: scope.companyId,
    branchId: scope.branchId,
  };
  const at = options.at ?? new Date();
  const stock = inventory.getStock(inventoryScope, presentationId);
  const onHand = stock ? scale6ToBigInt(stock.quantityOnHand) : 0n;
  const sellable = inventory.sellableUnits(inventoryScope, presentationId, at);
  const reserved = inventory.reservedUnits(inventoryScope, presentationId);
  const available = sellable > reserved ? sellable - reserved : 0n;
  const unsellable = onHand > sellable ? onHand - sellable : 0n;
  const threshold = options.lowStockThreshold ?? null;
  const pharmacy = options.pharmacyProfile ?? null;

  let state: CatalogAvailabilityState;
  if (
    pharmacy !== null
    && (pharmacy.registrationVerificationStatus === "INVALID"
      || pharmacy.registrationVerificationStatus === "EXPIRED")
  ) {
    state = "RESTRICTED";
  } else if (available === 0n) {
    state = "OUT_OF_STOCK";
  } else if (
    pharmacy !== null
    && (pharmacy.requiresPrescription || pharmacy.controlledSpecial
      || pharmacy.dispensationCategory === "PRESCRIPTION"
      || pharmacy.dispensationCategory === "CONTROLLED_SPECIAL")
  ) {
    // Buyer/prescription eligibility is not known on the tile.
    state = "VERIFICATION_REQUIRED";
  } else if (
    threshold !== null
    && compareScale6(bigIntToScale6(available), threshold) <= 0
  ) {
    state = "LOW";
  } else {
    state = "AVAILABLE";
  }

  return {
    quantity_available: bigIntToScale6(available),
    quantity_on_hand: stock?.quantityOnHand ?? "0.000000",
    quantity_reserved: bigIntToScale6(reserved),
    quantity_unsellable: bigIntToScale6(unsellable),
    low_stock_threshold: threshold,
    availability_state: state,
  };
}
