import { CanonicalPermission } from "@pos-platform/contracts";
import { useEffect, useState } from "react";
import { readDesignReviewRegisterId } from "../desktop-hints.js";
import { useCommercialSale } from "../hooks/useCommercialSale.js";
import {
  defaultQuantityInput,
  formatCopMicros,
  formatCopPesos,
  formatQuantityDisplay,
  formatScale6Display,
  parseCopMicros,
} from "../money-display.js";
import { ProductAvatar } from "./ProductAvatar.js";

const paymentButtons = [
  { id: "cash", label: "Efectivo", icon: new URL("../assets/payment-icons/banknote.svg", import.meta.url).href },
  { id: "transfer", label: "Reportar transferencia", icon: new URL("../assets/payment-icons/landmark.svg", import.meta.url).href },
] as const;

const transferProviderLogos = [
  { id: "nequi", label: "Nequi", src: "./payment-denominations/logos/nequi_original.png" },
  { id: "daviplata", label: "Daviplata", src: "./payment-denominations/logos/daviplata_logo_manual_vigente.png" },
] as const;

function PaymentMethodContent({ icon, label }: { icon: string; label: string }): React.JSX.Element {
  return <span className="pos-payment-method-content">
    <img className="pos-payment-method-icon" src={icon} width={24} height={24} alt="" aria-hidden="true" />
    <span>{label}</span>
  </span>;
}

const calculatorKeys = ["1","2","3","4","5","6","7","8","9","0","00","Borrar"] as const;

// Denomination selection only records what the cashier counted locally.
// The authoritative amount and change are still calculated by the payments service.
const cashDenominations = [
  { value: 2000, kind: "billetes", label: "Billete de $2.000" },
  { value: 5000, kind: "billetes", label: "Billete de $5.000" },
  { value: 10000, kind: "billetes", label: "Billete de $10.000" },
  { value: 20000, kind: "billetes", label: "Billete de $20.000" },
  { value: 50000, kind: "billetes", label: "Billete de $50.000" },
  { value: 100000, kind: "billetes", label: "Billete de $100.000" },
  { value: 50, kind: "monedas", label: "Moneda de $50" },
  { value: 100, kind: "monedas", label: "Moneda de $100" },
  { value: 200, kind: "monedas", label: "Moneda de $200" },
  { value: 500, kind: "monedas", label: "Moneda de $500" },
  { value: 1000, kind: "monedas", label: "Moneda de $1.000" },
] as const;

