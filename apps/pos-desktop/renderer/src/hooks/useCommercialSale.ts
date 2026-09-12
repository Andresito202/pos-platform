import { useCallback, useState } from "react";
import type {
  CashShiftOpenResult,
  CatalogItemResult,
  PaymentRegisterCashResult,
  SaleCreateResult,
} from "@pos-platform/contracts";
import { callCommercial, newIdempotencyKey } from "../pos-service.js";
import { playConfirmationChime, shouldPlayChime } from "../confirmation-sound.js";

/** Una línea del carrito, tal y como la devolvió el catálogo. */
export interface CartLine {
  readonly productId: string;
  readonly presentationId: string;
  readonly name: string;
  readonly presentationName: string;
  readonly priceAmount: string;
  readonly currencyCode: string;
  readonly quantity: string;
}

export interface OpenShift {
  readonly shiftId: string;
  readonly cashRegisterId: string;
}

export interface CommercialSaleState {
  readonly busy: boolean;
  readonly error: string | null;
  readonly shift: OpenShift | null;
  readonly foundItem: CatalogItemResult | null;
  readonly lines: readonly CartLine[];
  readonly sale: { readonly saleId: string; readonly payableAmount: string } | null;
  readonly payment: PaymentRegisterCashResult | null;
}

/**
 * Contexto temporal de la operación. El renderer **no** lo inventa a medias: la
 * fecha de negocio y la zona salen del reloj del equipo, que es lo que el cajero
 * está viviendo. `utc_offset_minutes` se declara con el signo del contrato
 * —positivo al este de UTC—, inverso al de `getTimezoneOffset`.
 */
function operationTime(now: Date): {
  business_date: string;
  timezone_id: string;
  utc_offset_minutes: number;
} {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return {
    business_date: `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    timezone_id: Intl.DateTimeFormat().resolvedOptions().timeZone,
    utc_offset_minutes: -now.getTimezoneOffset(),
  };
}

/**
 * El estado de la primera vertical comercial: turno → producto → venta → cobro.
 *
 * **No calcula dinero.** El total que se cobra es `payable_amount`, emitido por
 * la capa confiable al crear la venta: duplicar aquí el orden de cálculo de
 * `DEC-003` sería mover autoridad al renderer.
 *
 * **No resuelve el turno.** Envía `cash_register_id` y nada más; la resolución
 * `caja → CashShift → cash_shift_id` vive en `CreateSaleUseCase` (`DEC-012`
 * §25.2). El renderer no conoce esa regla y no debe conocerla.
 */
export function useCommercialSale(): CommercialSaleState & {
  openShift(cashRegisterId: string, openingAmount: string): Promise<void>;
  findItem(barcode: string): Promise<void>;
  addFoundItem(quantity: string): void;
  createSale(): Promise<void>;
  chargeCash(): Promise<void>;
  reset(): void;
} {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shift, setShift] = useState<OpenShift | null>(null);
  const [foundItem, setFoundItem] = useState<CatalogItemResult | null>(null);
  const [lines, setLines] = useState<readonly CartLine[]>([]);
  const [sale, setSale] = useState<{ saleId: string; payableAmount: string } | null>(null);
  const [payment, setPayment] = useState<PaymentRegisterCashResult | null>(null);

  /**
   * Un rechazo del servicio no es una excepción: el sobre lo trae como
   * `REJECTED` con su `result_code` estable. Se muestra tal cual — ocultar el
   * código le quita al cajero la única pista accionable que tiene.
   */
  const run = useCallback(async <T,>(
    work: () => Promise<{ status: string; result_code: string; result: T | null }>,
    onSuccess: (result: T) => void,
  ): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const response = await work();
      if (response.status !== "SUCCEEDED" || response.result === null) {
        setError(response.result_code);
        return;
      }
      onSuccess(response.result);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      setBusy(false);
    }
  }, []);

  const openShift = useCallback(async (
    cashRegisterId: string,
    openingAmount: string,
  ): Promise<void> => {
    await run<CashShiftOpenResult>(
      () => callCommercial("cash.shift.open", {
        cash_register_id: cashRegisterId,
        opening_amount: openingAmount,
        ...operationTime(new Date()),
      }, newIdempotencyKey()),
      (result) => {
        if (result.shift_id === null) {
          setError(result.outcome);
          return;
        }
        setShift({ shiftId: result.shift_id, cashRegisterId });
      },
    );
  }, [run]);

  const findItem = useCallback(async (barcode: string): Promise<void> => {
    setFoundItem(null);
    await run<CatalogItemResult>(
      () => callCommercial("catalog.item.find", { barcode }),
      (result) => {
        if (result.outcome !== "FOUND") {
          setError(result.outcome);
          return;
        }
        setFoundItem(result);
      },
    );
  }, [run]);

  const addFoundItem = useCallback((quantity: string): void => {
    setFoundItem((item) => {
      if (
        item === null
        || item.product_id === null
        || item.presentation_id === null
        || item.price_amount === null
        || item.currency_code === null
      ) return item;
      setLines((current) => [...current, {
        productId: item.product_id as string,
        presentationId: item.presentation_id as string,
        name: item.name ?? "",
        presentationName: item.presentation_name ?? "",
        priceAmount: item.price_amount as string,
        currencyCode: item.currency_code as string,
        quantity,
      }]);
      return null;
    });
  }, []);

  const createSale = useCallback(async (): Promise<void> => {
    if (lines.length === 0) return;
    const currency = lines[0]!.currencyCode;
    await run<SaleCreateResult>(
      () => callCommercial("sale.create", {
        // El único selector del turno. `null` si no hay caja abierta: la venta
        // se crea igual, con el par en `NULL`, y el efectivo la rechazará.
        cash_register_id: shift?.cashRegisterId ?? null,
        channel: "POS",
        document_series: "POS1",
        currency_code: currency,
        lines: lines.map((line) => ({
          product_id: line.productId,
          presentation_id: line.presentationId,
          quantity: line.quantity,
        })),
        ...operationTime(new Date()),
      }, newIdempotencyKey()),
      (result) => {
        if (result.sale_id === null || result.payable_amount === null) {
          setError(result.outcome);
          return;
        }
        setSale({ saleId: result.sale_id, payableAmount: result.payable_amount });
      },
    );
  }, [lines, shift, run]);

  const chargeCash = useCallback(async (): Promise<void> => {
    const current = sale;
    if (current === null) return;
    await run<PaymentRegisterCashResult>(
      () => callCommercial("payment.register.cash", {
        sale_id: current.saleId,
        // Se cobra exactamente el importe que emitió la capa confiable.
        amount: current.payableAmount,
        tendered_amount: current.payableAmount,
      }, newIdempotencyKey()),
      (result) => {
        setPayment(result);
        if (shouldPlayChime(result)) playConfirmationChime();
      },
    );
  }, [sale, run]);

  const reset = useCallback((): void => {
    setLines([]);
    setSale(null);
    setPayment(null);
    setFoundItem(null);
    setError(null);
  }, []);

  return {
    busy, error, shift, foundItem, lines, sale, payment,
    openShift, findItem, addFoundItem, createSale, chargeCash, reset,
  };
}
