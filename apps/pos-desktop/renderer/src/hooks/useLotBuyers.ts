import { useCallback, useState } from "react";
import type {
  CustomerReadResult,
  FiscalDocumentListResult,
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
 * 2. el recibo (`sales.receipt.get`, Ventas) da el cliente que cada venta
 *    nombró, y `fiscal.document.list` (Facturación) a quién se facturó —con
 *    `D-40` puede ser otra persona, y también compró la tanda—;
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
  /** Dónde apareció: como cliente de la venta, como adquiriente de la factura, o en los dos. */
  readonly via: readonly ("SALE" | "INVOICE")[];
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
    const byCustomer = new Map<string, { sales: Set<string>; via: Set<"SALE" | "INVOICE"> }>();
    const add = (customerId: string, saleId: string, via: "SALE" | "INVOICE"): void => {
      const entry = byCustomer.get(customerId) ?? { sales: new Set<string>(), via: new Set<"SALE" | "INVOICE">() };
      entry.sales.add(saleId);
      entry.via.add(via);
      byCustomer.set(customerId, entry);
    };
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

      // 2 · De cada venta, el cliente que nombró y a quién se facturó.
      // Cada venta se consulta una vez, aunque figure en más de una salida.
      for (const saleId of [...new Set(saleIds)]) {
        let named = false;
        // Sólo se sabe que es anónima si todo se pudo leer y nada nombra a nadie.
        let known = true;
        try {
          const receipt = await callCommercial<SalesReceiptGetResult>(
            "sales.receipt.get", { sale_id: saleId },
          );
          if (receipt.result === null || receipt.result.outcome !== "FOUND") {
            lost.push({ subject: saleId, code: receipt.result?.outcome ?? receipt.result_code });
            known = false;
          } else if (receipt.result.customer_id !== null) {
            add(receipt.result.customer_id, saleId, "SALE");
            named = true;
          }
        } catch (thrown) {
          lost.push({ subject: saleId, code: thrown instanceof Error ? thrown.message : String(thrown) });
          known = false;
        }
        try {
          const invoices = await callCommercial<FiscalDocumentListResult>(
            "fiscal.document.list", { sale_id: saleId },
          );
          if (invoices.result === null || invoices.result.outcome !== "LISTED") {
            lost.push({ subject: `facturas de ${saleId}`, code: invoices.result?.outcome ?? invoices.result_code });
            known = false;
          } else {
            for (const document of invoices.result.documents) {
              if (document.acquirer_kind === "IDENTIFIED" && document.acquirer_customer_id !== null) {
                add(document.acquirer_customer_id, saleId, "INVOICE");
                named = true;
              } else if (document.acquirer_kind === "NOT_RECORDED") {
                // Factura anterior al registro del adquiriente: no se sabe a
                // quién se hizo, y un retiro tiene que saberlo.
                lost.push({ subject: `factura de ${saleId}`, code: "ACQUIRER_NOT_RECORDED" });
                known = false;
              }
            }
          }
        } catch (thrown) {
          lost.push({
            subject: `facturas de ${saleId}`,
            code: thrown instanceof Error ? thrown.message : String(thrown),
          });
          known = false;
        }
        // Anónima es la que nadie nombró —ni la venta ni una factura— y de la
        // que se pudo leer todo. Lo que no se pudo leer ya está en `lost`.
        if (!named && known) anonymous += 1;
      }

      // 3 · De cada cliente, nombre y contacto.
      const found: LotBuyer[] = [];
      for (const [customerId, entry] of byCustomer) {
        const sales = [...entry.sales];
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
          // Orden fijo, el de los hechos: primero la venta, después la factura.
          const via = (["SALE", "INVOICE"] as const).filter((source) => entry.via.has(source));
          found.push({ customer: customer.result, saleIds: sales, via });
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
