import { useCallback, useRef, useState } from "react";
import type { SalesReceiptGetResult, SalesReceiptPrintResult } from "@pos-platform/contracts";
import { callCommercial, newIdempotencyKey } from "../pos-service.js";

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

export type PrintOutcome = SalesReceiptPrintResult["outcome"];

export interface ReceiptState {
  readonly busy: boolean;
  /** Desenlace de la última impresión pedida, con la copia que salió. */
  readonly print: Pick<SalesReceiptPrintResult, "outcome" | "copy" | "diagnostic_code"> | null;
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
  printReceipt(saleId: string): Promise<void>;
  clear(): void;
} {
  const [busy, setBusy] = useState(false);
  const [print, setPrint] = useState<ReceiptState["print"]>(null);
  // `D-43`: la segunda pulsación mientras la primera imprime se ignora aquí,
  // antes de que React repinte el botón deshabilitado.
  const inFlight = useRef(false);
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

  /**
   * Una clave nueva por pulsación: pedir otra vez **después** de un desenlace
   * es una petición nueva. El servicio decide si es el mismo trabajo (tras
   * «sin papel») o una copia marcada.
   */
  const printReceipt = useCallback(async (saleId: string): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setPrint(null);
    try {
      const response = await callCommercial<SalesReceiptPrintResult>(
        "sales.receipt.print", { sale_id: saleId }, newIdempotencyKey(),
      );
      if (response.result === null) {
        setError(response.result_code);
        return;
      }
      setPrint({ outcome: response.result.outcome, copy: response.result.copy, diagnostic_code: response.result.diagnostic_code });
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);

  const clear = useCallback((): void => {
    setPrint(null);
    setOutcome(null);
    setReceipt(null);
    setError(null);
  }, []);

  return { busy, print, outcome, receipt, error, load, printReceipt, clear };
}
