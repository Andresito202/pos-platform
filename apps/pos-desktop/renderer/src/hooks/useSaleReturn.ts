import { useCallback, useRef, useState } from "react";
import type {
  PaymentsRefundConfirmResult,
  ReturnPhysicalCondition,
  SalesReceiptGetResult,
  SalesReturnApproveResult,
  SalesReturnCreateResult,
  SalesReturnExecuteResult,
  SalesReturnRequestResult,
} from "@pos-platform/contracts";
import { callCommercial, newIdempotencyKey } from "../pos-service.js";

export interface ReturnLineChoice {
  readonly lineNumber: number;
  readonly physicalCondition: ReturnPhysicalCondition;
}

export interface SaleReturnRequest {
  readonly saleId: string;
  /** Obligatoria para una venta en efectivo; se omite para transferencia. */
  readonly cashRegisterId: string | null;
  readonly reasonCode: string;
  readonly reasonDetail: string | null;
  readonly lines: readonly ReturnLineChoice[];
}

export interface ConfirmRefundRequest {
  readonly refundId: string;
  readonly providerReference: string;
  readonly destinationReference: string;
}

export interface ApproveSaleReturnRequest {
  readonly saleReturnId: string;
}

export interface ExecuteSaleReturnRequest {
  readonly saleReturnId: string;
  /** Obligatoria para una venta en efectivo; se omite para transferencia. */
  readonly cashRegisterId: string | null;
}

export interface SaleReturnState {
  readonly busy: boolean;
  /** El recibo de la venta: de ahí salen las líneas que se pueden elegir. */
  readonly receipt: SalesReceiptGetResult | null;
  /** Desenlace de la carga cuando no hay recibo (`NOT_FOUND`, `NOT_COMPLETED`). */
  readonly loadOutcome: SalesReceiptGetResult["outcome"] | null;
  readonly result: SalesReturnCreateResult | null;
  /** Desenlace de `payments.refund.confirm`, cuando el reembolso quedó `PROCESSING`. */
  readonly confirmResult: PaymentsRefundConfirmResult | null;
  /** Desenlace de `sales.return.request` — flujo segregado, `D-50`. */
  readonly requestResult: SalesReturnRequestResult | null;
  /** Desenlace de `sales.return.approve` — flujo segregado, `D-50`. */
  readonly approveResult: SalesReturnApproveResult | null;
  /** Desenlace de `sales.return.execute` — flujo segregado, `D-50`. */
  readonly executeResult: SalesReturnExecuteResult | null;
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
  confirmRefund(request: ConfirmRefundRequest): Promise<void>;
  requestReturn(request: SaleReturnRequest): Promise<void>;
  approveReturn(request: ApproveSaleReturnRequest): Promise<void>;
  executeReturn(request: ExecuteSaleReturnRequest): Promise<void>;
  reset(): void;
} {
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<SalesReceiptGetResult | null>(null);
  const [loadOutcome, setLoadOutcome] = useState<SaleReturnState["loadOutcome"]>(null);
  const [result, setResult] = useState<SalesReturnCreateResult | null>(null);
  const [confirmResult, setConfirmResult] = useState<PaymentsRefundConfirmResult | null>(null);
  const [requestResult, setRequestResult] = useState<SalesReturnRequestResult | null>(null);
  const [approveResult, setApproveResult] = useState<SalesReturnApproveResult | null>(null);
  const [executeResult, setExecuteResult] = useState<SalesReturnExecuteResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const confirmInFlight = useRef(false);
  const requestInFlight = useRef(false);
  const approveInFlight = useRef(false);
  const executeInFlight = useRef(false);

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

  const confirmRefund = useCallback(async (request: ConfirmRefundRequest): Promise<void> => {
    if (confirmInFlight.current) return;
    confirmInFlight.current = true;
    setBusy(true);
    setError(null);
    setConfirmResult(null);
    try {
      const response = await callCommercial<PaymentsRefundConfirmResult>("payments.refund.confirm", {
        refund_id: request.refundId,
        provider_reference: request.providerReference,
        destination_reference: request.destinationReference,
      }, newIdempotencyKey());
      if (response.result === null) {
        setError(response.result_code);
        return;
      }
      setConfirmResult(response.result);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      confirmInFlight.current = false;
      setBusy(false);
    }
  }, []);

  /**
   * Solicitar una devolución — flujo segregado, `D-50`. Congela líneas e
   * importe; no mueve caja ni inventario todavía — eso ocurre en
   * `executeReturn`, después de `approveReturn`.
   */
  const requestReturn = useCallback(async (request: SaleReturnRequest): Promise<void> => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setBusy(true);
    setError(null);
    setRequestResult(null);
    setApproveResult(null);
    setExecuteResult(null);
    try {
      const response = await callCommercial<SalesReturnRequestResult>("sales.return.request", {
        sale_id: request.saleId,
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
      setRequestResult(response.result);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      requestInFlight.current = false;
      setBusy(false);
    }
  }, []);

  /**
   * Aprobar una devolución solicitada — `D-50`. No exige un actor distinto
   * del solicitante: sólo el permiso de aprobación.
   */
  const approveReturn = useCallback(async (request: ApproveSaleReturnRequest): Promise<void> => {
    if (approveInFlight.current) return;
    approveInFlight.current = true;
    setBusy(true);
    setError(null);
    setApproveResult(null);
    try {
      const response = await callCommercial<SalesReturnApproveResult>("sales.return.approve", {
        sale_return_id: request.saleReturnId,
      }, newIdempotencyKey());
      if (response.result === null) {
        setError(response.result_code);
        return;
      }
      setApproveResult(response.result);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      approveInFlight.current = false;
      setBusy(false);
    }
  }, []);

  /**
   * Ejecutar una devolución aprobada — `D-50`: mueve el efectivo (o marca
   * `PROCESSING` un reembolso de transferencia) y reingresa el inventario.
   */
  const executeReturn = useCallback(async (request: ExecuteSaleReturnRequest): Promise<void> => {
    if (executeInFlight.current) return;
    executeInFlight.current = true;
    setBusy(true);
    setError(null);
    setExecuteResult(null);
    try {
      const response = await callCommercial<SalesReturnExecuteResult>("sales.return.execute", {
        sale_return_id: request.saleReturnId,
        cash_register_id: request.cashRegisterId,
      }, newIdempotencyKey());
      if (response.result === null) {
        setError(response.result_code);
        return;
      }
      setExecuteResult(response.result);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      executeInFlight.current = false;
      setBusy(false);
    }
  }, []);

  const reset = useCallback((): void => {
    setReceipt(null);
    setLoadOutcome(null);
    setResult(null);
    setConfirmResult(null);
    setRequestResult(null);
    setApproveResult(null);
    setExecuteResult(null);
    setError(null);
  }, []);

  return {
    busy, receipt, loadOutcome, result, confirmResult, requestResult, approveResult, executeResult, error,
    load, submit, confirmRefund, requestReturn, approveReturn, executeReturn, reset,
  };
}
