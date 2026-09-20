import { useCallback, useState } from "react";
import type {
  InventoryConversionApplyResult,
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
  readonly movement: InventoryMovementResult | null;
  readonly stock: InventoryStockGetResult | null;
  readonly error: string | null;
  readonly conversion: InventoryConversionApplyResult | null;
}

export function useInventoryAdmin(): InventoryAdminState & {
  receive(presentationId: string, movementType: ReceiveMovement, quantity: string, reasonCode: string, businessDate: string): Promise<void>;
  adjust(presentationId: string, movementType: AdjustMovement, quantity: string, reasonCode: string, businessDate: string): Promise<void>;
  getStock(presentationId: string): Promise<void>;
  applyConversion(
    sourcePresentationId: string, targetPresentationId: string,
    sourceQuantity: string, reasonCode: string, businessDate: string,
  ): Promise<void>;
} {
  const [busy, setBusy] = useState(false);
  const [movement, setMovement] = useState<InventoryMovementResult | null>(null);
  const [stock, setStock] = useState<InventoryStockGetResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conversion, setConversion] = useState<InventoryConversionApplyResult | null>(null);

  const post = useCallback(async (
    messageType: "inventory.stock.receive" | "inventory.stock.adjust",
    presentationId: string,
    movementType: string,
    quantity: string,
    reasonCode: string,
    businessDate: string,
  ): Promise<void> => {
    setBusy(true);
    setError(null);
    setMovement(null);
    try {
      const normalized = toScale6(quantity);
      if (normalized === null) {
        setError("QUANTITY_NOT_SCALE6");
        return;
      }
      const response = await callCommercial<InventoryMovementResult>(
        messageType,
        {
          presentation_id: presentationId,
          movement_type: movementType,
          quantity: normalized,
          reason_code: reasonCode,
          business_date: businessDate,
        },
        newIdempotencyKey(),
      );
      if (response.result === null) {
        setError(response.result_code);
        return;
      }
      setMovement(response.result);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      setBusy(false);
    }
  }, []);

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
      setBusy(false);
    }
  }, []);

  /**
   * Abre una paca y la convierte en unidades. El factor **no se teclea**: lo
   * pone el catálogo, y por eso este formulario no lo pide.
   */
  const applyConversion = useCallback(async (
    sourcePresentationId: string, targetPresentationId: string,
    sourceQuantity: string, reasonCode: string, businessDate: string,
  ): Promise<void> => {
    setBusy(true);
    setError(null);
    setConversion(null);
    try {
      const quantity = toScale6(sourceQuantity);
      if (quantity === null) {
        setError("QUANTITY_NOT_SCALE6");
        return;
      }
      const response = await callCommercial<InventoryConversionApplyResult>(
        "inventory.conversion.apply",
        {
          source_presentation_id: sourcePresentationId.trim(),
          target_presentation_id: targetPresentationId.trim(),
          source_quantity: quantity,
          reason_code: reasonCode.trim(),
          business_date: businessDate.trim(),
        },
        newIdempotencyKey(),
      );
      if (response.result === null) {
        setError(response.result_code);
        return;
      }
      // También en el rechazo: `detail_quantity` dice cuánta existencia hay o
      // qué cantidad no cabía, que es lo que explica el «no se pudo».
      setConversion(response.result);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      setBusy(false);
    }
  }, []);

  return { busy, movement, stock, error, conversion, receive, adjust, getStock, applyConversion };
}
