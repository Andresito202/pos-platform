import { useCallback, useState } from "react";
import type { SalesReceiptGetResult } from "@pos-platform/contracts";
import { callCommercial } from "../pos-service.js";

/**
 * Estado de la consulta del recibo — `DEC-019`.
 *
 * Tres desenlaces, y los tres se distinguen a propósito:
 *
 * - `FOUND` — hay recibo y se muestra;
 * - `NOT_COMPLETED` — la venta existe pero no está cobrada;
 * - `NOT_FOUND` — esa venta no es de esta caja.
 *
 * Colapsar los dos últimos en «error» le haría al cajero buscar en otra caja una
 * venta que tiene delante sin cobrar. El servicio ya los separa; la pantalla los
 * conserva.
 */
export type ReceiptOutcome = SalesReceiptGetResult["outcome"];

export interface ReceiptState {
  readonly busy: boolean;
  /** Código estable del contrato cuando la consulta no devuelve recibo. */
  readonly outcome: ReceiptOutcome | null;
  readonly receipt: SalesReceiptGetResult | null;
  /** Fallo de transporte o excepción: no es un desenlace del contrato. */
  readonly error: string | null;
}

/**
 * **No calcula nada.** Ni suma líneas, ni totaliza cobros, ni redondea: cada
 * cifra que la pantalla enseña viene congelada de la venta. Sumar aquí sería
 * crear una segunda verdad sobre un número que ya tiene la suya, que es
 * exactamente lo que costó unificar la aritmética monetaria.
 */
export function useReceipt(): ReceiptState & {
  load(saleId: string): Promise<void>;
  clear(): void;
} {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ReceiptOutcome | null>(null);
  const [receipt, setReceipt] = useState<SalesReceiptGetResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (saleId: string): Promise<void> => {
    setBusy(true);
    setError(null);
    setOutcome(null);
    setReceipt(null);
    try {
      const response = await callCommercial<SalesReceiptGetResult>(
        "sales.receipt.get", { sale_id: saleId },
      );
      if (response.result === null) {
        // Sin resultado no hay desenlace del contrato que mostrar; el código de
        // rechazo del sobre es la única pista accionable que queda.
        setError(response.result_code);
        return;
      }
      setOutcome(response.result.outcome);
      if (response.result.outcome === "FOUND") setReceipt(response.result);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      setBusy(false);
    }
  }, []);

  const clear = useCallback((): void => {
    setOutcome(null);
    setReceipt(null);
    setError(null);
  }, []);

  return { busy, outcome, receipt, error, load, clear };
}
