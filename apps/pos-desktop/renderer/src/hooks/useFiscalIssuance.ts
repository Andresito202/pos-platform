import { useCallback, useRef, useState } from "react";
import { FiscalDocumentIssueResultSchema, type FiscalDocumentIssueResult } from "@pos-platform/contracts";
import { callCommercial, newIdempotencyKey } from "../pos-service.js";

/**
 * Emisión de documento fiscal electrónico — `DEC-021` F5, mitad pantalla.
 *
 * La mitad canal ya existía: `fiscal.document.issue` cruza el socket y llega al
 * caso de uso real. Lo que faltaba es que alguien la invocara desde el producto,
 * que es lo único que separa `CALLER_REACHABLE` de `END_TO_END`.
 *
 * ## Por qué el desenlace se muestra entero, incluido el rechazo
 *
 * Una emisión fiscal no tiene dos desenlaces —bien y mal— sino siete, y cinco de
 * ellos llegan como respuesta `REJECTED` del canal con un `result` **poblado**:
 * `BLOCKED` con su motivo, `TRANSPORT_FAILED`, `UNCERTAIN`,
 * `REQUIRES_RECONCILIATION` y `NOT_ELIGIBLE`. Colapsarlos a «error» le quitaría
 * al cajero justo lo que necesita: si el bloqueo es el adquiriente genérico
 * (`D-13`), la venta no se puede facturar hoy y hay que decirlo; si es
 * `UNCERTAIN`, **no se debe reintentar** y hay que conciliar. Por eso sólo se
 * trata como `error` lo que no trae `result`: un fallo del propio transporte.
 */

export type FiscalCustomerChoice =
  | { readonly kind: "IDENTIFIED"; readonly customerId: string }
  | { readonly kind: "NOT_IDENTIFIED"; readonly reason: "ANONYMOUS_COUNTER_SALE" | "IDENTIFICATION_PENDING" };

export interface FiscalIssuanceState {
  readonly busy: boolean;
  readonly resultSaleId: string | null;
  isBlocked(saleId: string, documentType: string): boolean;
  readonly issued: FiscalDocumentIssueResult | null;
  readonly error: string | null;
}

export function useFiscalIssuance(): FiscalIssuanceState & {
  issue(saleId: string, documentType: string, customer: FiscalCustomerChoice): Promise<void>;
} {
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const blocked = useRef(new Set<string>());
  const [resultSaleId, setResultSaleId] = useState<string | null>(null);
  const isBlocked = useCallback((saleId: string, documentType: string) => blocked.current.has(JSON.stringify([saleId, documentType])), []);
  const [issued, setIssued] = useState<FiscalDocumentIssueResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const issue = useCallback(async (
    saleId: string,
    documentType: string,
    customer: FiscalCustomerChoice,
  ): Promise<void> => {
    const identity = JSON.stringify([saleId, documentType]);
    if (inFlight.current) return;
    if (blocked.current.has(identity)) {
      setError("Esta venta requiere conciliación antes de otra emisión.");
      return;
    }
    inFlight.current = true;
    setResultSaleId(saleId);
    setBusy(true);
    setError(null);
    setIssued(null);
    try {
      const response = await callCommercial<FiscalDocumentIssueResult>(
        "fiscal.document.issue",
        {
          sale_id: saleId,
          document_type: documentType,
          customer: customer.kind === "IDENTIFIED"
            ? { kind: "IDENTIFIED", customer_id: customer.customerId }
            : { kind: "NOT_IDENTIFIED", reason: customer.reason },
          observation: null,
        },
        newIdempotencyKey(),
      );
      if (response.result === null) {
        blocked.current.add(identity);
        setError(response.result_code);
        return;
      }
      const parsed = FiscalDocumentIssueResultSchema.safeParse(response.result);
      if (!parsed.success || response.result_code !== parsed.data.outcome ||
          response.status !== (["ISSUED", "ALREADY_ISSUED"].includes(parsed.data.outcome) ? "SUCCEEDED" : "REJECTED")) {
        blocked.current.add(identity);
        setError("Respuesta fiscal no verificable. Consulta el documento antes de emitir de nuevo.");
        return;
      }
      if (["UNCERTAIN", "REQUIRES_RECONCILIATION"].includes(parsed.data.outcome)) blocked.current.add(identity);
      setIssued(parsed.data);
    } catch (thrown) {
      blocked.current.add(identity);
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);

  return { busy, resultSaleId, isBlocked, issued, error, issue };
}
