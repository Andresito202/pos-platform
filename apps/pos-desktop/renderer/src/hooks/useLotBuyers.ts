import { useCallback, useState } from "react";
import type {
  CustomerReadResult,
  InventoryLotTraceResult,
  SalesReceiptGetResult,
} from "@pos-platform/contracts";
import { callCommercial } from "../pos-service.js";

/**
 * Compradores de un lote — la lista que un retiro sanitario necesita.
 *
 * Tres saltos y tres dueños, y ninguno lee tablas de otro:
 *
 * 1. el rastro (`inventory.lot.trace`, Inventario) da las ventas **del lote y
 *    de los lotes de unidades que salieron de abrirlo** (`MIGRATION_029`): el
 *    retiro de una paca que no bajara a sus unidades dejaría fuera justo a
 *    quien compró suelto;
 * 2. el recibo (`sales.receipt.get`, Ventas) da el cliente que cada venta nombró;
 * 3. `customer.get` (Clientes) da nombre y contacto, bajo su propio permiso.
 *
 * **No oculta lo que no llega.** Una venta de mostrador no tiene comprador y
 * se cuenta aparte; una venta o un cliente que no se pudo leer —sin permiso,
 * o porque falló el canal— se lista con su código. Un retiro que dejara fuera
 * a un comprador sin decirlo sería peor que no tener lista.
 *
 * Las llamadas van **una detrás de otra**: el servicio es un único escritor
 * local y esto es una consulta ocasional, no un camino caliente.
 */
export interface LotBuyer {
  readonly customer: CustomerReadResult;
  readonly saleIds: readonly string[];
}

export interface LotBuyersState {
  readonly busy: boolean;
  readonly buyers: readonly LotBuyer[] | null;
  /** Ventas cobradas que no nombraron comprador: de mostrador. */
  readonly anonymousSales: number;
  /**
   * Lo que no se pudo leer, con el código que lo explica. `subject` es la
   * venta, o el lote derivado cuyo rastro no llegó.
   */
  readonly failures: readonly { readonly subject: string; readonly code: string }[];
  /** Lotes de unidades recorridos además del lote pedido. */
  readonly derivedLots: number;
  /** Algún rastro recorrido venía cortado: la lista puede no estar completa. */
  readonly truncated: boolean;
}

/** Tope de lotes derivados que se recorren: paca → caja → unidad cabe de sobra. */
const MAX_DERIVED_LOTS = 50;

export function useLotBuyers(): LotBuyersState & {
  collect(root: InventoryLotTraceResult): Promise<void>;
} {
  const [busy, setBusy] = useState(false);
  const [buyers, setBuyers] = useState<readonly LotBuyer[] | null>(null);
  const [anonymousSales, setAnonymousSales] = useState(0);
  const [failures, setFailures] = useState<readonly { subject: string; code: string }[]>([]);
  const [derivedLots, setDerivedLots] = useState(0);
  const [truncated, setTruncated] = useState(false);

  const collect = useCallback(async (root: InventoryLotTraceResult): Promise<void> => {
    setBusy(true);
    setBuyers(null);
    setAnonymousSales(0);
    setFailures([]);
    setDerivedLots(0);
    setTruncated(false);
    const byCustomer = new Map<string, string[]>();
    const lost: { subject: string; code: string }[] = [];
    let anonymous = 0;
    let cut = root.truncated;
    try {
      // 1 · Las ventas del lote y de todo lo que salió de abrirlo.
      const saleIds: string[] = [];
      const addSales = (trace: InventoryLotTraceResult): void => {
        for (const outflow of trace.outflows) {
          if (outflow.sale_id !== null) saleIds.push(outflow.sale_id);
        }
      };
      addSales(root);
      const pending = root.derived_lots.map((lot) => ({ ...lot }));
      const seen = new Set<string>();
      while (pending.length > 0) {
        const next = pending.shift()!;
        const key = `${next.presentation_id}/${next.lot_code}`;
        if (seen.has(key)) continue;
        if (seen.size >= MAX_DERIVED_LOTS) {
          // Más lotes derivados que el tope: se dice, no se corta en silencio.
          cut = true;
          break;
        }
        seen.add(key);
        try {
          const derived = await callCommercial<InventoryLotTraceResult>(
            "inventory.lot.trace",
            { presentation_id: next.presentation_id, lot_code: next.lot_code },
          );
          if (derived.result === null || derived.result.outcome !== "FOUND") {
            lost.push({
              subject: `lote ${next.lot_code}`,
              code: derived.result?.outcome ?? derived.result_code,
            });
            continue;
          }
          cut = cut || derived.result.truncated;
          addSales(derived.result);
          pending.push(...derived.result.derived_lots);
        } catch (thrown) {
          lost.push({
            subject: `lote ${next.lot_code}`,
            code: thrown instanceof Error ? thrown.message : String(thrown),
          });
        }
      }
      setDerivedLots(seen.size);

      // 2 · De cada venta, el cliente que nombró.
      // Cada venta se consulta una vez, aunque figure en más de una salida.
      for (const saleId of [...new Set(saleIds)]) {
        try {
          const receipt = await callCommercial<SalesReceiptGetResult>(
            "sales.receipt.get", { sale_id: saleId },
          );
          if (receipt.result === null || receipt.result.outcome !== "FOUND") {
            lost.push({ subject: saleId, code: receipt.result?.outcome ?? receipt.result_code });
            continue;
          }
          const customerId = receipt.result.customer_id;
          if (customerId === null) {
            anonymous += 1;
            continue;
          }
          byCustomer.set(customerId, [...(byCustomer.get(customerId) ?? []), saleId]);
        } catch (thrown) {
          lost.push({ subject: saleId, code: thrown instanceof Error ? thrown.message : String(thrown) });
        }
      }

      // 3 · De cada cliente, nombre y contacto.
      const found: LotBuyer[] = [];
      for (const [customerId, sales] of byCustomer) {
        try {
          const customer = await callCommercial<CustomerReadResult>(
            "customer.get", { customer_id: customerId },
          );
          if (customer.result === null || customer.result.outcome !== "FOUND") {
            for (const saleId of sales) {
              lost.push({ subject: saleId, code: customer.result?.outcome ?? customer.result_code });
            }
            continue;
          }
          found.push({ customer: customer.result, saleIds: sales });
        } catch (thrown) {
          const code = thrown instanceof Error ? thrown.message : String(thrown);
          for (const saleId of sales) lost.push({ subject: saleId, code });
        }
      }
      setBuyers(found);
      setAnonymousSales(anonymous);
      setFailures(lost);
      setTruncated(cut);
    } finally {
      setBusy(false);
    }
  }, []);

  return { busy, buyers, anonymousSales, failures, derivedLots, truncated, collect };
}
