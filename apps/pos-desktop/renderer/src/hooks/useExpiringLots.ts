import { useCallback, useState } from "react";
import type { CatalogItemResult, InventoryLotExpiringResult } from "@pos-platform/contracts";
import { callCommercial } from "../pos-service.js";

/**
 * Lo que vence esta semana en toda la sucursal, con el nombre de cada
 * producto.
 *
 * Dos saltos y dos dueños: `inventory.lot.expiring` (Inventario) da las
 * tandas; `catalog.item.get` (Catálogo) da el nombre de cada presentación.
 * Cada presentación se pide una vez aunque tenga varias tandas.
 *
 * **Un nombre que no llega no borra la tanda.** Se muestra con su
 * identificador y el código que explica por qué no hay nombre: un aviso de
 * vencimiento que perdiera filas por un fallo de catálogo dejaría producto
 * vencido en la vitrina sin avisar.
 */
export interface ExpiringLotsState {
  readonly busy: boolean;
  readonly result: InventoryLotExpiringResult | null;
  /** Por presentación: el nombre, o el código que explica por qué no lo hay. */
  readonly names: Readonly<Record<string, { readonly name: string } | { readonly failure: string }>>;
  readonly error: string | null;
}

export function useExpiringLots(): ExpiringLotsState & { load(businessDate: string): Promise<void> } {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<InventoryLotExpiringResult | null>(null);
  const [names, setNames] = useState<ExpiringLotsState["names"]>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (businessDate: string): Promise<void> => {
    setBusy(true);
    setError(null);
    setResult(null);
    setNames({});
    try {
      const response = await callCommercial<InventoryLotExpiringResult>(
        "inventory.lot.expiring", { business_date: businessDate.trim() },
      );
      if (response.result === null) {
        setError(response.result_code);
        return;
      }
      const found: Record<string, { name: string } | { failure: string }> = {};
      for (const presentationId of new Set(response.result.lots.map((lot) => lot.presentation_id))) {
        try {
          const item = await callCommercial<CatalogItemResult>(
            "catalog.item.get", { presentation_id: presentationId },
          );
          found[presentationId] = item.result !== null && item.result.outcome === "FOUND"
            ? { name: `${item.result.name ?? ""} · ${item.result.presentation_name ?? ""}` }
            : { failure: item.result?.outcome ?? item.result_code };
        } catch (thrown) {
          found[presentationId] = { failure: thrown instanceof Error ? thrown.message : String(thrown) };
        }
      }
      setNames(found);
      setResult(response.result);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      setBusy(false);
    }
  }, []);

  return { busy, result, names, error, load };
}
