import { CatalogItemListResultSchema, WaitingCartResultSchema, type WaitingCart } from "@pos-platform/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CashShiftCloseResult,
  CashShiftOpenResult,
  PaymentGetResult,
  PaymentRegisterTransferResult,
  PaymentTransferConfirmResult,
  PaymentFactusPayCollectResult,
  PaymentFactusPayVerifyResult,
  PaymentFactusPayResumeResult,
  CatalogItemResult,
  CatalogItemListItem,
  PaymentCancelResult,
  PaymentRegisterCashResult,
  SaleCreateResult,
  SalesReceiptGetResult,
} from "@pos-platform/contracts";
import { buildEnvelope, callCommercial, callCommercialEnvelope, newIdempotencyKey, type CommercialEnvelope } from "../pos-service.js";
import { playConfirmationChime, shouldPlayChime } from "../confirmation-sound.js";
import { toScale6 } from "../scale6.js";
import { parseCopMicros } from "../money-display.js";

/** Una línea del carrito, tal y como la devolvió el catálogo. */
export interface CartLine {
  readonly productId: string;
  readonly presentationId: string;
  readonly name: string;
  readonly presentationName: string;
  readonly priceAmount: string;
  readonly currencyCode: string;
  readonly quantity: string;
  readonly identifier: string;
}

