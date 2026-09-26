import { useCallback, useRef, useState } from "react";
import type {
  InventoryLotListResult,
  InventoryLotReceiveResult,
  InventoryLotTraceResult,
} from "@pos-platform/contracts";
import { callCommercial, newIdempotencyKey } from "../pos-service.js";
import { toScale6 } from "../scale6.js";

/**
 * Lotes desde la caja — recibir, ver qué vence y rastrear por dónde salió.
 *
 * `inventory.lot.receive`, `inventory.lot.list` e `inventory.lot.trace`
 * cruzaban el canal y no tenían pantalla: un carnicero no podía declarar la
 * tanda que le llegaba ni, ante un retiro sanitario, saber qué ventas se la
 * llevaron sin abrir la base.
 *
 * **No calcula nada.** El orden FEFO, el estado de vencimiento y lo recibido
 * vienen del servicio: si la pantalla los recalculara, dos pantallas podrían
 * mostrar dos «siguiente lote» distintos.
 */
export interface LotsState {
  readonly busy: boolean;
  readonly received: InventoryLotReceiveResult | null;
  readonly listed: InventoryLotListResult | null;
  readonly trace: InventoryLotTraceResult | null;
  readonly error: string | null;
}

export interface LotReceipt {
  readonly presentationId: string;
  readonly lotCode: string;
  readonly quantity: string;
  /** Vacío es «no consta», no una fecha: viaja como `null`. */
  readonly manufacturedDate: string;
  readonly expiryDate: string;
  readonly reasonCode: string;
  readonly businessDate: string;
}

const orNull = (typed: string): string | null => (typed.trim() === "" ? null : typed.trim());

export function useLots(): LotsState & {
  receive(lot: LotReceipt): Promise<void>;
  list(presentationId: string, businessDate: string): Promise<void>;
  traceLot(presentationId: string, lotCode: string): Promise<void>;
} {
  const [busy, setBusy] = useState(false);
  const [received, setReceived] = useState<InventoryLotReceiveResult | null>(null);
  const [listed, setListed] = useState<InventoryLotListResult | null>(null);
  const [trace, setTrace] = useState<InventoryLotTraceResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Ver `useCommercialSale.ts`: cierra la ventana de doble clic que un
   * `busy` de estado, por sí solo, no cierra. */
  const inFlight = useRef(false);

  const run = useCallback(async (work: () => Promise<void>): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);

  const receive = useCallback((lot: LotReceipt) => run(async () => {
    setReceived(null);
    const quantity = toScale6(lot.quantity);
    if (quantity === null) {
      setError("QUANTITY_NOT_SCALE6");
      return;
    }
    const response = await callCommercial<InventoryLotReceiveResult>(
      "inventory.lot.receive",
      {
        presentation_id: lot.presentationId,
        lot_code: lot.lotCode.trim(),
        quantity,
        manufactured_date: orNull(lot.manufacturedDate),
        expiry_date: orNull(lot.expiryDate),
        reason_code: lot.reasonCode.trim(),
        business_date: lot.businessDate.trim(),
      },
      newIdempotencyKey(),
    );
    if (response.result === null) {
      setError(response.result_code);
      return;
    }
    setReceived(response.result);
  }), [run]);

  const list = useCallback((presentationId: string, businessDate: string) => run(async () => {
    setListed(null);
    const response = await callCommercial<InventoryLotListResult>(
      "inventory.lot.list",
      { presentation_id: presentationId, business_date: businessDate.trim() },
    );
    if (response.result === null) {
      setError(response.result_code);
      return;
    }
    setListed(response.result);
  }), [run]);

  const traceLot = useCallback((presentationId: string, lotCode: string) => run(async () => {
    setTrace(null);
    const response = await callCommercial<InventoryLotTraceResult>(
      "inventory.lot.trace",
      { presentation_id: presentationId, lot_code: lotCode.trim() },
    );
    if (response.result === null) {
      setError(response.result_code);
      return;
    }
    setTrace(response.result);
  }), [run]);

  return { busy, received, listed, trace, error, receive, list, traceLot };
}
