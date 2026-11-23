/**
 * Local event used to refresh Caja catalog tiles after inventory or catalog
 * mutations on this workstation. Not a network poll and not a Central push.
 */
export const CATALOG_INVENTORY_CHANGED = "pos:catalog-inventory-changed";

export function notifyCatalogInventoryChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CATALOG_INVENTORY_CHANGED));
}

export function onCatalogInventoryChanged(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = (): void => { listener(); };
  window.addEventListener(CATALOG_INVENTORY_CHANGED, handler);
  return () => { window.removeEventListener(CATALOG_INVENTORY_CHANGED, handler); };
}