export function SalePanel({ permissions, onReceipt, onInvoice }: {
  permissions: ReadonlySet<string>;
  onReceipt?: ((saleId: string) => void) | undefined;
  onInvoice?: ((saleId: string) => void) | undefined;
}): React.JSX.Element {
  const sale = useCommercialSale({
    canReadCatalog: permissions.has(CanonicalPermission.CATALOG_PRODUCT_READ),
    canReadPayment: permissions.has(CanonicalPermission.PAYMENTS_PAYMENT_READ),
  });
  const completed = sale.payment?.sale_completed === true
    || (sale.transfer?.saleId === sale.sale?.saleId && sale.transferConfirmation?.sale_completed === true);
  const [registerId, setRegisterId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "transfer">("cash");
  const [showDenominations, setShowDenominations] = useState(false);
  const [opening, setOpening] = useState("0");
  const [barcode, setBarcode] = useState("");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [counted, setCounted] = useState("");
  const [manualTendered, setManualTendered] = useState("");
  const [denominationCounts, setDenominationCounts] = useState<Record<number, number>>({});
  const [paymentId, setPaymentId] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const selectedDenominationTotal = cashDenominations.reduce(
    (total, denomination) => total + BigInt(denomination.value) * BigInt(denominationCounts[denomination.value] ?? 0),
    0n,
  );
  const receivedTotal = BigInt(manualTendered || "0") + selectedDenominationTotal;
  const tendered = manualTendered !== "" || selectedDenominationTotal > 0n ? receivedTotal.toString() : "";
  const previewPayable = parseCopMicros(paymentAmount || sale.sale?.payableAmount || "");
  const previewDelta = receivedTotal > 0n && previewPayable !== null
    ? receivedTotal * 1_000_000n - previewPayable : null;
  const activePrecision = sale.foundItem?.unit_precision
    ?? sale.catalogItems.find((item) => item.unit_precision !== null)?.unit_precision
    ?? null;

  useEffect(() => {
    const assigned = readDesignReviewRegisterId();
    if (assigned !== null) setRegisterId((current) => (current === "" ? assigned : current));
  }, []);

  useEffect(() => {
    if (sale.foundItem !== null) {
      setQuantity(defaultQuantityInput(sale.foundItem.unit_precision));
    }
  }, [sale.foundItem]);

  const appendTendered = (key: string): void => {
    if (key === "Borrar") {
      setManualTendered("");
      setDenominationCounts({});
      return;
    }
    setManualTendered((current) => {
      const value = `${current}${key}`.replace(/^0+(?=\d)/, "");
      return value.length <= 12 ? value : current;
    });
  };

  const changeDenominationCount = (value: number, direction: 1 | -1): void => {
    setDenominationCounts((counts) => {
      const current = counts[value] ?? 0;
      const updated = Math.max(0, Math.min(99, current + direction));
      return { ...counts, [value]: updated };
    });
  };

  return (
    <section data-testid="sale-panel">
      <h2>Caja</h2>
      {sale.shift === null ? (
        <div data-testid="shift-closed" className="pos-shift-card">
          <div className="pos-shift-intro"><h3>Comienza tu turno</h3><p>Indica la caja asignada y el efectivo inicial.</p></div>
          <label>Caja asignada
          <input data-testid="cash-register-input" aria-label="ID de la caja" value={registerId}
            onChange={(e) => { setRegisterId(e.target.value); }}
            placeholder={readDesignReviewRegisterId() === null ? "ID de la caja" : "Caja asignada al entorno"}
            disabled={sale.busy} /></label>
          <label>Base inicial (COP)<input data-testid="opening-amount-input" aria-label="Base inicial" value={opening}
            onChange={(e) => { setOpening(e.target.value); }} placeholder="Base inicial" inputMode="decimal" disabled={sale.busy} /></label>
          <button data-testid="open-shift-button" onClick={() => { void sale.openShift(registerId.trim(), opening.trim()); }}
            disabled={sale.busy || !permissions.has(CanonicalPermission.CASH_SHIFT_OPEN) || registerId.trim() === ""}>Abrir turno</button>
        </div>
      ) : (
        <div data-testid="shift-open" className="pos-shift-bar">
          <span>Turno abierto · caja <strong data-testid="shift-register">{sale.shift.cashRegisterId}</strong></span>
          <input data-testid="counted-amount-input" aria-label="Efectivo contado" value={counted}
            onChange={(e) => { setCounted(e.target.value); }} placeholder="Efectivo contado" disabled={sale.busy} />
          <button data-testid="close-shift-button" onClick={() => { void sale.closeShift(counted.trim()); }}
            disabled={sale.busy || !permissions.has(CanonicalPermission.CASH_SHIFT_CLOSE) || counted.trim() === ""}>Cerrar turno</button>
        </div>
      )}

      <div className="pos-sale-layout">
        <section className="pos-sale-products" aria-label="Productos para venta">
          <div className="pos-section-heading">
            <div><h2>Productos</h2><p>Busca o escanea un producto para agregarlo a la venta.</p></div>
            <div className="pos-product-tools">
              <input data-testid="catalog-search-input" aria-label="Buscar producto" value={catalogQuery}
                onChange={(e) => { setCatalogQuery(e.target.value); }} placeholder="Buscar producto, código o barras" disabled={sale.busy} />
              <button data-testid="catalog-search-button" onClick={() => { void sale.listCatalogItems(catalogQuery.trim()); }}
                disabled={sale.busy || sale.catalogBusy || !permissions.has(CanonicalPermission.CATALOG_PRODUCT_READ)}>Buscar catálogo</button>
              <input data-testid="barcode-input" aria-label="Código de barras" value={barcode}
                onChange={(e) => { setBarcode(e.target.value); }} placeholder="Escanear o escribir código" disabled={sale.busy} />
              <button data-testid="find-item-button" onClick={() => { void sale.findItem(barcode.trim()); }}
                disabled={sale.busy || !permissions.has(CanonicalPermission.CATALOG_PRODUCT_READ) || barcode.trim() === ""}>Buscar</button>
            </div>
          </div>

          <div className="pos-touch-grid" data-testid="touch-product-grid">
            {sale.catalogItems.length > 0 ? (
              sale.catalogItems.map((item) => (
                <button type="button" className="pos-product-tile" key={item.presentation_id} data-testid={`catalog-product-${item.presentation_id}`}
                  onClick={() => {
                    const qty = quantity.trim() === "" ? defaultQuantityInput(item.unit_precision) : quantity.trim();
                    sale.addCatalogItem(item, qty);
                  }} disabled={sale.busy || sale.unresolved || sale.sale !== null}>
                  <ProductAvatar item={item} />
                  <strong className="pos-product-name-value">{item.name}</strong>
                  <span className="pos-product-presentation">{item.presentation_name}</span>
                  <span className="pos-product-price" data-amount={item.price_amount ?? ""}>
                    {item.price_amount === null ? "Sin precio" : formatScale6Display(item.price_amount)}
                  </span>
                </button>
              ))
            ) : sale.foundItem !== null ? (
              <button type="button" className="pos-product-tile" data-testid="found-product-tile"
                onClick={() => { sale.addFoundItem(quantity.trim()); }}
                disabled={sale.busy || sale.unresolved || sale.sale !== null || sale.foundItem.price_amount === null}>
                <ProductAvatar item={sale.foundItem} />
                <strong className="pos-product-name-value" data-testid="found-item-name">{sale.foundItem.name}</strong>
                <span className="pos-product-presentation">{sale.foundItem.presentation_name}</span>
                <span className="pos-product-price" data-testid="found-item-price" data-amount={sale.foundItem.price_amount ?? ""}>
                  {sale.foundItem.price_amount === null ? "Sin precio" : formatScale6Display(sale.foundItem.price_amount)}
                </span>
              </button>
            ) : (
              <div className="pos-product-empty" data-testid="touch-product-empty">
                <span className="pos-product-icon" aria-hidden="true">⌕</span>
                <strong>Sin productos vendibles</strong>
                <small>El catálogo debe tener producto, presentación y precio activos.</small>
              </div>
            )}
          </div>
          {sale.catalogHasMore && (
            <button type="button" data-testid="catalog-load-more" onClick={() => { void sale.listCatalogItems(catalogQuery.trim(), sale.catalogItems.length); }} disabled={sale.busy || sale.catalogBusy || !permissions.has(CanonicalPermission.CATALOG_PRODUCT_READ)}>
              Cargar más productos
            </button>
          )}

          <div className="pos-weighing-card" data-testid="product-capture">
            <div>
              <strong>Cantidad para agregar</strong>
              <span>
                {sale.foundItem !== null
                  ? `Unidad: ${sale.foundItem.unit_code}`
                  : "Elige la cantidad y selecciona un producto"}
              </span>
            </div>
            <div className="pos-weighing-row">
              <label>Cantidad<input data-testid="quantity-input" aria-label="Cantidad" value={quantity}
                onChange={(e) => { setQuantity(e.target.value); }} disabled={sale.busy}
                inputMode={activePrecision === 0 ? "numeric" : "decimal"} /></label>
              {sale.foundItem !== null ? (
                <button data-testid="add-item-button" onClick={() => { sale.addFoundItem(quantity.trim()); }}
                  disabled={sale.busy || sale.unresolved || sale.sale !== null || sale.foundItem.price_amount === null}>Agregar al carrito</button>
              ) : (
                <span className="pos-product-capture-hint">La cantidad se aplica a la tarjeta que toques.</span>
              )}
            </div>
          </div>
        </section>

        <section className="pos-sale-cart" aria-label="Venta actual">
          <h2>Carrito <small>({sale.lines.length} líneas)</small></h2>
          <ul data-testid="cart" className="pos-cart-list">
            {sale.lines.map((line, index) => (
              <li key={`${line.presentationId}-${String(index)}`} data-testid="cart-line">
                <span>
                  <strong>{line.name}</strong>
                  <small>{line.presentationName} · {formatQuantityDisplay(line.quantity, activePrecision)}</small>
                </span>
                <strong data-amount={line.priceAmount}>{formatScale6Display(line.priceAmount)}</strong>
                <button aria-label={`Quitar ${line.name} del carrito`} disabled={sale.busy || sale.unresolved || sale.sale !== null}
                  onClick={() => sale.removeLine(index)}>Quitar</button>
              </li>
            ))}
          </ul>
          <button data-testid="create-sale-button" className="pos-primary-action"
            onClick={() => { void sale.createSale(); }}
            disabled={sale.busy || !permissions.has(CanonicalPermission.SALES_SALE_CREATE) || sale.lines.length === 0 || sale.sale !== null}>Continuar al cobro</button>

          {sale.sale !== null && (
            <div data-testid="sale-created" className="pos-payment-card">
              <div className="pos-total">
                <span>Total a pagar</span>
                <strong data-testid="payable-amount" data-amount={sale.sale.payableAmount}>
                  {formatScale6Display(sale.sale.payableAmount)}
                </strong>
              </div>
              <details className="pos-payment-reference"><summary>Referencia de la venta</summary>{sale.sale.saleId}</details>
              <h3>Medio de pago</h3>
              <label>Importe de este pago<input data-testid="payment-amount-input" aria-label="Importe de este pago"
                value={paymentAmount} placeholder={sale.sale.payableAmount} onChange={(event) => setPaymentAmount(event.target.value)} disabled={sale.busy || completed} /></label>
              <div className="pos-payment-methods">
                {paymentButtons.map(method => <button key={method.id} type="button"
                  data-testid={`select-payment-${method.id}`} aria-pressed={paymentMethod === method.id}
                  onClick={() => setPaymentMethod(method.id)} disabled={sale.busy || sale.unresolved || completed}>
                  <PaymentMethodContent icon={method.icon} label={method.id === "cash" ? "Efectivo" : "Transferencia"} />
                </button>)}
              </div>

              {paymentMethod === "transfer" && <div className="pos-transfer-providers" data-testid="transfer-provider-logos" aria-label="Medios de transferencia manual">
                {transferProviderLogos.map((logo) => (
                  <img
                    key={logo.id}
                    className="pos-transfer-provider-logo"
                    src={logo.src}
                    alt={logo.label}
                    data-testid={`transfer-logo-${logo.id}`}
                    onError={(event) => { event.currentTarget.hidden = true; }}
                  />
                ))}
                <p>Los logos identifican la transferencia manual. No habilitan cobro integrado ni QR en línea.</p>
              </div>}

              {paymentMethod === "cash" && <div className="pos-cash-calculator" aria-label="Contador de efectivo recibido">
                <label>Efectivo recibido (COP)<input aria-label="Efectivo recibido (COP)" inputMode="numeric" value={manualTendered}
                  onChange={event=>{const value=event.target.value; if (/^\d{0,12}$/.test(value)) setManualTendered(value.replace(/^0+(?=\d)/, ""));}}
                  disabled={sale.busy || sale.unresolved || completed} placeholder="0" /></label>
                <strong data-testid="tendered-display">{formatCopPesos(receivedTotal)}</strong>
                <button type="button" aria-expanded={showDenominations} aria-controls="pos-denominations"
                  onClick={()=>setShowDenominations(open=>!open)}>{showDenominations ? "Ocultar billetes y monedas" : "Ver billetes y monedas"}</button>
                <div id="pos-denominations" hidden={!showDenominations}>
                <p>El conteo de billetes se suma al importe ingresado manualmente.</p>
                {(["billetes", "monedas"] as const).map((kind) => (
                  <div className="pos-denomination-section" key={kind}>
                    <h4>{kind === "billetes" ? "Billetes" : "Monedas"}</h4>
                    <div className="pos-denomination-grid" data-testid={`denominations-${kind}`}>
                      {cashDenominations.filter((item) => item.kind === kind).map((denomination) => (
                        <div className="pos-denomination-item" key={denomination.value}>
                          <button
                            type="button"
                            className="pos-denomination-add"
                            data-testid={`denomination-add-${denomination.value}`}
                            aria-label={`Añadir ${denomination.label.toLowerCase()}`}
                            onClick={() => changeDenominationCount(denomination.value, 1)}
                            disabled={sale.busy || sale.unresolved || completed || !permissions.has(CanonicalPermission.PAYMENTS_PAYMENT_REGISTER) || (denominationCounts[denomination.value] ?? 0) >= 99}
                          >
                            <img
                              src={`./payment-denominations/${kind}/${kind === "billetes" ? "billete" : "moneda"}_${denomination.value}_cop.png`}
                              alt=""
                              aria-hidden="true"
                              onError={(event) => { event.currentTarget.hidden = true; }}
                            />
                            <span>{formatCopPesos(BigInt(denomination.value))}</span>
                          </button>
                          <div className="pos-denomination-quantity">
                            <span data-testid={`denomination-count-${denomination.value}`}>× {denominationCounts[denomination.value] ?? 0}</span>
                            <button type="button" aria-label={`Quitar ${denomination.label.toLowerCase()}`}
                              data-testid={`denomination-remove-${denomination.value}`}
                              onClick={() => changeDenominationCount(denomination.value, -1)}
                              disabled={sale.busy || sale.unresolved || completed || !permissions.has(CanonicalPermission.PAYMENTS_PAYMENT_REGISTER) || (denominationCounts[denomination.value] ?? 0) === 0}>−</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                </div>
                <details className="pos-cash-keypad"><summary>Teclado numérico</summary>
                <p className="pos-cash-keypad-label">Importe adicional o ingreso manual (COP)</p>
                <div className="pos-calculator-grid">
                  {calculatorKeys.map((key) => (
                    <button key={key} type="button" onClick={() => { appendTendered(key); }}
                      disabled={sale.busy || sale.unresolved || completed || !permissions.has(CanonicalPermission.PAYMENTS_PAYMENT_REGISTER)}>{key}</button>
                  ))}
                </div>
                </details>
                <div className="pos-cash-summary">
                  <div><span>Dinero recibido</span><strong>{formatCopPesos(receivedTotal)}</strong></div>
                  <div><span>A cobrar en este pago</span><strong>{previewPayable !== null ? formatCopMicros(previewPayable) : "No disponible"}</strong></div>
                  {previewDelta !== null && !completed && (
                    <div data-testid="cash-change-estimate" role="status">
                      <span>{previewDelta >= 0n ? "Cambio estimado" : "Falta para cubrir"}</span>
                      <strong>{formatCopMicros(previewDelta >= 0n ? previewDelta : -previewDelta)}</strong>
                    </div>
                  )}
                </div>
              </div>}
              <div className="pos-checkout-action">
                {paymentMethod === "cash" ? <button type="button" className="pos-primary-action" data-testid="charge-cash-button"
                  onClick={() => { void sale.chargeCash(tendered || undefined, paymentAmount || undefined); }}
                  disabled={sale.busy || sale.unresolved || completed || !permissions.has(CanonicalPermission.PAYMENTS_PAYMENT_REGISTER)}>
                  {sale.busy ? "Procesando…" : "Confirmar cobro en efectivo"}</button>
                : <button type="button" className="pos-primary-action" data-testid="register-transfer-button"
                  onClick={() => { void sale.registerTransfer(paymentAmount || undefined); }}
                  disabled={sale.busy || sale.unresolved || completed || !permissions.has(CanonicalPermission.PAYMENTS_TRANSFER_REPORT) || (sale.transfer !== null && sale.transfer.status !== "CANCELLED" && sale.transfer.status !== "CONFIRMED")}>
                  {sale.busy ? "Procesando…" : "Reportar transferencia"}</button>}
              </div>
              <p className="pos-payment-note">{paymentMethod === "cash" ? "Confirma después de contar el efectivo recibido." : "Reportar no confirma el ingreso. Un operador autorizado debe verificarlo."}</p>
            </div>
          )}
        </section>
      </div>

      {completed && sale.sale !== null && (
        <div>
          {onReceipt && <button data-testid="sale-view-receipt" onClick={() => onReceipt(sale.sale!.saleId)}>Ver comprobante de esta venta</button>}
          {onInvoice && <button data-testid="sale-issue-invoice" onClick={() => onInvoice(sale.sale!.saleId)}>Facturar esta venta</button>}
        </div>
      )}

      {sale.payment !== null && (
        sale.payment.sale_completed ? (
          <div data-testid="sale-completed" className="pos-result-success">
            Venta cobrada · cambio{" "}
            <span data-amount={sale.payment.change_amount ?? "0.000000"}>
              {formatScale6Display(sale.payment.change_amount ?? "0.000000")}
            </span>
          </div>
        ) : (
          !completed && <div data-testid="payment-partial">Pago registrado ({sale.payment.outcome}) · cobertura <span data-testid="confirmed-coverage" data-amount={sale.payment.confirmed_coverage ?? "0.000000"}>{formatScale6Display(sale.payment.confirmed_coverage ?? "0.000000")}</span> · la venta aún no está cobrada</div>
        )
      )}

      {sale.transfer !== null && (
        <div data-testid="transfer-registered" className="pos-result-pending">
          Transferencia registrada · pago <span data-testid="transfer-payment-id">{sale.transfer.paymentId}</span> · estado <span data-testid="transfer-status">{sale.transfer.status}</span> · reportado <span data-testid="transfer-expected-amount" data-amount={sale.transfer.expectedAmount ?? ""}>{formatScale6Display(sale.transfer.expectedAmount)}</span>
          {sale.transfer.status === "CREATED" && sale.transferConfirmation === null && <div data-testid="transfer-pending">Pendiente de confirmación</div>}
          {sale.transfer.status === null && <p>El pago quedó registrado. Su estado y versión requieren consulta autorizada.</p>}
          <button data-testid="confirm-transfer-button" onClick={() => { void sale.confirmTransfer(); }} disabled={sale.busy || completed || !permissions.has(CanonicalPermission.PAYMENTS_TRANSFER_CONFIRM) || sale.transfer.version === null || sale.transfer.status !== "CREATED"}>Confirmar transferencia</button>
          <button data-testid="cancel-transfer-button" onClick={() => { void sale.cancelTransfer(); }}
            disabled={sale.busy || !permissions.has(CanonicalPermission.PAYMENTS_PAYMENT_CANCEL) || sale.transfer.version === null || sale.transfer.status !== "CREATED"}>Cancelar transferencia no confirmada</button>
          {permissions.has(CanonicalPermission.PAYMENTS_PAYMENT_READ) && <button disabled={sale.busy}
            onClick={() => { void sale.loadTransfer(sale.transfer!.paymentId); }}>Actualizar estado de la transferencia</button>}
        </div>
      )}

      {permissions.has(CanonicalPermission.PAYMENTS_PAYMENT_READ) && (
        <section aria-label="Consultar transferencia">
          <input aria-label="ID del pago por transferencia" data-testid="transfer-lookup-input" value={paymentId} onChange={(event) => setPaymentId(event.target.value)} disabled={sale.busy} />
          <button data-testid="transfer-lookup-button" onClick={() => { void sale.loadTransfer(paymentId.trim()); }} disabled={sale.busy || paymentId.trim() === ""}>Consultar transferencia</button>
        </section>
      )}

      {sale.transferConfirmation !== null && (
        sale.transferConfirmation.sale_completed ? (
          <div data-testid="transfer-sale-completed" className="pos-result-success">Venta cobrada por transferencia · cobertura <span data-testid="transfer-confirmed-coverage" data-amount={sale.transferConfirmation.confirmed_coverage ?? ""}>{formatScale6Display(sale.transferConfirmation.confirmed_coverage)}</span></div>
        ) : (
          !completed && <div data-testid="transfer-partial">Transferencia {sale.transferConfirmation.outcome} · la venta aún no está cobrada</div>
        )
      )}

      {sale.closedShift !== null && (
        sale.closedShift.outcome === "CLOSED" ? (
          <div data-testid="shift-close-result">Turno cerrado · esperado <span data-testid="shift-expected-cash" data-amount={sale.closedShift.expected_cash ?? ""}>{formatScale6Display(sale.closedShift.expected_cash)}</span> · contado <span data-testid="shift-counted-amount" data-amount={sale.closedShift.counted_amount ?? ""}>{formatScale6Display(sale.closedShift.counted_amount)}</span> · diferencia <strong data-testid="shift-difference" data-amount={sale.closedShift.difference_amount ?? ""}>{formatScale6Display(sale.closedShift.difference_amount)}</strong></div>
        ) : <div data-testid="shift-close-rejected">{sale.closedShift.outcome}</div>
      )}

      {sale.error !== null && <div data-testid="sale-error">{sale.error}</div>}
      {sale.unresolved && <div role="alert">
        El resultado de una operación sigue pendiente. El reintento conserva los datos y el importe originales. Resuélvala antes de iniciar otra.
        <button data-testid="retry-pending-operation" disabled={sale.busy} onClick={() => { void sale.retryPending(); }}>Reintentar operación pendiente</button>
      </div>}
      <button data-testid="reset-button" onClick={() => { if (sale.reset()) { setManualTendered(""); setDenominationCounts({}); setPaymentAmount(""); setPaymentMethod("cash"); setShowDenominations(false); } }} disabled={sale.busy}>Nueva venta</button>
    </section>
  );
}

