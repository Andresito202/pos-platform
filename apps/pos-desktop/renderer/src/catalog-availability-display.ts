import type { CatalogAvailabilityState, CatalogItemListItem } from "@pos-platform/contracts";
import { formatScale6Display } from "./money-display.js";

export function presentCatalogAvailability(item: Pick<
  CatalogItemListItem,
  "availability_state" | "quantity_available" | "unit_code"
>): { readonly label: string; readonly state: CatalogAvailabilityState } {
  if (item.availability_state === "NOT_TRACKED") {
    return { label: "Sin control de existencias", state: "NOT_TRACKED" };
  }
  if (item.availability_state === "OUT_OF_STOCK") {
    return { label: "Agotado", state: "OUT_OF_STOCK" };
  }
  const quantity = item.quantity_available === null
    ? "—"
    : formatScale6Display(item.quantity_available);
  return {
    label: `Disponible · ${quantity} ${item.unit_code}`,
    state: "AVAILABLE",
  };
}
