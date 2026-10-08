import { useCallback, useEffect, useState } from "react";
import type {
  CashShiftCloseResult,
  CashShiftOpenResult,
  PaymentGetResult,
  PaymentRegisterTransferResult,
  PaymentTransferConfirmResult,
  CatalogItemResult,
  CatalogItemListItem,
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
  /**
   * La versión con la que el servicio entregó el turno. El cierre la exige como
   * `expected_version`, y no hay lectura de turno por el canal: se conserva la
   * que vino, en vez de suponerla.
   */
  readonly version: number;
}

/**
 * Una transferencia reportada y todavía **sin confirmar**.
 *
 * `version` no se supone: `payment.register.transfer` devuelve sólo
 * `payment_id`, y `payment.transfer.confirm` exige `expected_version`. La
 * versión sale de `payment.get`, que es quien lee el estado persistido. Es el
 * mismo motivo por el que el cierre de turno arrastra la suya: una versión
 * inventada en la interfaz es un conflicto silencioso esperando su turno.
 */
export interface RegisteredTransfer {
  readonly paymentId: string;
  readonly version: number;
  /** Estado real del pago según el servicio, no según la interfaz. */
  readonly status: string;
  readonly expectedAmount: string;
}

export interface CommercialSaleState {
  readonly busy: boolean;
  readonly error: string | null;
  readonly shift: OpenShift | null;
  readonly foundItem: CatalogItemResult | null;
  readonly catalogItems: readonly CatalogItemListItem[];
  readonly catalogHasMore: boolean;
  readonly lines: readonly CartLine[];
  readonly sale: { readonly saleId: string; readonly payableAmount: string } | null;
  readonly payment: PaymentRegisterCashResult | null;
  /** Arqueo del turno cerrado: esperado, contado y diferencia. */
  readonly closedShift: CashShiftCloseResult | null;
  /** Transferencia reportada, a la espera de atestiguación. */
  readonly transfer: RegisteredTransfer | null;
  /** Resultado de confirmar la transferencia. Sólo aquí puede sonar el cha-ching. */
  readonly transferConfirmation: PaymentTransferConfirmResult | null;
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
  listCatalogItems(query?: string, offset?: number): Promise<void>;
  addCatalogItem(item: CatalogItemListItem, quantity: string): void;
  findItem(barcode: string): Promise<void>;
  addFoundItem(quantity: string): void;
  createSale(): Promise<void>;
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
  const [catalogItems, setCatalogItems] = useState<readonly CatalogItemListItem[]>([]);
  const [catalogHasMore, setCatalogHasMore] = useState(false);
  const [lines, setLines] = useState<readonly CartLine[]>([]);
  const [sale, setSale] = useState<{ saleId: string; payableAmount: string } | null>(null);
  const [payment, setPayment] = useState<PaymentRegisterCashResult | null>(null);
  const [closedShift, setClosedShift] = useState<CashShiftCloseResult | null>(null);
  const [transfer, setTransfer] = useState<RegisteredTransfer | null>(null);
  const [transferConfirmation, setTransferConfirmation] =
    useState<PaymentTransferConfirmResult | null>(null);

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

  const listCatalogItems = useCallback(async (query = "", offset = 0): Promise<void> => {
    await run<{ outcome: "FOUND" | "UNAUTHORIZED"; items: CatalogItemListItem[]; has_more: boolean }>(
      () => callCommercial("catalog.item.list", { query, limit: 24, offset }),
      (result) => {
        if (result.outcome !== "FOUND") {
          setError(result.outcome);
          return;
        }
        setCatalogItems((current) => offset === 0 ? result.items : [...current, ...result.items]);
        setCatalogHasMore(result.has_more);
      },
    );
  }, [run]);

  useEffect(() => {
    void listCatalogItems();
  }, [listCatalogItems]);

