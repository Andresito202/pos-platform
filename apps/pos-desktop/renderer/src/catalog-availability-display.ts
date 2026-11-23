import type { CatalogAvailabilityState, CatalogItemListItem } from "@pos-platform/contracts";
import { formatQuantityDisplay } from "./money-display.js";

export function presentCatalogAvailability(item: Pick<
  CatalogItemListItem,
  "availability_state" | "quantity_available" | "unit_code"
> & { readonly unit_precision?: number | null }): { readonly label: string; readonly state: CatalogAvailabilityState } {
  if (item.availability_state === "NOT_TRACKED") {
    return { label: "Sin control de existencias", state: "NOT_TRACKED" };
  }
  if (item.availability_state === "OUT_OF_STOCK") {
    return { label: "Agotado", state: "OUT_OF_STOCK" };
  }
  if (item.availability_state === "RESTRICTED") {
    return { label: "Venta restringida", state: "RESTRICTED" };
  }
  const quantity = item.quantity_available === null
    ? "—"
    : formatQuantityDisplay(item.quantity_available, item.unit_precision ?? 0);
  if (item.availability_state === "LOW") {
    return {
      label: `Existencias bajas · ${quantity} ${item.unit_code}`,
      state: "LOW",
    };
  }
  if (item.availability_state === "VERIFICATION_REQUIRED") {
    return {
      label: `Requiere verificación · ${quantity} ${item.unit_code}`,
      state: "VERIFICATION_REQUIRED",
    };
  }
  return {
    label: `Disponible · ${quantity} ${item.unit_code}`,
    state: "AVAILABLE",
  };
}
