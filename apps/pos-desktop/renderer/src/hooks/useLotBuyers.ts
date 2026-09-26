import { useCallback, useState } from "react";
import type { CustomerReadResult, SalesReceiptGetResult } from "@pos-platform/contracts";
import { callCommercial } from "../pos-service.js";

/**
 * Compradores de un lote — la lista que un retiro sanitario necesita.
 *
 * Tres saltos y tres dueños, y ninguno lee tablas de otro:
 *
 * 1. el rastro (`inventory.lot.trace`, Inventario) da las ventas;
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
  /** Lo que no se pudo leer, con el código que lo explica. */
  readonly failures: readonly { readonly saleId: string; readonly code: string }[];
}

export function useLotBuyers(): LotBuyersState & {
  collect(saleIds: readonly string[]): Promise<void>;
} {
  const [busy, setBusy] = useState(false);
  const [buyers, setBuyers] = useState<readonly LotBuyer[] | null>(null);
  const [anonymousSales, setAnonymousSales] = useState(0);
  const [failures, setFailures] = useState<readonly { saleId: string; code: string }[]>([]);

  const collect = useCallback(async (saleIds: readonly string[]): Promise<void> => {
    setBusy(true);
    setBuyers(null);
    setAnonymousSales(0);
    setFailures([]);
    const byCustomer = new Map<string, string[]>();
    const lost: { saleId: string; code: string }[] = [];
    let anonymous = 0;
    try {
      // Cada venta se consulta una vez, aunque figure en más de una salida.
      for (const saleId of [...new Set(saleIds)]) {
        try {
          const receipt = await callCommercial<SalesReceiptGetResult>(
            "sales.receipt.get", { sale_id: saleId },
          );
          if (receipt.result === null || receipt.result.outcome !== "FOUND") {
            lost.push({ saleId, code: receipt.result?.outcome ?? receipt.result_code });
            continue;
          }
          const customerId = receipt.result.customer_id;
          if (customerId === null) {
            anonymous += 1;
            continue;
          }
          byCustomer.set(customerId, [...(byCustomer.get(customerId) ?? []), saleId]);
        } catch (thrown) {
          lost.push({ saleId, code: thrown instanceof Error ? thrown.message : String(thrown) });
        }
      }

      const found: LotBuyer[] = [];
      for (const [customerId, sales] of byCustomer) {
        try {
          const customer = await callCommercial<CustomerReadResult>(
            "customer.get", { customer_id: customerId },
          );
          if (customer.result === null || customer.result.outcome !== "FOUND") {
            for (const saleId of sales) {
              lost.push({ saleId, code: customer.result?.outcome ?? customer.result_code });
            }
            continue;
          }
          found.push({ customer: customer.result, saleIds: sales });
        } catch (thrown) {
          const code = thrown instanceof Error ? thrown.message : String(thrown);
          for (const saleId of sales) lost.push({ saleId, code });
        }
      }
      setBuyers(found);
      setAnonymousSales(anonymous);
      setFailures(lost);
    } finally {
      setBusy(false);
    }
  }, []);

  return { busy, buyers, anonymousSales, failures, collect };
}
