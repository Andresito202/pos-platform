import { useCallback, useEffect, useRef, useState } from "react";
import { InventoryMovementResultSchema, InventoryStockGetResultSchema, UuidSchema } from "@pos-platform/contracts";
import type {
  InventoryMovementResult,
  InventoryStockGetResult,
} from "@pos-platform/contracts";
import { notifyCatalogInventoryChanged, onCatalogInventoryChanged } from "../catalog-invalidate.js";
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
  readonly movement: { presentationId: string; result: InventoryMovementResult } | null;
  readonly stock: { presentationId: string; result: InventoryStockGetResult } | null;
  readonly checkingStock: boolean;
  readonly error: string | null;
}

export function useInventoryAdmin(): InventoryAdminState & {
  retryPending(): Promise<void>;
  receive(presentationId: string, movementType: ReceiveMovement, quantity: string, reasonCode: string, businessDate: string, batch?:{code:string;manufacture_date:string|null;expiry_date:string|null;supplier_reference:string;receipt_document:string}): Promise<void>;
  adjust(presentationId: string, movementType: AdjustMovement, quantity: string, reasonCode: string, businessDate: string, lotId?:string): Promise<void>;
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
  const pendingOperation = useRef<{ messageType: "inventory.stock.receive" | "inventory.stock.adjust"; payload: Record<string, unknown>; key: string; presentationId: string } | null>(null);
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
        response.result_code === parsed.data.outcome && ["PRESENTATION_NOT_FOUND", "INSUFFICIENT_STOCK", "INVALID_QUANTITY", "QUANTITY_PRECISION_EXCEEDED", "STOCK_QUANTITY_OVERFLOW","LOT_TRACKING_REQUIRED","LEGACY_STOCK_RECONCILIATION_REQUIRED","LOT_NOT_FOUND","LOT_NOT_SELLABLE"].includes(parsed.data.outcome);
      if (success || definitiveRejection) {
        if (parsed.success) setMovement({ presentationId: operation.presentationId, result: parsed.data });
        if (success) notifyCatalogInventoryChanged();
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
  const [movement, setMovement] = useState<InventoryAdminState["movement"]>(null);
  const [stock, setStock] = useState<InventoryAdminState["stock"]>(null);
  const [checkingStock, setCheckingStock] = useState(false);
  const stockRevision = useRef(0);
  useEffect(() => onCatalogInventoryChanged(() => {
    stockRevision.current++;
    setStock(null);
  }), []);
  const [error, setError] = useState<string | null>(null);

  const post = useCallback(async (
    messageType: "inventory.stock.receive" | "inventory.stock.adjust",
    presentationId: string,
    movementType: string,
    quantity: string,
    reasonCode: string,
    businessDate: string,
    extras?:Record<string,unknown>,
  ): Promise<void> => {
    if (inFlight.current || pendingOperation.current) return;
    const normalized = toScale6(quantity);
    if (normalized === null) { setError("QUANTITY_NOT_SCALE6"); return; }
    uncertain.current = false;
    pendingOperation.current = { messageType, presentationId, key: newIdempotencyKey(), payload: {
      presentation_id: presentationId, movement_type: movementType, quantity: normalized,
      reason_code: reasonCode, business_date: businessDate,
      ...(extras??{}),
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
    batch?:{code:string;manufacture_date:string|null;expiry_date:string|null;supplier_reference:string;receipt_document:string},
  ) => post("inventory.stock.receive", presentationId, movementType, quantity, reasonCode, businessDate,
    batch?{batch}:undefined), [post]);

  const adjust = useCallback((
    presentationId: string,
    movementType: AdjustMovement,
    quantity: string,
    reasonCode: string,
    businessDate: string,
    lotId?:string,
  ) => post("inventory.stock.adjust", presentationId, movementType, quantity, reasonCode, businessDate,
    lotId?{lot_id:lotId}:undefined), [post]);

  const getStock = useCallback(async (presentationId: string): Promise<void> => {
    if (inFlight.current || pendingOperation.current) return;
    const target = UuidSchema.safeParse(presentationId);
    if (!target.success) {
      setStock(null);
      setError("INVENTORY_PRESENTATION_INVALID");
      return;
    }
    const revision = stockRevision.current;
    inFlight.current = true;
    setBusy(true);
    setCheckingStock(true);
    setError(null);
    setStock(null);
    try {
      const response = await callCommercial<InventoryStockGetResult>(
        "inventory.stock.get", { presentation_id: target.data },
      );
      const parsed = InventoryStockGetResultSchema.safeParse(response.result);
      if (revision !== stockRevision.current) {
        setError("La existencia cambió durante la consulta. Vuelve a consultar.");
        return;
      }
      if (!parsed.success || parsed.data.outcome !== response.result_code) {
        setError(response.result_code === "FOUND" ? "INVENTORY_STOCK_RESPONSE_INVALID" : response.result_code);
        return;
      }
      if (parsed.data.outcome === "FOUND" && (response.status !== "SUCCEEDED" ||
          parsed.data.presentation_id !== target.data || parsed.data.quantity_on_hand === null)) {
        setError("INVENTORY_STOCK_RESPONSE_INVALID");
        return;
      }
      setStock({ presentationId: target.data, result: parsed.data });
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      inFlight.current = false;
      setCheckingStock(false);
      setBusy(false);
    }
  }, []);

  return { busy, pending, movement, stock, checkingStock, error, receive, adjust, getStock, retryPending };
}
