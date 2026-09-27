import { useCallback, useRef, useState } from "react";
import type {
  ReturnPhysicalCondition,
  SalesReceiptGetResult,
  SalesReturnCreateResult,
} from "@pos-platform/contracts";
import { callCommercial, newIdempotencyKey } from "../pos-service.js";

export interface ReturnLineChoice {
  readonly lineNumber: number;
  readonly physicalCondition: ReturnPhysicalCondition;
}

export interface SaleReturnRequest {
  readonly saleId: string;
  readonly cashRegisterId: string;
  readonly reasonCode: string;
  readonly reasonDetail: string | null;
  readonly lines: readonly ReturnLineChoice[];
}

export interface SaleReturnState {
  readonly busy: boolean;
  /** El recibo de la venta: de ahí salen las líneas que se pueden elegir. */
  readonly receipt: SalesReceiptGetResult | null;
  /** Desenlace de la carga cuando no hay recibo (`NOT_FOUND`, `NOT_COMPLETED`). */
  readonly loadOutcome: SalesReceiptGetResult["outcome"] | null;
  readonly result: SalesReturnCreateResult | null;
  /** Fallo de transporte o rechazo sin resultado: no es un desenlace del contrato. */
  readonly error: string | null;
}

/**
 * Devolución de una venta cobrada — `B11`.
 *
 * **No calcula nada**: ni el importe a devolver ni lo que vuelve al
 * inventario. Los dos son la respuesta del servicio, que los saca de la venta
 * congelada; la pantalla sólo elige líneas y su estado físico.
 *
 * Una clave nueva por pulsación, con la guarda de doble clic de `D-43`. Es
 * seguro aunque la respuesta se pierda: reintentar con otra clave una
 * devolución que ya se hizo responde `LINE_ALREADY_RETURNED`, no entrega el
 * efectivo otra vez.
 */
export function useSaleReturn(): SaleReturnState & {
  load(saleId: string): Promise<void>;
  submit(request: SaleReturnRequest): Promise<void>;
  reset(): void;
} {
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<SalesReceiptGetResult | null>(null);
  const [loadOutcome, setLoadOutcome] = useState<SaleReturnState["loadOutcome"]>(null);
  const [result, setResult] = useState<SalesReturnCreateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async (saleId: string): Promise<void> => {
    setBusy(true);
    setError(null);
    setResult(null);
    setReceipt(null);
    setLoadOutcome(null);
    try {
      const response = await callCommercial<SalesReceiptGetResult>("sales.receipt.get", { sale_id: saleId });
      if (response.result === null) {
        setError(response.result_code);
        return;
      }
      setLoadOutcome(response.result.outcome);
      if (response.result.outcome === "FOUND") setReceipt(response.result);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      setBusy(false);
    }
  }, []);

  const submit = useCallback(async (request: SaleReturnRequest): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await callCommercial<SalesReturnCreateResult>("sales.return.create", {
        sale_id: request.saleId,
        cash_register_id: request.cashRegisterId,
        reason_code: request.reasonCode,
        reason_detail: request.reasonDetail,
        lines: request.lines.map((line) => ({
          line_number: line.lineNumber,
          physical_condition: line.physicalCondition,
        })),
      }, newIdempotencyKey());
      if (response.result === null) {
        setError(response.result_code);
        return;
      }
      setResult(response.result);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);

  const reset = useCallback((): void => {
    setReceipt(null);
    setLoadOutcome(null);
    setResult(null);
    setError(null);
  }, []);

  return { busy, receipt, loadOutcome, result, error, load, submit, reset };
}