function mergeCartLine(
  current: readonly CartLine[],
  incoming: CartLine,
): CartLine[] {
  const index = current.findIndex(line =>
    line.productId === incoming.productId &&
    line.presentationId === incoming.presentationId &&
    line.priceAmount === incoming.priceAmount &&
    line.currencyCode === incoming.currencyCode
  );

  if (index === -1) return [...current, incoming];

  const previous = current[index]!;
  const first = parseCopMicros(previous.quantity);
  const second = parseCopMicros(incoming.quantity);

  if (first === null || second === null) {
    return [...current, incoming];
  }

  const sum = first + second;
  const quantity = `${sum / 1000000n}.${(sum % 1000000n).toString().padStart(6, "0")}`;

  return current.map((line, position) =>
    position === index ? { ...line, quantity } : line
  );
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

export interface RegisteredFactusPay {
  readonly paymentId: string;
  readonly version: number;
  readonly status: string;
  readonly expectedAmount: string;
  readonly referenceCode: string;
  readonly qr: string | null;
  readonly providerStatus: string | null;
}

export interface CommercialSaleState {
  readonly busy: boolean;
  readonly error: string | null;
  readonly shift: OpenShift | null;
  readonly foundItem: CatalogItemResult | null;
  readonly lines: readonly CartLine[];
  readonly sale: { readonly saleId: string; readonly payableAmount: string } | null;
  readonly payment: PaymentRegisterCashResult | null;
  /** Arqueo del turno cerrado: esperado, contado y diferencia. */
  readonly closedShift: CashShiftCloseResult | null;
  /** Transferencia reportada, a la espera de atestiguación. */
  readonly transfer: RegisteredTransfer | null;
  /** Importe del comprobante consultado al actualizar una confirmación externa. */
  readonly transferReceiptAmount: string | null;
  /** Resultado de confirmar la transferencia. Sólo aquí puede sonar el cha-ching. */
  readonly transferConfirmation: PaymentTransferConfirmResult | null;
  readonly factusPay: RegisteredFactusPay | null;
  readonly factusPayConfirmation: PaymentFactusPayVerifyResult | null;
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
export function useCommercialSale({ canReadCatalog = false }: { canReadCatalog?: boolean } = {}): CommercialSaleState & {
  catalogItems: readonly CatalogItemListItem[];
  catalogBusy: boolean;
  catalogHasMore: boolean;
  listCatalogItems(query?: string): Promise<void>;
  loadMoreCatalogItems(): Promise<void>;
  addCatalogItem(item: CatalogItemListItem, quantity: string): void;
  updateLineQuantity(index: number, value: string): void;
  removeLine(index: number): void;
  waitingCarts: readonly WaitingCart[];
  waitingLabel: string;
  setWaitingLabel(label: string): void;
  customerId: string | null;
  selectCustomer(id: string | null): void;
  listWaiting(): Promise<void>;
  holdCart(): Promise<void>;
  resumeCart(cart: WaitingCart): Promise<void>;
  discardWaiting(cart: WaitingCart): Promise<void>;
  loadTransfer(paymentId: string): Promise<void>;
  cancelTransfer(): Promise<void>;
  unresolved: boolean;
  retryPending(): Promise<void>;
  openShift(cashRegisterId: string, openingAmount: string): Promise<void>;
  findItem(barcode: string): Promise<void>;
  addFoundItem(quantity: string): void;
  captureWeight(): Promise<void>;
  createSale(): Promise<void>;
  chargeCash(tenderedAmount?: string, paymentAmount?: string): Promise<void>;
  refreshTransfer(): Promise<void>;
  registerTransfer(): Promise<void>;
  confirmTransfer(): Promise<void>;
  collectFactusPay(): Promise<void>;
  verifyFactusPay(): Promise<void>;
  resumeFactusPay(): Promise<void>;
  closeShift(countedAmount: string): Promise<void>;
  reset(): boolean;
} {
  const [waitingCarts, setWaitingCarts] = useState<WaitingCart[]>([]);
  const [waitingLabel, setWaitingLabel] = useState("");
  const [activeWaiting, setActiveWaiting] = useState<WaitingCart | null>(null);
  const [customerId, selectCustomer] = useState<string | null>(null);
  const [catalogItems, setCatalogItems] = useState<readonly CatalogItemListItem[]>([]);
  const [catalogHasMore, setCatalogHasMore] = useState(false);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const catalogInFlight = useRef(false);
  const catalogQuery = useRef("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const pendingChange = useRef<(() => Promise<void>) | null>(null);
  const [unresolved, setUnresolved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shift, setShift] = useState<OpenShift | null>(null);
  const [foundItem, setFoundItem] = useState<CatalogItemResult | null>(null);
  const [lines, setLines] = useState<readonly CartLine[]>([]);
  const [sale, setSale] = useState<{ saleId: string; payableAmount: string } | null>(null);
  const [payment, setPayment] = useState<PaymentRegisterCashResult | null>(null);
  const [closedShift, setClosedShift] = useState<CashShiftCloseResult | null>(null);
  const [transfer, setTransfer] = useState<RegisteredTransfer | null>(null);
  const [transferReceiptAmount, setTransferReceiptAmount] = useState<string | null>(null);
  const [transferConfirmation, setTransferConfirmation] =
    useState<PaymentTransferConfirmResult | null>(null);
  const [factusPay, setFactusPay] = useState<RegisteredFactusPay | null>(null);
  const [factusPayConfirmation, setFactusPayConfirmation] =
    useState<PaymentFactusPayVerifyResult | null>(null);

  /**
   * Un rechazo del servicio no es una excepción: el sobre lo trae como
   * `REJECTED` con su `result_code` estable. Se muestra tal cual — ocultar el
   * código le quita al cajero la única pista accionable que tiene.
   */
  const run = useCallback(async <T,>(
    work: () => Promise<{ status: string; result_code: string; result: T | null }>,
    onSuccess: (result: T) => void,
  ): Promise<void> => {
    if (busyRef.current || pendingChange.current) return;
    busyRef.current = true;
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
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  // Preserve the original idempotency key when a write loses its response.
  const runChange = useCallback(async <T,>(
    messageType: CommercialEnvelope["message_type"],
    payload: unknown,
    onSuccess: (result: T) => void | false,
  ): Promise<void> => {
    if (busyRef.current || pendingChange.current) return;
    const envelope = buildEnvelope(messageType, payload, newIdempotencyKey());
    let uncertain = false;
    const attempt = async (): Promise<void> => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setError(null);
      try {
        const response = await callCommercialEnvelope<T>(envelope);
        if (response.status !== "SUCCEEDED" || response.result === null) {
          setError(response.result_code);
          if (response.status !== "REJECTED" || response.result === null) uncertain = true;
          if (uncertain) return;
        } else if (onSuccess(response.result) === false) {
          uncertain = true;
          return;
        }
        pendingChange.current = null;
      } catch (thrown) {
        uncertain = true;
        setError(thrown instanceof Error ? thrown.message : String(thrown));
      } finally {
        setUnresolved(pendingChange.current !== null);
        busyRef.current = false;
        setBusy(false);
      }
    };
    pendingChange.current = attempt;
    await attempt();
  }, []);
  const retryPending = useCallback(async () => { await pendingChange.current?.(); }, []);

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
    if (!canReadCatalog || catalogInFlight.current) return;
    catalogInFlight.current = true;
    setCatalogBusy(true);
    try {
      const response = await callCommercial("catalog.item.list", { query, limit: 24, offset });
      const parsed = CatalogItemListResultSchema.safeParse(response.result);
      if (response.status !== "SUCCEEDED" || !parsed.success || parsed.data.outcome !== "FOUND") {
        setError(response.result_code);
        return;
      }
      catalogQuery.current = query;
      const items = parsed.data.items;
      setCatalogItems(current => offset === 0 ? items : [...current, ...items]);
      setCatalogHasMore(parsed.data.has_more);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      catalogInFlight.current = false;
      setCatalogBusy(false);
    }
  }, [canReadCatalog]);

  useEffect(() => { if (canReadCatalog) void listCatalogItems(); }, [canReadCatalog, listCatalogItems]);
  const loadMoreCatalogItems = () => listCatalogItems(catalogQuery.current, catalogItems.length);

  const addCatalogItem = useCallback((item: CatalogItemListItem, quantity: string): void => {
    if (busyRef.current || pendingChange.current || sale) return;
    const canonical = toScale6(quantity);
    if (canonical === null || canonical === "0.000000") { setError("INVALID_QUANTITY"); return; }
    setLines(current => mergeCartLine(current, {
      productId: item.product_id, presentationId: item.presentation_id,
      name: item.name, presentationName: item.presentation_name,
      priceAmount: item.price_amount, currencyCode: item.currency_code,
      quantity: canonical, identifier: item.code,
    }));
  }, [sale]);

  const updateLineQuantity = useCallback(
    (index: number, value: string): void => {
      if (busyRef.current || pendingChange.current || sale) return;

      const canonical = toScale6(value.trim().replace(",", "."));
      const parsed = canonical === null ? null : parseCopMicros(canonical);

      if (canonical === null || parsed === null || parsed <= 0n) {
        setError("Cantidad no válida");
        return;
      }

      setLines(current => current.map((line, position) =>
        position === index ? { ...line, quantity: canonical } : line
      ));
      setError(null);
    }, [sale]
  );

  const removeLine = useCallback((index: number): void => {
    if (busyRef.current || pendingChange.current || sale) return;
    setLines(current => current.filter((_, position) => position !== index));
  }, [sale]);

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
    const item = foundItem;
      if (
        sale !== null || pendingChange.current ||
        item === null
        || item.product_id === null
        || item.presentation_id === null
        || item.price_amount === null
        || item.currency_code === null
      ) return;
      setLines(current => mergeCartLine(current, {
        productId: item.product_id as string,
        presentationId: item.presentation_id as string,
        name: item.name ?? "",
        presentationName: item.presentation_name ?? "",
        priceAmount: item.price_amount as string,
        currencyCode: item.currency_code as string,
        quantity: canonical,
        identifier: item.barcode ?? "",
      }));
    setFoundItem(null);
  }, [foundItem, sale]);

  const captureWeight = useCallback(async (): Promise<void> => {
    const item = foundItem;
    if (busy || sale !== null || !shift || !item?.presentation_id || !item.product_id ||
        (item.unit_code !== "KGM" && item.unit_code !== "GRM")) return;
    await run<{kind:string;data:{quantity:string;presentation_id:string}|null}>(
      () => callCommercial("hardware.command",{action:"capture_weight",cash_register_id:shift.cashRegisterId,presentation_id:item.presentation_id}),
      result => {
        if(result.kind !== "WEIGHT_CAPTURED" || result.data?.presentation_id !== item.presentation_id) {
          setError("SCALE_CAPTURE_INVALID"); return;
        }
        addFoundItem(result.data.quantity);
      },
    );
  }, [busy, sale, shift, foundItem, run, addFoundItem]);

  const createSale = useCallback(async (): Promise<void> => {
    if (sale || lines.length === 0) return;
    const currency = lines[0]!.currencyCode;
    const time = operationTime(new Date());
    await runChange<SaleCreateResult>(
      "sale.create", {
        cash_register_id: shift?.cashRegisterId ?? null,
        ...(customerId ? { customer_id: customerId } : {}),
        ...(activeWaiting ? { waiting_cart: { id: activeWaiting.id, version: activeWaiting.version } } : {}),
        channel: "POS",
        document_series: "POS1",
        currency_code: currency,
        lines: lines.map((line) => ({
          product_id: line.productId,
          presentation_id: line.presentationId,
          quantity: line.quantity,
        })),
        ...time,
      },
      (result) => {
        if (result.sale_id === null || result.payable_amount === null) {
          setError(result.outcome);
          return false;
        }
        setSale({ saleId: result.sale_id, payableAmount: result.payable_amount });
        if (activeWaiting) {
          setWaitingCarts(current => current.filter(cart => cart.id !== activeWaiting.id));
          setActiveWaiting(null);
        }
        // Reservation reduces availableUnits; tiles must re-read inventory.
        void listCatalogItems(catalogQuery.current);
      },
    );
  }, [lines, shift, sale, customerId, activeWaiting, runChange, listCatalogItems]);

  const chargeCash = useCallback(async (tenderedAmount?: string, paymentAmount?: string): Promise<void> => {
    const current = sale;
    if (current === null || busy || payment?.sale_completed || transferConfirmation?.sale_completed || transferReceiptAmount !== null || factusPayConfirmation?.sale_completed) return;
    // The service returns cumulative confirmed coverage. Never sum overlapping snapshots.
    const coverage = [payment?.confirmed_coverage, transferConfirmation?.confirmed_coverage, factusPayConfirmation?.confirmed_coverage]
      .reduce<bigint>((max, value) => {
        const parsed = value == null ? null : parseCopMicros(value);
        return parsed !== null && parsed > max ? parsed : max;
      }, 0n);
    if (coverage > 0n && !paymentAmount?.trim()) { setError("PAYMENT_AMOUNT_REQUIRED"); return; }
    const amount = toScale6(paymentAmount ?? current.payableAmount);
    if (amount === null || amount === "0.000000") { setError("INVALID_PAYMENT_AMOUNT"); return; }
    const tendered = toScale6(tenderedAmount ?? amount);
    if (tendered === null) { setError("INVALID_TENDERED_AMOUNT"); return; }
    await run<PaymentRegisterCashResult>(
      () => callCommercial("payment.register.cash", {
        sale_id: current.saleId,
        amount,
        tendered_amount: tendered,
      }, newIdempotencyKey()),
      (result) => {
        setPayment(result);
        if (shouldPlayChime(result)) playConfirmationChime();
        if (result.sale_completed === true) void listCatalogItems(catalogQuery.current);
      },
    );
  }, [sale, busy, payment, transferConfirmation, transferReceiptAmount, factusPayConfirmation, run, listCatalogItems]);

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

  const refreshTransfer = useCallback(async (): Promise<void> => {
    if (sale === null || transfer === null) return;
    const { saleId } = sale;
    const { paymentId } = transfer;
    let confirmed = false;
    await run<PaymentGetResult>(
      () => callCommercial("payment.get", { payment_id: paymentId }),
      result => {
        if (result.outcome !== "FOUND" || result.sale_id !== saleId || result.payment_id !== paymentId ||
            result.method !== "TRANSFER" || result.status === null || result.version === null ||
            result.expected_amount === null) {
          setError(result.outcome === "FOUND" ? "PAYMENT_TRANSFER_MISMATCH" : result.outcome);
          return;
        }
        setTransfer({ paymentId, status: result.status, version: result.version, expectedAmount: result.expected_amount });
        confirmed = result.status === "CONFIRMED";
      },
    );
    if (!confirmed) return;

    // Una transferencia confirmada puede cubrir solo parte de la venta.
    await run<SalesReceiptGetResult>(
      async () => {
        const response = await callCommercial<SalesReceiptGetResult>("sales.receipt.get", { sale_id: saleId });
        return response.status === "REJECTED" && response.result?.outcome === "NOT_COMPLETED"
          ? { ...response, status: "SUCCEEDED" }
          : response;
      },
      result => {
        if (result.outcome === "FOUND" && result.sale_id === saleId && result.payable_amount !== null) {
          setTransferReceiptAmount(result.payable_amount);
        }
      },
    );
  }, [sale, transfer, run]);

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
  const loadTransfer = useCallback(async (paymentId: string): Promise<void> => {
    if (busyRef.current || pendingChange.current) return;
    setTransfer(null);
    setTransferConfirmation(null);
    await run<PaymentGetResult>(() => callCommercial("payment.get", { payment_id: paymentId }), result => {
      if (result.outcome !== "FOUND" || result.method !== "TRANSFER" || result.payment_id === null ||
          result.version === null || result.status === null || result.expected_amount === null) {
        setError(result.outcome === "FOUND" ? "PAYMENT_NOT_TRANSFER" : result.outcome);
        return;
      }
      setTransfer({ paymentId: result.payment_id, version: result.version, status: result.status, expectedAmount: result.expected_amount });
    });
  }, [run]);

  const cancelTransfer = useCallback(async (): Promise<void> => {
    const current = transfer;
    if (current?.status !== "CREATED") return;
    await runChange<PaymentCancelResult>("payment.cancel", {
      payment_id: current.paymentId, expected_version: current.version,
    }, result => {
      if (result.outcome === "CANCELLED" || result.outcome === "IDEMPOTENT") setTransfer({ ...current, status: "CANCELLED" });
      else setError(result.outcome);
    });
  }, [transfer, runChange]);

  const confirmTransfer = useCallback(async (): Promise<void> => {
    const current = transfer;
    if (current === null) return;
    await runChange<PaymentTransferConfirmResult>(
      "payment.transfer.confirm", {
        payment_id: current.paymentId,
        expected_version: current.version,
      },
      (result) => {
        setTransferConfirmation(result);
        if (result.outcome === "CONFIRMED" || result.outcome === "IDEMPOTENT") setTransfer({ ...current, status: "CONFIRMED" });
        if (shouldPlayChime(result)) playConfirmationChime();
        if (result.sale_completed === true) void listCatalogItems(catalogQuery.current);
      },
    );
  }, [transfer, runChange, listCatalogItems]);

  /**
   * FACTUS Pay — Generar QR. No cobra la venta; sólo crea cobro pendiente
   * tras respuesta del proveedor. Verificar exige GET al proveedor con estado paid.
   */
  const collectFactusPay = useCallback(async (): Promise<void> => {
    const current = sale;
    if (current === null) return;
    setFactusPayConfirmation(null);
    let registeredId: string | null = null;
    let collectQr: string | null = null;
    let collectReference: string | null = null;
    let collectStatus: string | null = null;
    await run<PaymentFactusPayCollectResult>(
      () => callCommercial("payment.factus_pay.collect", {
        sale_id: current.saleId,
        amount: current.payableAmount,
        expiration_seconds: 900,
      }, newIdempotencyKey()),
      (result) => {
        if (result.payment_id === null) {
          setError(result.outcome);
          return;
        }
        registeredId = result.payment_id;
        collectQr = result.qr;
        collectReference = result.reference_code;
        collectStatus = result.provider_status;
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
        setFactusPay({
          paymentId: result.payment_id,
          version: result.version,
          status: result.status,
          expectedAmount: result.expected_amount,
          referenceCode: collectReference ?? "",
          qr: collectQr,
          providerStatus: collectStatus,
        });
      },
    );
  }, [sale, run]);

  const verifyFactusPay = useCallback(async (): Promise<void> => {
    const current = factusPay;
    if (current === null) return;
    await run<PaymentFactusPayVerifyResult>(
      () => callCommercial("payment.factus_pay.verify", {
        payment_id: current.paymentId,
        expected_version: current.version,
      }, newIdempotencyKey()),
      (result) => {
        setFactusPayConfirmation(result);
        if (shouldPlayChime(result)) playConfirmationChime();
        if (result.sale_completed === true) void listCatalogItems(catalogQuery.current);
      },
    );
  }, [factusPay, run, listCatalogItems]);

  /** After POS restart: recover durable pending FACTUS Pay for the open sale. */
  const resumeFactusPay = useCallback(async (): Promise<void> => {
    const current = sale;
    if (current === null) return;
    setFactusPayConfirmation(null);
    await run<PaymentFactusPayResumeResult>(
      () => callCommercial("payment.factus_pay.resume", { sale_id: current.saleId }),
      (result) => {
        if (
          result.outcome !== "FOUND"
          || result.payment_id === null
          || result.version === null
          || result.status === null
          || result.expected_amount === null
          || result.reference_code === null
        ) {
          setError(result.outcome);
          return;
        }
        setFactusPay({
          paymentId: result.payment_id,
          version: result.version,
          status: result.status,
          expectedAmount: result.expected_amount,
          referenceCode: result.reference_code,
          qr: result.qr,
          providerStatus: result.provider_status,
        });
      },
    );
  }, [sale, run]);

  const listWaiting = useCallback(async ():Promise<void> => {
    await run(() => callCommercial("cart.waiting.list",{}), result => {
      const parsed=WaitingCartResultSchema.safeParse(result);
      if(!parsed.success || parsed.data.outcome!=="FOUND") {setError("WAITING_CART_RESPONSE_INVALID");return;}
      setWaitingCarts(parsed.data.carts);
    });
  },[run]);
  const holdCart = useCallback(async ():Promise<void> => {
    if(busyRef.current || pendingChange.current || sale || !shift || lines.length===0) return;
    const id=activeWaiting?.id ?? globalThis.crypto.randomUUID();
    await runChange("cart.waiting.save",{
      cart_id:id,expected_version:activeWaiting?.version ?? 0,
      cart:{label:waitingLabel,cash_register_id:shift.cashRegisterId,lines,...(customerId ? {customer_id:customerId}:{})},
    },result=>{
      const parsed=WaitingCartResultSchema.safeParse(result);
      if(!parsed.success || parsed.data.outcome!=="SAVED" || parsed.data.carts[0]?.id!==id) {setError("WAITING_CART_RESPONSE_INVALID");return false;}
      setLines([]);setFoundItem(null);setActiveWaiting(null);setWaitingLabel("");selectCustomer(null);
      setWaitingCarts(current=>[...current.filter(c=>c.id!==id),parsed.data.carts[0]!]);
    });
  },[sale,shift,lines,activeWaiting,waitingLabel,customerId,runChange]);
  const resumeCart = useCallback(async (cart:WaitingCart):Promise<void>=>{
    if(busyRef.current || pendingChange.current || sale || lines.length>0) {setError("Guarda el carrito actual en espera antes de recuperar otro.");return;}
    if(shift && shift.cashRegisterId!==cart.payload.cash_register_id) {setError("Abre la misma caja del carrito antes de recuperarlo.");return;}
    await run(()=>callCommercial("cart.waiting.get",{cart_id:cart.id}),result=>{
      const parsed=WaitingCartResultSchema.safeParse(result);
      const found=parsed.success && parsed.data.outcome==="FOUND" ? parsed.data.carts[0]:undefined;
      if(!found || found.id!==cart.id || found.payload.lines.length===0 || (shift && found.payload.cash_register_id!==shift.cashRegisterId)) {setError("WAITING_CART_NOT_FOUND");return;}
      if(!shift) {
        if(!found.active_shift) {setError("Abre la misma caja del carrito antes de recuperarlo.");return;}
        setShift({shiftId:found.active_shift.shift_id,version:found.active_shift.version,cashRegisterId:found.payload.cash_register_id});
      }
      setLines(found.payload.lines.map((line) => ({
        productId: line.productId,
        presentationId: line.presentationId,
        name: line.name,
        presentationName: line.presentationName,
        priceAmount: line.priceAmount,
        currencyCode: line.currencyCode,
        quantity: line.quantity,
        identifier: line.identifier,
      })));
      setActiveWaiting(found);setWaitingLabel(found.payload.label);selectCustomer(found.payload.customer_id ?? null);setError(null);
    });
  },[sale,lines,shift,run]);

  const discardWaiting=useCallback(async (cart:WaitingCart):Promise<void>=>{
    if(busyRef.current || pendingChange.current || activeWaiting?.id===cart.id) return;
    await runChange("cart.waiting.discard",{cart_id:cart.id,expected_version:cart.version},result=>{
      const parsed=WaitingCartResultSchema.safeParse(result);
      if(!parsed.success || parsed.data.outcome!=="DISCARDED") {setError("WAITING_CART_RESPONSE_INVALID");return false;}
      setWaitingCarts(current=>current.filter(item=>item.id!==cart.id));
    });
  },[runChange,activeWaiting]);

  const reset = useCallback((): boolean => {
    if (busyRef.current || pendingChange.current) return false;
    if (sale && !payment?.sale_completed && !transferConfirmation?.sale_completed && transferReceiptAmount === null && !factusPayConfirmation?.sale_completed) {
      setError("Completa la venta antes de iniciar otra.");
      return false;
    }
    setActiveWaiting(null);
    setWaitingLabel("");
    selectCustomer(null);
    setLines([]);
    setSale(null);
    setPayment(null);
    setFoundItem(null);
    setTransfer(null);
    setTransferConfirmation(null);
    setTransferReceiptAmount(null);
    setFactusPay(null);
    setFactusPayConfirmation(null);
    setError(null);
    return true;
  }, [sale, payment, transferConfirmation, transferReceiptAmount, factusPayConfirmation]);

  return {
    busy, error, shift, foundItem, lines, sale, payment, closedShift,
    transfer, transferConfirmation, transferReceiptAmount, factusPay, factusPayConfirmation,
    openShift, findItem, addFoundItem, captureWeight, createSale, chargeCash,
    registerTransfer, refreshTransfer, confirmTransfer, collectFactusPay, verifyFactusPay, resumeFactusPay,
    closeShift, reset, unresolved, retryPending, loadTransfer, cancelTransfer,
    catalogItems, catalogBusy, catalogHasMore, listCatalogItems, loadMoreCatalogItems, addCatalogItem, removeLine, updateLineQuantity,
    waitingCarts, waitingLabel, setWaitingLabel, listWaiting, holdCart, resumeCart, discardWaiting, customerId, selectCustomer,
  };
}
