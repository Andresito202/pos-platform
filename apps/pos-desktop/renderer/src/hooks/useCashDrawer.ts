import { useCallback, useRef, useState } from "react";
import type { CashDrawerOpenResult, CashDrawerReason } from "@pos-platform/contracts";
import { callCommercial, newIdempotencyKey } from "../pos-service.js";

export type DrawerOutcome = CashDrawerOpenResult["outcome"];

/**
 * El cajón desde la caja — `D-46`, política del 2026-09-26.
 *
 * **No decide nada.** Si la apertura automática procede lo comprueba el
 * servicio contra el cobro; si el usuario puede abrir a mano lo decide su
 * permiso. Esta vista sólo pide y cuenta lo que pasó.
 */
export function useCashDrawer(): {
  readonly busy: boolean;
  readonly outcome: DrawerOutcome | null;
  readonly diagnosticCode: string | null;
  readonly error: string | null;
  openAfterCashPayment(paymentId: string): Promise<void>;
  openManually(reason: CashDrawerReason, text: string | null): Promise<void>;
} {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<DrawerOutcome | null>(null);
  const [diagnosticCode, setDiagnosticCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // `D-43`: una segunda apertura manual pedida antes de que responda la
  // primera no sale.
  const inFlight = useRef(false);

  const send = useCallback(async (payload: unknown, idempotencyKey: string): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await callCommercial<CashDrawerOpenResult>("cash.drawer.open", payload, idempotencyKey);
      if (response.result === null) {
        setError(response.result_code);
        return;
      }
      setOutcome(response.result.outcome);
      setDiagnosticCode(response.result.diagnostic_code);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);

  /**
   * La clave se **deriva del cobro**: si esta llamada se repite —un efecto que
   * React ejecuta dos veces, un repintado— es la misma petición y el servicio
   * no da otro pulso.
   */
  const openAfterCashPayment = useCallback(
    (paymentId: string) => send({ trigger: "AUTO_CASH_PAYMENT", payment_id: paymentId }, `drawer:auto:${paymentId}`),
    [send],
  );

  const openManually = useCallback(
    (reason: CashDrawerReason, text: string | null) =>
      send({ trigger: "MANUAL", reason_code: reason, reason_text: reason === "OTRO" ? text : null }, newIdempotencyKey()),
    [send],
  );

  return { busy, outcome, diagnosticCode, error, openAfterCashPayment, openManually };
}