  const addCatalogItem = useCallback((item: CatalogItemListItem, quantity: string): void => {
    const canonical = toScale6(quantity);
    if (canonical === null) {
      setError("INVALID_QUANTITY");
      return;
    }
    setLines((current) => [...current, {
      productId: item.product_id,
      presentationId: item.presentation_id,
      name: item.name,
      presentationName: item.presentation_name,
      priceAmount: item.price_amount,
      currencyCode: item.currency_code,
      quantity: canonical,
    }]);
  }, []);

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

  const chargeCash = useCallback(async (tenderedAmount?: string): Promise<void> => {
    const current = sale;
    if (current === null) return;
    await run<PaymentRegisterCashResult>(
      () => callCommercial("payment.register.cash", {
        sale_id: current.saleId,
        // El importe de la venta sigue siendo autoridad del servicio; el cajero aporta cuánto efectivo recibió.
        amount: current.payableAmount,
        tendered_amount: tenderedAmount ?? current.payableAmount,
      }, newIdempotencyKey()),
      (result) => {
        setPayment(result);
        if (shouldPlayChime(result)) playConfirmationChime();
      },
    );
  }, [sale, run]);

  /**
   * Cerrar el turno con el efectivo contado.
   *
   * **La diferencia no se calcula aquí.** El servicio devuelve `expected_cash`,
   * `counted_amount` y `difference_amount` ya resueltos: restar en la pantalla
   * sería una segunda verdad sobre el arqueo, y el arqueo es precisamente el
   * número que nadie puede discutir.
   *
   * `expected_version` es la que trajo la apertura. Si otra terminal cerró el
   * turno entretanto, el servicio responde `VERSION_CONFLICT` y el cajero ve el
   * código: es mejor que cerrar sobre un estado que ya no existe.
   */
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
        // El turno deja de estar abierto sólo si el servicio lo cerró de verdad.
        if (result.outcome === "CLOSED") setShift(null);
      },
    );
  }, [shift, run]);

  /**
   * Reportar una transferencia — `UC-PAY-002`.
   *
   * **Reportar no es cobrar.** El contrato separa el reporte de la
   * atestiguación en dos operaciones y dos permisos —`PAYMENTS_TRANSFER_REPORT`
   * y `PAYMENTS_TRANSFER_CONFIRM`—, precisamente para que quien recibe el
   * comprobante no sea necesariamente quien da el dinero por bueno. La interfaz
   * respeta esa separación: aquí no suena nada y la venta no se completa.
   *
   * Tras registrar se consulta `payment.get`, y no por cortesía: es la única
   * fuente de `version`, que la confirmación exigirá. También en `IDEMPOTENT`,
   * donde el pago ya existía y su versión puede ser cualquiera.
   *
   * `provider_code` y `provider_reference` viajan nulos porque el contrato los
   * admite nulos y la pantalla todavía no los pide. Inventar campos que el
   * contrato no define sería fabricar datos de un comprobante.
   */
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

  /**
   * Atestiguar la transferencia — `UC-PAY-003`.
   *
   * Éste es el único punto donde una transferencia puede completar la venta, y
   * por tanto el único donde puede sonar el cha-ching. La condición no se
   * reescribe aquí: la decide `shouldPlayChime`, la misma regla que gobierna el
   * efectivo (`DEC-016` §13), de modo que un `IDEMPOTENT` no vuelve a sonar.
   *
   * `expected_version` es la que trajo `payment.get`. Si el pago cambió
   * entretanto, el servicio responde `VERSION_CONFLICT` y el cajero ve el
   * código: confirmar sobre un estado que ya no existe sería dar por bueno un
   * dinero que quizá ya se canceló.
   */
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
    setCatalogItems([]);
    setCatalogHasMore(false);
    setTransfer(null);
    setTransferConfirmation(null);
    setError(null);
  }, []);

  return {
    busy, error, shift, foundItem, catalogItems, catalogHasMore, lines, sale, payment, closedShift,
    transfer, transferConfirmation,
    openShift, listCatalogItems, addCatalogItem, findItem, addFoundItem, createSale, chargeCash,
    registerTransfer, confirmTransfer, closeShift, reset,
  };
}
