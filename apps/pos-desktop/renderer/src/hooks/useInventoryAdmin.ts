import { useCallback, useEffect, useRef, useState } from "react";
import { InventoryMovementResultSchema } from "@pos-platform/contracts";
import type {
  InventoryMovementResult,
  InventoryStockGetResult,
} from "@pos-platform/contracts";
import { callCommercial, newIdempotencyKey } from "../pos-service.js";
import { toScale6 } from "../scale6.js";

/**
 * Entrada, ajuste y consulta de existencia — lo que faltaba para `B7`.
 *
 * `inventory.stock.receive` y `inventory.stock.adjust` cruzaban el canal desde
 * hace bloques y no tenían pantalla, así que la existencia sólo podía entrar
 * por una prueba. Sin entrada de mercancía, un producto dado de alta nace en
 * cero y la venta lo rechaza por falta de existencia.
 *
 * Recibir y ajustar **no se funden en un solo formulario**, aunque el contrato
 * los tenga casi idénticos. Sus `movement_type` son disjuntos por diseño:
 * recibir suma con motivos de compra o conteo inicial; ajustar corrige, resta y
 * registra merma. Fundirlos invitaría a tapar una merma como si fuese una
 * compra, que es el abuso que `D-21` ya señala.
 */

export type ReceiveMovement = "OPENING_COUNT" | "PURCHASE_RECEIPT" | "TRANSFER_IN";
export type AdjustMovement =
  | "ADJUSTMENT_POSITIVE"
  | "ADJUSTMENT_NEGATIVE"
  | "SHRINKAGE"
  | "TRANSFER_OUT";

export interface InventoryAdminState {
  readonly busy: boolean;
  readonly pending: boolean;
  readonly movement: InventoryMovementResult | null;
  readonly stock: InventoryStockGetResult | null;
  readonly error: string | null;
}

export function useInventoryAdmin(): InventoryAdminState & {
  retryPending(): Promise<void>;
  receive(presentationId: string, movementType: ReceiveMovement, quantity: string, reasonCode: string, businessDate: string): Promise<void>;
  adjust(presentationId: string, movementType: AdjustMovement, quantity: string, reasonCode: string, businessDate: string): Promise<void>;
  getStock(presentationId: string): Promise<void>;
} {
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const uncertain = useRef(false);
  useEffect(() => {
    if (!pending) return;
    const preventLoss = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [pending]);
  const pendingOperation = useRef<{ messageType: "inventory.stock.receive" | "inventory.stock.adjust"; payload: Record<string, string>; key: string } | null>(null);
  const retryPending = useCallback(async (): Promise<void> => {
    const operation = pendingOperation.current;
    if (!operation || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null); setMovement(null);
    try {
      const response = await callCommercial<InventoryMovementResult>(operation.messageType, operation.payload, operation.key);
      const parsed = InventoryMovementResultSchema.safeParse(response.result);
      const success = response.status === "SUCCEEDED" && parsed.success &&
        response.result_code === parsed.data.outcome && ["POSTED", "IDEMPOTENT"].includes(parsed.data.outcome) &&
        parsed.data.stock_sequence !== null && parsed.data.quantity_after !== null;
      const definitiveRejection = !uncertain.current && response.status === "REJECTED" && parsed.success &&
        response.result_code === parsed.data.outcome && ["PRESENTATION_NOT_FOUND", "INSUFFICIENT_STOCK", "INVALID_QUANTITY", "QUANTITY_PRECISION_EXCEEDED", "STOCK_QUANTITY_OVERFLOW"].includes(parsed.data.outcome);
      if (success || definitiveRejection) {
        setMovement(parsed.data!);
      } else {
        uncertain.current = true;
        setError("Resultado no concluyente. Conserva esta pantalla y reintenta el mismo movimiento; no registres otra entrada.");
        return;
      }
      pendingOperation.current = null; setPending(false);
    } catch {
      uncertain.current = true;
      setError("No se recibió confirmación. Reintenta la operación pendiente sin cambiar los datos.");
    } finally { inFlight.current = false; setBusy(false); }
  }, []);
  const [movement, setMovement] = useState<InventoryMovementResult | null>(null);
  const [stock, setStock] = useState<InventoryStockGetResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const post = useCallback(async (
    messageType: "inventory.stock.receive" | "inventory.stock.adjust",
    presentationId: string,
    movementType: string,
    quantity: string,
    reasonCode: string,
    businessDate: string,
  ): Promise<void> => {
    if (inFlight.current || pendingOperation.current) return;
    const normalized = toScale6(quantity);
    if (normalized === null) { setError("QUANTITY_NOT_SCALE6"); return; }
    uncertain.current = false;
    pendingOperation.current = { messageType, key: newIdempotencyKey(), payload: {
      presentation_id: presentationId, movement_type: movementType, quantity: normalized,
      reason_code: reasonCode, business_date: businessDate,
    } };
    setPending(true);
    await retryPending();
  }, [retryPending]);

  const receive = useCallback((
    presentationId: string,
    movementType: ReceiveMovement,
    quantity: string,
    reasonCode: string,
    businessDate: string,
  ) => post("inventory.stock.receive", presentationId, movementType, quantity, reasonCode, businessDate), [post]);

  const adjust = useCallback((
    presentationId: string,
    movementType: AdjustMovement,
    quantity: string,
    reasonCode: string,
    businessDate: string,
  ) => post("inventory.stock.adjust", presentationId, movementType, quantity, reasonCode, businessDate), [post]);

  const getStock = useCallback(async (presentationId: string): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setStock(null);
    try {
      const response = await callCommercial<InventoryStockGetResult>(
        "inventory.stock.get", { presentation_id: presentationId },
      );
      if (response.result === null) {
        setError(response.result_code);
        return;
      }
      // `NOT_FOUND` y cero no se colapsan: el contrato los separa y la pantalla
      // también. «No lo manejamos» no es «hay que reponer».
      setStock(response.result);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);

  return { busy, pending, movement, stock, error, receive, adjust, getStock, retryPending };
}
