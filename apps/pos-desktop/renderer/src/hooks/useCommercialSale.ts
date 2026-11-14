import { WaitingCartResultSchema, type WaitingCart } from "@pos-platform/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CashShiftCloseResult,
  CashShiftOpenResult,
  PaymentGetResult,
  PaymentRegisterTransferResult,
  PaymentTransferConfirmResult,
  PaymentCancelResult,
  CatalogItemResult,
  CatalogItemListItem,
  PaymentRegisterCashResult,
  SaleCreateResult,
} from "@pos-platform/contracts";
import { buildEnvelope, callCommercial, getPosService, newIdempotencyKey, type CommercialEnvelope, type CommercialResponse } from "../pos-service.js";
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
  readonly identifier: string;
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
  readonly saleId: string | null;
  readonly version: number | null;
  /** Estado real del pago según el servicio, no según la interfaz. */
  readonly status: string | null;
  readonly expectedAmount: string | null;
}

export interface CommercialSaleState {
  readonly busy: boolean;
  readonly error: string | null;
  readonly shift: OpenShift | null;
  readonly foundItem: CatalogItemResult | null;
  readonly catalogItems: readonly CatalogItemListItem[];
  readonly catalogHasMore: boolean;
  /** Carga del catálogo, independiente de las operaciones de caja/venta. */
  readonly catalogBusy: boolean;
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
export function useCommercialSale({ canReadCatalog, canReadPayment }: {
  canReadCatalog: boolean;
  canReadPayment: boolean;
}): CommercialSaleState & {
  waitingCarts: readonly WaitingCart[];
  customerId: string | null;
  selectCustomer(customerId: string | null): void;
  waitingLabel: string;
  setWaitingLabel(value: string): void;
  listWaiting(): Promise<void>;
  holdCart(): Promise<void>;
  resumeCart(cart: WaitingCart): Promise<void>;
  discardWaiting(cart: WaitingCart): Promise<void>;
  openShift(cashRegisterId: string, openingAmount: string): Promise<void>;
  listCatalogItems(query?: string, offset?: number): Promise<void>;
  addCatalogItem(item: CatalogItemListItem, quantity: string): void;
  findItem(barcode: string): Promise<void>;
  addFoundItem(quantity: string): void;
  removeLine(index: number): void;
  createSale(): Promise<void>;
  chargeCash(tenderedAmount?: string, paymentAmount?: string): Promise<void>;
  registerTransfer(paymentAmount?: string, provider?: "NEQUI" | "DAVIPLATA" | null): Promise<void>;
  confirmTransfer(): Promise<void>;
  loadTransfer(paymentId: string): Promise<void>;
  cancelTransfer(): Promise<void>;
  unresolved: boolean;
  retryPending(): Promise<void>;
  closeShift(countedAmount: string): Promise<void>;
  reset(): boolean;
} {
  const [waitingCarts,setWaitingCarts]=useState<WaitingCart[]>([]);
  const [customerId,setCustomerId]=useState<string|null>(null);
  const [waitingLabel,setWaitingLabel]=useState("");
  const [activeWaiting,setActiveWaiting]=useState<WaitingCart|null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const applyMutation = useRef<(result: unknown) => void>(() => undefined);
  const [unresolved, setUnresolved] = useState(false);
  const pendingMutation = useRef<{
    signature: string;
    uncertain: boolean;
    messageType: Parameters<typeof buildEnvelope>[0];
    request: CommercialEnvelope;
    apply: (result: unknown) => void;
  } | null>(null);
  const sendMutation = useCallback(async <T,>(pending: NonNullable<typeof pendingMutation.current>): Promise<CommercialResponse<T>> => {
    try {
      const response = await getPosService()[pending.messageType](pending.request) as CommercialResponse<T>;
      if(pending.messageType === "cart.waiting.save" && response.status === "SUCCEEDED") {
        const parsed=WaitingCartResultSchema.safeParse(response.result);
        const request=pending.request.payload as {cart_id:string;expected_version:number};
        if(!parsed.success || parsed.data.outcome!=="SAVED" || response.result_code!=="SAVED" ||
          parsed.data.carts[0]?.id!==request.cart_id || parsed.data.carts[0].version!==request.expected_version+1) {
          pending.uncertain=true;throw new Error("WAITING_CART_RESPONSE_INVALID");
        }
      }
      // A rejection now says nothing about an earlier transmission whose
      // response was lost. Keep that original identity until recovered.
      const confirmed = response.status === "SUCCEEDED" && response.result !== null;
      const initialRejection = response.status === "REJECTED" && !pending.uncertain;
      if (confirmed || initialRejection) {
        pendingMutation.current = null;
        setUnresolved(false);
      } else {
        pending.uncertain = true;
      }
      return response;
    } catch (error) {
      pending.uncertain = true;
      throw error;
    }
  }, []);
  // A lost response does not authorize a new financial operation. Retain the
  // original envelope until the service returns a definitive outcome.
  const callMutation = useCallback(async <T,>(
    messageType: Parameters<typeof buildEnvelope>[0], payload: unknown,
  ): Promise<CommercialResponse<T>> => {
    const signature = JSON.stringify({ messageType, payload });
    if (pendingMutation.current !== null && pendingMutation.current.signature !== signature) {
      throw new Error("OPERATION_OUTCOME_UNRESOLVED");
    }
    pendingMutation.current ??= { signature, uncertain: false, messageType, request: buildEnvelope(messageType, payload, newIdempotencyKey()), apply: applyMutation.current };
    setUnresolved(true);
    return sendMutation<T>(pendingMutation.current);
  }, [sendMutation]);

  const [error, setError] = useState<string | null>(null);
  const [shift, setShift] = useState<OpenShift | null>(null);
  const [foundItem, setFoundItem] = useState<CatalogItemResult | null>(null);
  const [catalogItems, setCatalogItems] = useState<readonly CatalogItemListItem[]>([]);
  const [catalogHasMore, setCatalogHasMore] = useState(false);
  const [catalogBusy, setCatalogBusy] = useState(false);
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
    trackOperationBusy = true,
  ): Promise<void> => {
    if (trackOperationBusy && busyRef.current) return;
    if (trackOperationBusy) { busyRef.current = true; setBusy(true); }
    applyMutation.current = (result) => onSuccess(result as T);
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
      if (trackOperationBusy) { busyRef.current = false; setBusy(false); }
    }
  }, []);

  useEffect(() => {
    if (!unresolved) return;
    const preventLoss = (event: BeforeUnloadEvent) => {
      if (pendingMutation.current === null) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [unresolved]);

  const retryPending = useCallback(async (): Promise<void> => {
    const pending = pendingMutation.current;
    if (pending === null) return;
    await run(() => sendMutation<unknown>(pending), pending.apply);
  }, [run, sendMutation]);

  const openShift = useCallback(async (
    cashRegisterId: string,
    openingAmount: string,
  ): Promise<void> => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cashRegisterId)) {
      setError("INVALID_CASH_REGISTER"); return;
    }
    const opening = toScale6(openingAmount);
    if (opening === null) {
      setError("INVALID_OPENING_AMOUNT");
      return;
    }
    await run<CashShiftOpenResult>(
      () => callMutation("cash.shift.open", {
        cash_register_id: cashRegisterId,
        opening_amount: opening,
        ...operationTime(new Date()),
      }),
      (result) => {
        if (result.shift_id === null || result.version === null) {
          setError(result.outcome);
          return;
        }
        setShift({ shiftId: result.shift_id, cashRegisterId, version: result.version });
      },
    );
  }, [run, callMutation]);

  const listCatalogItems = useCallback(async (query = "", offset = 0): Promise<void> => {
    setCatalogBusy(true);
    try {
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
        false,
      );
    } finally {
      setCatalogBusy(false);
    }
  }, [run, callMutation]);

  useEffect(() => {
    if (canReadCatalog) void listCatalogItems();
  }, [canReadCatalog, listCatalogItems]);

  const addCatalogItem = useCallback((item: CatalogItemListItem, quantity: string): void => {
    if (busyRef.current || sale !== null || pendingMutation.current !== null) return;
    const canonical = toScale6(quantity);
    if (canonical === null || canonical === "0.000000") {
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
      identifier: item.code,
    }]);
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
  }, [run, callMutation]);

  const addFoundItem = useCallback((quantity: string): void => {
    if (busyRef.current || pendingMutation.current !== null) return;
    const canonical = toScale6(quantity);
    if (canonical === null || canonical === "0.000000") {
      setError("INVALID_QUANTITY");
      return;
    }
    const item = foundItem;
    if (sale !== null || item?.product_id == null || item.presentation_id === null || item.price_amount === null || item.currency_code === null || item.barcode === null) return;
    setLines((current) => [...current, {
      productId: item.product_id!, presentationId: item.presentation_id!, name: item.name ?? "",
      presentationName: item.presentation_name ?? "", priceAmount: item.price_amount!, currencyCode: item.currency_code!, quantity: canonical,
      identifier: item.barcode!,
    }]);
    setFoundItem(null);
  }, [foundItem, sale]);

  const removeLine = useCallback((index: number): void => {
    if (busyRef.current || sale !== null || pendingMutation.current !== null) return;
    setLines((current) => current.filter((_, position) => position !== index));
  }, [sale]);

  const createSale = useCallback(async (): Promise<void> => {
    if (lines.length === 0) return;
    const currency = lines[0]!.currencyCode;
    await run<SaleCreateResult>(
      () => callMutation("sale.create", {
        // The service requires a real OPEN shift before creating the sale.
        cash_register_id: shift?.cashRegisterId ?? null,
        ...(customerId ? {customer_id:customerId}:{}),
        ...(activeWaiting ? {waiting_cart:{id:activeWaiting.id,version:activeWaiting.version}}:{}),
        channel: "POS",
        document_series: "POS1",
        currency_code: currency,
        lines: lines.map((line) => ({
          product_id: line.productId,
          presentation_id: line.presentationId,
          quantity: line.quantity,
          identifier: line.identifier,
        })),
        ...operationTime(new Date()),
      }),
      (result) => {
        if (result.sale_id === null || result.payable_amount === null) {
          setError(result.outcome);
          return;
        }
        setSale({ saleId: result.sale_id, payableAmount: result.payable_amount });
        if(activeWaiting) setWaitingCarts(current=>current.filter(cart=>cart.id!==activeWaiting.id));
      },
    );
  }, [lines, shift, activeWaiting, customerId, run, callMutation]);

  const chargeCash = useCallback(async (tenderedAmount?: string, paymentAmount?: string): Promise<void> => {
    const current = sale;
    if (current === null) return;
    const amount = toScale6(paymentAmount ?? current.payableAmount);
    if (amount === null || amount === "0.000000") { setError("INVALID_PAYMENT_AMOUNT"); return; }
    const tendered = toScale6(tenderedAmount ?? amount);
    if (tendered === null) {
      setError("INVALID_TENDERED_AMOUNT");
      return;
    }
    await run<PaymentRegisterCashResult>(
      () => callMutation("payment.register.cash", {
        sale_id: current.saleId,
        // El importe de la venta sigue siendo autoridad del servicio; el cajero aporta cuánto efectivo recibió.
        amount,
        tendered_amount: tendered,
      }),
      (result) => {
        setPayment(result);
        if (shouldPlayChime(result)) playConfirmationChime();
      },
    );
  }, [sale, run, callMutation]);

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
      () => callMutation("cash.shift.close", {
        shift_id: current.shiftId,
        counted_amount: counted,
        expected_version: current.version,
      }),
      (result) => {
        setClosedShift(result);
        // El turno deja de estar abierto sólo si el servicio lo cerró de verdad.
        if (result.outcome === "CLOSED") setShift(null);
      },
    );
  }, [shift, run, callMutation]);

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
   * El medio seleccionado viaja como metadata NEQUI/DAVIPLATA o null.
   * Identifica lo reportado; no constituye confirmación del proveedor.
   */
  const loadTransfer = useCallback(async (paymentId: string): Promise<void> => {
    if (!canReadPayment) return;
    setTransfer(null);
    setTransferConfirmation(null);
    await run<PaymentGetResult>(
      () => callCommercial("payment.get", { payment_id: paymentId }),
      (result) => {
        if (result.outcome !== "FOUND" || result.payment_id === null || result.method !== "TRANSFER") {
          setError(result.outcome === "FOUND" ? "PAYMENT_NOT_TRANSFER" : result.outcome);
          return;
        }
        setTransfer({ paymentId: result.payment_id, saleId: result.sale_id, version: result.version, status: result.status, expectedAmount: result.expected_amount });
      },
    );
  }, [canReadPayment, run]);

  const registerTransfer = useCallback(async (paymentAmount?: string, provider: "NEQUI" | "DAVIPLATA" | null = null): Promise<void> => {
    const current = sale;
    if (current === null) return;
    const amount = toScale6(paymentAmount ?? current.payableAmount);
    if (amount === null || amount === "0.000000") { setError("INVALID_PAYMENT_AMOUNT"); return; }
    setTransferConfirmation(null);

    let registeredId: string | null = null;
    await run<PaymentRegisterTransferResult>(
      () => callMutation("payment.register.transfer", {
        sale_id: current.saleId,
        amount,
        provider_code: provider,
        provider_reference: null,
      }),
      (result) => {
        if (result.payment_id === null) {
          setError(result.outcome);
          return;
        }
        registeredId = result.payment_id;
        setTransfer({ paymentId: result.payment_id, saleId: current.saleId, version: null, status: null, expectedAmount: null });
      },
    );
    if (registeredId === null) return;

    await loadTransfer(registeredId);
  }, [sale, run, loadTransfer, callMutation]);

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
    if (current === null || current.version === null) return;
    await run<PaymentTransferConfirmResult>(
      () => callMutation("payment.transfer.confirm", {
        payment_id: current.paymentId,
        expected_version: current.version,
      }),
      (result) => {
        setTransferConfirmation(result);
        if (result.outcome === "CONFIRMED" || result.outcome === "IDEMPOTENT") {
          setTransfer((value) => value?.paymentId === current.paymentId ? { ...value, status: "CONFIRMED", version: null } : value);
        }
        if (shouldPlayChime(result)) playConfirmationChime();
      },
    );
  }, [transfer, run, callMutation]);

  const cancelTransfer = useCallback(async (): Promise<void> => {
    const current = transfer;
    if (current === null || current.version === null) return;
    let cancelled = false;
    await run<PaymentCancelResult>(
      () => callMutation("payment.cancel", { payment_id: current.paymentId, expected_version: current.version }),
      (result) => {
        cancelled = result.outcome === "CANCELLED" || result.outcome === "IDEMPOTENT";
        if (!cancelled) setError(result.outcome);
        else {
          setTransfer((value) => value?.paymentId === current.paymentId ? { ...value, status: "CANCELLED", version: null } : value);
          setTransferConfirmation(null);
        }
      },
    );
    if (cancelled) { setTransferConfirmation(null); await loadTransfer(current.paymentId); }
  }, [transfer, run, loadTransfer, callMutation]);

  const listWaiting = useCallback(async ():Promise<void> => {
    await run(() => callCommercial("cart.waiting.list",{}), result => {
      const parsed=WaitingCartResultSchema.safeParse(result);
      if(!parsed.success || parsed.data.outcome!=="FOUND") {setError("WAITING_CART_RESPONSE_INVALID");return;}
      setWaitingCarts(parsed.data.carts);
    });
  },[run]);
  const holdCart = useCallback(async ():Promise<void> => {
    if(busyRef.current || pendingMutation.current || sale || !shift || lines.length===0) return;
    const id=activeWaiting?.id ?? globalThis.crypto.randomUUID();
    await run(() => callMutation("cart.waiting.save",{
      cart_id:id,expected_version:activeWaiting?.version ?? 0,
      cart:{label:waitingLabel,cash_register_id:shift.cashRegisterId,lines,...(customerId ? {customer_id:customerId}:{})},
    }),result=>{
      const parsed=WaitingCartResultSchema.safeParse(result);
      if(!parsed.success || parsed.data.outcome!=="SAVED" || parsed.data.carts[0]?.id!==id) {setError("WAITING_CART_RESPONSE_INVALID");return;}
      setLines([]);setFoundItem(null);setActiveWaiting(null);setWaitingLabel("");setCustomerId(null);
      setWaitingCarts(current=>[...current.filter(c=>c.id!==id),parsed.data.carts[0]!]);
    });
  },[sale,shift,lines,activeWaiting,waitingLabel,customerId,run,callMutation]);
  const resumeCart = useCallback(async (cart:WaitingCart):Promise<void>=>{
    if(busyRef.current || pendingMutation.current || sale || lines.length>0) {setError("Guarda el carrito actual en espera antes de recuperar otro.");return;}
    if(shift && shift.cashRegisterId!==cart.payload.cash_register_id) {setError("Abre la misma caja del carrito antes de recuperarlo.");return;}
    await run(()=>callCommercial("cart.waiting.get",{cart_id:cart.id}),result=>{
      const parsed=WaitingCartResultSchema.safeParse(result);
      const found=parsed.success && parsed.data.outcome==="FOUND" ? parsed.data.carts[0]:undefined;
      if(!found || found.id!==cart.id || found.payload.lines.length===0 || (shift && found.payload.cash_register_id!==shift.cashRegisterId)) {setError("WAITING_CART_NOT_FOUND");return;}
      if(!shift) {
        if(!found.active_shift) {setError("Abre la misma caja del carrito antes de recuperarlo.");return;}
        setShift({shiftId:found.active_shift.shift_id,version:found.active_shift.version,cashRegisterId:found.payload.cash_register_id});
      }
      setLines([...found.payload.lines]);setActiveWaiting(found);setWaitingLabel(found.payload.label);setCustomerId(found.payload.customer_id ?? null);setError(null);
    });
  },[sale,lines,shift,run]);

  const discardWaiting=useCallback(async (cart:WaitingCart):Promise<void>=>{
    if(busyRef.current || pendingMutation.current || activeWaiting?.id===cart.id) return;
    await run(()=>callMutation("cart.waiting.discard",{cart_id:cart.id,expected_version:cart.version}),result=>{
      const parsed=WaitingCartResultSchema.safeParse(result);
      if(!parsed.success || parsed.data.outcome!=="DISCARDED") {setError("WAITING_CART_RESPONSE_INVALID");return;}
      setWaitingCarts(current=>current.filter(item=>item.id!==cart.id));
    });
  },[run,callMutation,activeWaiting]);

  const reset = useCallback((): boolean => {
    if (busyRef.current || pendingMutation.current !== null) { setError("OPERATION_OUTCOME_UNRESOLVED"); return false; }
    setLines([]);
    setActiveWaiting(null);setWaitingLabel("");setCustomerId(null);
    setSale(null);
    setPayment(null);
    setFoundItem(null);
    setTransfer(null);
    setTransferConfirmation(null);
    setError(null);
    return true;
  }, []);

  return {
    customerId, selectCustomer: (id) => {
      if (!busyRef.current && !pendingMutation.current && !sale) setCustomerId(id);
    },
    waitingCarts, waitingLabel, setWaitingLabel, listWaiting, holdCart, resumeCart, discardWaiting,
    busy, error, shift, foundItem, catalogItems, catalogHasMore, catalogBusy, lines, sale, payment, closedShift,
    transfer, transferConfirmation,
    openShift, listCatalogItems, addCatalogItem, findItem, addFoundItem, removeLine, createSale, chargeCash,
    registerTransfer, confirmTransfer, loadTransfer, cancelTransfer, unresolved, retryPending, closeShift, reset,
  };
}
