import { useCallback, useState } from "react";
import type {
  CashShiftCloseResult,
  CashShiftOpenResult,
  PaymentGetResult,
  PaymentRegisterTransferResult,
  PaymentTransferConfirmResult,
  CatalogItemResult,
  PaymentRegisterCashResult,
  SaleCreateResult,
} from "@pos-platform/contracts";
import { callCommercial, newIdempotencyKey } from "../pos-service.js";
import { playConfirmationChime, shouldPlayChime } from "../confirmation-sound.js";
import { toScale6 } from "../scale6.js";

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
  readonly version: number;
}

export interface RegisteredTransfer {
  readonly paymentId: string;
  readonly version: number;
  readonly status: string;
  readonly expectedAmount: string;
}

export interface CommercialSaleState {
  readonly busy: boolean;
  readonly error: string | null;
  readonly shift: OpenShift | null;
  readonly foundItem: CatalogItemResult | null;
  readonly lines: readonly CartLine[];
  readonly sale: { readonly saleId: string; readonly payableAmount: string } | null;
  readonly payment: PaymentRegisterCashResult | null;
  readonly closedShift: CashShiftCloseResult | null;
  readonly transfer: RegisteredTransfer | null;
  readonly transferConfirmation: PaymentTransferConfirmResult | null;
}

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
 * El renderer no calcula dinero ni resuelve el turno; ambas decisiones viven
 * en la capa confiable.
 */
export function useCommercialSale(): CommercialSaleState & {
  openShift(cashRegisterId: string, openingAmount: string): Promise<void>;
  findItem(barcode: string): Promise<void>;
  addFoundItem(quantity: string): void;
  createSale(): Promise<void>;
  /** `tenderedAmount` es el efectivo físico recibido; si se omite se cobra exacto. */
  chargeCash(tenderedAmount?: string): Promise<void>;
  registerTransfer(): Promise<void>;
  confirmTransfer(): Promise<void>;
  closeShift(countedAmount: string): Promise<void>;
  reset(): void;
} {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shift, setShift] = useState<OpenShift | null>(null);
  const [foundItem, setFoundItem] = useState<CatalogItemResult | null>(null);
  const [lines, setLines] = useState<readonly CartLine[]>([]);
  const [sale, setSale] = useState<{ saleId: string; payableAmount: string } | null>(null);
  const [payment, setPayment] = useState<PaymentRegisterCashResult | null>(null);
  const [closedShift, setClosedShift] = useState<CashShiftCloseResult | null>(null);
  const [transfer, setTransfer] = useState<RegisteredTransfer | null>(null);
  const [transferConfirmation, setTransferConfirmation] =
    useState<PaymentTransferConfirmResult | null>(null);

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
    const opening = toScale6(openingAmount);
    if (opening === null) {
      setError("INVALID_OPENING_AMOUNT");
      return;
    }
    await run<CashShiftOpenResult>(
      () => callCommercial("cash.shift.open", {
        cash_register_id: cashRegisterId,
        opening_amount: opening,
        ...operationTime(new Date()),
      }, newIdempotencyKey()),
      (result) => {
        if (result.shift_id === null || result.version === null) {
          setError(result.outcome);
          return;
        }
        setShift({ shiftId: result.shift_id, cashRegisterId, version: result.version });
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
    const canonical = toScale6(quantity);
    if (canonical === null) {
      setError("INVALID_QUANTITY");
      return;
    }
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
        quantity: canonical,
      }]);
      return null;
    });
  }, []);

  const createSale = useCallback(async (): Promise<void> => {
    if (lines.length === 0) return;
    const currency = lines[0]!.currencyCode;
    await run<SaleCreateResult>(
      () => callCommercial("sale.create", {
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

  const chargeCash = useCallback(async (tenderedAmount?: string): Promise<void> => {
    const current = sale;
    if (current === null) return;

    const tendered = tenderedAmount === undefined
      ? current.payableAmount
      : toScale6(tenderedAmount);
    if (tendered === null) {
      setError("INVALID_TENDERED_AMOUNT");
      return;
    }

    await run<PaymentRegisterCashResult>(
      () => callCommercial("payment.register.cash", {
        sale_id: current.saleId,
        amount: current.payableAmount,
        tendered_amount: tendered,
      }, newIdempotencyKey()),
      (result) => {
        setPayment(result);
        if (shouldPlayChime(result)) playConfirmationChime();
      },
    );
  }, [sale, run]);

  const closeShift = useCallback(async (countedAmount: string): Promise<void> => {
    const current = shift;
    if (current === null) return;
    const counted = toScale6(countedAmount);
    if (counted === null) {
      setError("INVALID_COUNTED_AMOUNT");
      return;
    }
    await run<CashShiftCloseResult>(
      () => callCommercial("cash.shift.close", {
        shift_id: current.shiftId,
        counted_amount: counted,
        expected_version: current.version,
      }, newIdempotencyKey()),
      (result) => {
        setClosedShift(result);
        if (result.outcome === "CLOSED") setShift(null);
      },
    );
  }, [shift, run]);

  const registerTransfer = useCallback(async (): Promise<void> => {
    const current = sale;
    if (current === null) return;
    setTransferConfirmation(null);

    let registeredId: string | null = null;
    await run<PaymentRegisterTransferResult>(
      () => callCommercial("payment.register.transfer", {
        sale_id: current.saleId,
        amount: current.payableAmount,
        provider_code: null,
        provider_reference: null,
      }, newIdempotencyKey()),
      (result) => {
        if (result.payment_id === null) {
          setError(result.outcome);
          return;
        }
        registeredId = result.payment_id;
      },
    );
    if (registeredId === null) return;

    await run<PaymentGetResult>(
      () => callCommercial("payment.get", { payment_id: registeredId }),
      (result) => {
        if (
          result.payment_id === null
          || result.version === null
          || result.status === null
          || result.expected_amount === null
        ) {
          setError(result.outcome);
          return;
        }
        setTransfer({
          paymentId: result.payment_id,
          version: result.version,
          status: result.status,
          expectedAmount: result.expected_amount,
        });
      },
    );
  }, [sale, run]);

  const confirmTransfer = useCallback(async (): Promise<void> => {
    const current = transfer;
    if (current === null) return;
    await run<PaymentTransferConfirmResult>(
      () => callCommercial("payment.transfer.confirm", {
        payment_id: current.paymentId,
        expected_version: current.version,
      }, newIdempotencyKey()),
      (result) => {
        setTransferConfirmation(result);
        if (shouldPlayChime(result)) playConfirmationChime();
      },
    );
  }, [transfer, run]);

  const reset = useCallback((): void => {
    setLines([]);
    setSale(null);
    setPayment(null);
    setFoundItem(null);
    setTransfer(null);
    setTransferConfirmation(null);
    setError(null);
  }, []);

  return {
    busy, error, shift, foundItem, lines, sale, payment, closedShift,
    transfer, transferConfirmation,
    openShift, findItem, addFoundItem, createSale, chargeCash,
    registerTransfer, confirmTransfer, closeShift, reset,
  };
}
