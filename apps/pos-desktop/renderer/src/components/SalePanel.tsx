import { CanonicalPermission } from "@pos-platform/contracts";
import { ProductAvatar } from "./ProductAvatar.js";
import { useCustomerDirectory } from "../hooks/useCustomerDirectory.js";
import { useEffect, useState } from "react";
import { presentCatalogAvailability } from "../catalog-availability-display.js";
import { formatCopMicros, formatCopPesos, formatScale6Display, parseCopMicros, remainingPayableScale6 } from "../money-display.js";
import { toScale6 } from "../scale6.js";
import { useCommercialSale } from "../hooks/useCommercialSale.js";

/**
 * La primera superficie comercial alcanzable: abrir caja, buscar por código de
 * barras, armar la venta, crearla y cobrarla en efectivo.
 *
 * Funcional antes que bonita. Lo que no puede fallar es la semántica: el total
 * mostrado es el que emitió el servicio, y la confirmación sonora la decide
 * `shouldPlayChime`, no esta vista.
 */
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

export function SalePanel({ permissions }: { permissions?: ReadonlySet<string> } = {}): React.JSX.Element {
  const canReadCatalog = permissions?.has(CanonicalPermission.CATALOG_PRODUCT_READ) === true;
  const canReadCustomers = permissions?.has(CanonicalPermission.CUSTOMERS_CUSTOMER_READ) === true;
  const canRefreshTransfer = permissions === undefined ||
    (permissions.has(CanonicalPermission.PAYMENTS_PAYMENT_READ) && permissions.has(CanonicalPermission.SALES_RECEIPT_READ));
  const canConfirmTransfer = permissions === undefined || permissions.has(CanonicalPermission.PAYMENTS_TRANSFER_CONFIRM);
  const canCreateSale = permissions === undefined || permissions.has(CanonicalPermission.SALES_SALE_CREATE);
  const sale = useCommercialSale({ canReadCatalog });
  const customers = useCustomerDirectory();
  const [catalogQuery, setCatalogQuery] = useState("");
  const [tileQuantity, setTileQuantity] = useState("1");
  const [customerDocument, setCustomerDocument] = useState("");
  const [customerNumber, setCustomerNumber] = useState("");
  const [registerId, setRegisterId] = useState("");
  const [opening, setOpening] = useState("0.000000");
  const [barcode, setBarcode] = useState("");
  const [quantity, setQuantity] = useState("1.000000");
  const [counted, setCounted] = useState("");
  const [manualTendered, setManualTendered] = useState("");
  const [denominationCounts, setDenominationCounts] = useState<Record<number, number>>({});
  const [showDenominations, setShowDenominations] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const transferCompleted = sale.transferReceiptAmount !== null || sale.transferConfirmation?.sale_completed === true;
  const completed = sale.payment?.sale_completed === true || transferCompleted || sale.factusPayConfirmation?.sale_completed === true;
  const confirmedCoverage = [sale.payment?.confirmed_coverage, sale.transferConfirmation?.confirmed_coverage, sale.factusPayConfirmation?.confirmed_coverage]
    .reduce<string | null>((max, value) => {
      if (value == null) return max;
      const parsed = parseCopMicros(value);
      return parsed !== null && parsed > (max === null ? 0n : (parseCopMicros(max) ?? 0n)) ? value : max;
    }, null);
  const remainingAmount = sale.sale === null ? null : remainingPayableScale6(sale.sale.payableAmount, confirmedCoverage);
  useEffect(() => {
    if (confirmedCoverage !== null && remainingAmount !== null && !completed) setPaymentAmount(remainingAmount);
  }, [confirmedCoverage, remainingAmount, completed]);
  useEffect(() => {
    if (sale.payment !== null) { setManualTendered(""); setDenominationCounts({}); }
  }, [sale.payment]);
  const selectedDenominationTotal = cashDenominations.reduce((total, denomination) =>
    total + BigInt(denomination.value) * BigInt(denominationCounts[denomination.value] ?? 0), 0n);
  const receivedTotal = BigInt(manualTendered || "0") + selectedDenominationTotal;
  const tendered = manualTendered !== "" || selectedDenominationTotal > 0n ? receivedTotal.toString() : "";
  const previewSource = paymentAmount.trim() !== "" ? (toScale6(paymentAmount) ?? paymentAmount) : (remainingAmount ?? sale.sale?.payableAmount ?? "");
  const previewPayable = parseCopMicros(previewSource);
  const previewDelta = receivedTotal > 0n && previewPayable !== null ? receivedTotal * 1_000_000n - previewPayable : null;
  const appendTendered = (key: string): void => {
    if (key === "Borrar") { setManualTendered(""); setDenominationCounts({}); return; }
    setManualTendered(current => {
      const value = `${current}${key}`.replace(/^0+(?=\d)/, "");
      return value.length <= 12 ? value : current;
    });
  };
  const changeDenominationCount = (value: number, direction: 1 | -1): void => {
    setDenominationCounts(counts => ({ ...counts, [value]: Math.max(0, Math.min(99, (counts[value] ?? 0) + direction)) }));
  };

  return (
    <section data-testid="sale-panel">
      <h2>Caja</h2>
      {sale.shift === null ? (
        <div className="pos-shift-card" data-testid="shift-closed">
          <div className="pos-shift-intro">
            <h3>Abrir turno de caja</h3>
            <p>Identifica la caja e indica la base inicial antes de vender.</p>
          </div>
          <label>ID de la caja
            <input
              data-testid="cash-register-input"
              value={registerId}
              onChange={(e) => { setRegisterId(e.target.value); }}
              placeholder="ID de la caja"
              disabled={sale.busy}
            />
          </label>
          <label>Base inicial
            <input
              data-testid="opening-amount-input"
              value={opening}
              onChange={(e) => { setOpening(e.target.value); }}
              placeholder="Base inicial"
              disabled={sale.busy}
            />
          </label>
          <button
            data-testid="open-shift-button"
            onClick={() => { void sale.openShift(registerId.trim(), opening.trim()); }}
            disabled={sale.busy || registerId.trim() === ""}
          >
            Abrir turno
          </button>
        </div>
      ) : (
        <div className="pos-shift-card" data-testid="shift-open">
          <div className="pos-shift-intro">
            <h3>Turno abierto</h3>
            <p>Caja <span data-testid="shift-register">{sale.shift.cashRegisterId}</span></p>
          </div>
          {/* Cerrar el turno es lo que permite abrir el siguiente: `DEC-012`
              §25.2 admite un único turno OPEN o CLOSING por caja, así que sin
              cierre la caja queda inservible al día siguiente. */}
          <label>Efectivo contado
            <input
              data-testid="counted-amount-input"
              value={counted}
              onChange={(e) => { setCounted(e.target.value); }}
              placeholder="Efectivo contado"
              disabled={sale.busy}
            />
          </label>
          <button
            data-testid="close-shift-button"
            onClick={() => { void sale.closeShift(counted.trim()); }}
            disabled={sale.busy || counted.trim() === ""}
          >
            Cerrar turno
          </button>
        </div>
      )}

      <div className="pos-sale-layout">
      <section className="pos-sale-products" aria-label="Productos para venta">
      {canReadCatalog && <>
        <div className="pos-section-heading">
          <h2>Catálogo</h2>
          <p>Busca y agrega productos al carrito.</p>
        </div>
        <form className="pos-product-tools" onSubmit={event => {
          event.preventDefault();
          void sale.listCatalogItems(catalogQuery.trim());
        }}>
          <label>Buscar producto<input data-testid="catalog-search-input" maxLength={200} value={catalogQuery}
            onChange={event => setCatalogQuery(event.target.value)} placeholder="Nombre, código o barras" /></label>
          <button data-testid="catalog-search-button" disabled={sale.catalogBusy}>Buscar</button>
        </form>
        <label className="pos-tile-quantity">Cantidad para agregar
          <input inputMode="decimal" value={tileQuantity}
            onChange={event => setTileQuantity(event.target.value)} />
        </label>
        <div className="pos-touch-grid" data-testid="touch-product-grid">
          {sale.catalogItems.map(item => {
            const availability = presentCatalogAvailability(item);
            const blocked = item.availability_state === "OUT_OF_STOCK"
              || item.availability_state === "RESTRICTED";
            return (
              <button
                type="button"
                className="pos-product-tile"
                data-testid={`catalog-product-${item.presentation_id}`}
                data-availability={availability.state}
                key={item.presentation_id}
                disabled={sale.busy || sale.unresolved || sale.sale !== null || blocked}
                onClick={() => sale.addCatalogItem(item, tileQuantity.trim())}
              >
                <ProductAvatar item={item} />
                <strong className="pos-product-name-value">{item.name}</strong>
                <span className="pos-product-code">{item.code}</span>
                <span className="pos-product-presentation">
                  {item.presentation_name} · {item.unit_code}
                </span>
                <span className="pos-product-price">{formatScale6Display(item.price_amount)}</span>
                <span className="pos-product-stock" data-testid={`catalog-stock-${item.presentation_id}`}>
                  {availability.label}
                </span>
              </button>
            );
          })}
          {!sale.catalogBusy && sale.catalogItems.length === 0 && (
            <p className="pos-product-empty" role="status">Sin productos vendibles. Busca por nombre, código o barras.</p>
          )}
        </div>
        {sale.catalogHasMore && <button type="button" data-testid="catalog-load-more"
          disabled={sale.catalogBusy} onClick={() => { void sale.loadMoreCatalogItems(); }}>Cargar más productos</button>}
      </>}
      <div className="pos-barcode-lookup">
        <h3>Código de barras</h3>
        <div className="pos-barcode-lookup-row">
          <label>Escaneo o captura
            <input
              data-testid="barcode-input"
              value={barcode}
              onChange={(e) => { setBarcode(e.target.value); }}
              placeholder="Código de barras"
              disabled={sale.busy}
            />
          </label>
          <button
            data-testid="find-item-button"
            onClick={() => { void sale.findItem(barcode.trim()); }}
            disabled={sale.busy || barcode.trim() === ""}
          >
            Buscar
          </button>
        </div>
        {sale.foundItem !== null && (
          <div className="pos-found-item" data-testid="found-item">
            <p>
              <span data-testid="found-item-name">{sale.foundItem.name}</span>
              {" · "}
              <span data-testid="found-item-price">{sale.foundItem.price_amount ?? "sin precio"}</span>
              {sale.foundItem.availability_state !== null && (
                <>
                  {" · "}
                  <span data-testid="found-item-stock">
                    {presentCatalogAvailability({
                      availability_state: sale.foundItem.availability_state,
                      quantity_available: sale.foundItem.quantity_available,
                      unit_code: sale.foundItem.unit_code ?? "",
                    }).label}
                  </span>
                </>
              )}
            </p>
            <label>Cantidad
              <input
                data-testid="quantity-input"
                value={quantity}
                onChange={(e) => { setQuantity(e.target.value); }}
                disabled={sale.busy}
              />
            </label>
            <div className="pos-found-item-actions">
              {sale.shift !== null && sale.sale === null && (sale.foundItem.unit_code === "KGM" || sale.foundItem.unit_code === "GRM") && (
                <button type="button" data-testid="capture-weight-button" disabled={sale.busy || sale.foundItem.price_amount === null} onClick={() => { void sale.captureWeight(); }}>Pesar y agregar</button>
              )}
              <button
                data-testid="add-item-button"
                onClick={() => { sale.addFoundItem(quantity.trim()); }}
                disabled={sale.busy || sale.foundItem.price_amount === null}
              >
                Agregar
              </button>
            </div>
          </div>
        )}
      </div>

      </section>
      <section className="pos-sale-cart" aria-label="Carrito">
      <h2>Carrito de compras</h2>
      {sale.lines.length === 0 ? (
        <p className="pos-cart-empty">
          Selecciona un producto para agregarlo al carrito.
        </p>
      ) : (
      <div className="pos-cart-table-container">
        <table className="pos-cart-table" data-testid="cart">
          <thead>
            <tr>
              <th>Producto</th>
              <th>Unidad</th>
              <th>Cant.</th>
              <th>Precio</th>
              <th>Valor</th>
              <th aria-label="Acciones"></th>
            </tr>
          </thead>
          <tbody>
            {sale.lines.map((line, index) => (
              <tr key={`${line.presentationId}-${index}`} data-testid="cart-line">
                <td>
                  <strong className="pos-cart-line-name">{line.name}</strong>
                </td>
                <td className="pos-cart-line-unit">{line.presentationName}</td>
                <td className="pos-cart-quantity">
                  <div className="pos-quantity-controls">
                    <button type="button"
                      aria-label={`Disminuir ${line.name}`}
                      disabled={sale.busy || sale.unresolved || sale.sale !== null ||
                        (parseCopMicros(line.quantity) ?? 0n) <= 1000000n}
                      onClick={() => {
                        const value = (parseCopMicros(line.quantity) ?? 0n) - 1000000n;
                        sale.updateLineQuantity(index, `${value / 1000000n}.${(value % 1000000n).toString().padStart(6, "0")}`);
                      }}>−</button>
                    <input
                      key={line.quantity}
                      aria-label={`Cantidad de ${line.name}`}
                      inputMode="decimal"
                      defaultValue={line.quantity.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")}
                      disabled={sale.busy || sale.unresolved || sale.sale !== null}
                      onKeyDown={event => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                      onBlur={event => {
                        const value = event.currentTarget.value;
                        const parsed = parseCopMicros(value);
                        if (parsed === null || parsed <= 0n) {
                          event.currentTarget.value = line.quantity;
                          return;
                        }
                        sale.updateLineQuantity(index, value);
                      }}
                    />
                    <button type="button"
                      aria-label={`Aumentar ${line.name}`}
                      disabled={sale.busy || sale.unresolved || sale.sale !== null}
                      onClick={() => {
                        const value = (parseCopMicros(line.quantity) ?? 0n) + 1000000n;
                        sale.updateLineQuantity(index, `${value / 1000000n}.${(value % 1000000n).toString().padStart(6, "0")}`);
                      }}>+</button>
                  </div>
                </td>
                <td className="pos-cart-money">
                  {formatScale6Display(line.priceAmount)}
                </td>
                <td className="pos-cart-money">
                  <strong>
                    {formatCopMicros(
                      (parseCopMicros(line.quantity) ?? 0n) *
                      (parseCopMicros(line.priceAmount) ?? 0n) /
                      1000000n
                    )}
                  </strong>
                </td>
                <td>
                  {sale.sale === null && (
                    <button
                      type="button"
                      className="pos-cart-remove"
                      disabled={sale.busy || sale.unresolved}
                      aria-label={`Quitar ${line.name}`}
                      title="Eliminar producto"
                      onClick={() => sale.removeLine(index)}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24"
                        fill="none" stroke="currentColor"
                        strokeWidth="1.8" strokeLinecap="round"
                        strokeLinejoin="round" aria-hidden="true">
                        <path d="M3 6h18M8 6V4h8v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/>
                      </svg>
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
      <div className="pos-total" data-testid="cart-preview-total">
        <span>{sale.sale !== null ? "Total a pagar" : "Subtotal estimado (sin impuestos ni redondeo)"}</span>
        <strong>
          {sale.sale !== null
            ? formatScale6Display(sale.sale.payableAmount)
            : sale.lines.every(line => line.currencyCode === "COP" &&
                parseCopMicros(line.quantity) !== null &&
                parseCopMicros(line.priceAmount) !== null)
              ? formatCopMicros(sale.lines.reduce((total, line) =>
                  total + (parseCopMicros(line.quantity)! *
                    parseCopMicros(line.priceAmount)! / 1000000n), 0n))
              : "No disponible"}
        </strong>
      </div>
      {canReadCustomers && <details>
        <summary>Vincular cliente</summary>
        <label>Tipo de documento<input value={customerDocument} onChange={event => setCustomerDocument(event.target.value)} /></label>
        <label>Número de identificación<input value={customerNumber} onChange={event => setCustomerNumber(event.target.value)} /></label>
        <button type="button" disabled={customers.busy || !customerDocument.trim() || !customerNumber.trim()}
          onClick={() => { void customers.find(customerDocument.trim(), customerNumber.trim()); }}>Buscar cliente</button>
        {customers.error && <p role="status">{customers.error}</p>}
        {customers.found?.customer_id && <button type="button" disabled={sale.busy || sale.unresolved || sale.sale !== null}
          onClick={() => sale.selectCustomer(customers.found?.customer_id ?? null)}>Vincular cliente encontrado</button>}
        {sale.customerId && <button type="button" disabled={sale.busy || sale.unresolved || sale.sale !== null}
          onClick={() => sale.selectCustomer(null)}>Quitar cliente vinculado</button>}
      </details>}
          {canCreateSale && <div className="pos-waiting-controls">
            <input aria-label="Referencia del cliente en espera" placeholder="Referencia de espera (opcional)" maxLength={80}
              value={sale.waitingLabel} onChange={e=>sale.setWaitingLabel(e.target.value)} disabled={sale.busy || sale.unresolved || sale.sale!==null}/>
            <button data-testid="hold-cart" onClick={()=>void sale.holdCart()}
              disabled={sale.busy || sale.unresolved || !sale.shift || sale.lines.length===0 || sale.lines.length>200 || sale.sale!==null}>En espera</button>
            {sale.lines.length>200 && <small>Máximo 200 líneas por carrito en espera.</small>}
            <button data-testid="list-waiting" onClick={()=>void sale.listWaiting()} disabled={sale.busy}>Ver en espera</button>
            {sale.waitingCarts.length>0 && <ul aria-label="Clientes en espera">{sale.waitingCarts.map(cart=><li key={cart.id}>
              <button onClick={()=>void sale.resumeCart(cart)} disabled={sale.busy || sale.unresolved || sale.lines.length>0 || sale.sale!==null}>
                {cart.payload.label || "Cliente en espera"} · {cart.line_count} líneas
              </button>
              <button aria-label={`Eliminar ${cart.payload.label || "cliente en espera"}`}
                disabled={sale.busy || sale.unresolved || sale.sale!==null}
                onClick={()=>{if(window.confirm("¿Eliminar este carrito en espera? No se eliminarán ventas ni pagos.")) void sale.discardWaiting(cart);}}>Eliminar</button>
            </li>)}</ul>}
          </div>}
      <button
        className="pos-checkout-action pos-primary-action"
        data-testid="create-sale-button"
        onClick={() => { void sale.createSale(); }}
        disabled={!canCreateSale || sale.busy || sale.unresolved || sale.lines.length === 0 || sale.sale !== null}
      >
        Crear venta
      </button>

      {sale.sale !== null && (
        <div className="pos-payment-card" data-testid="sale-created">
          <div className="pos-payment-card-header">
            <div className="pos-payment-stat">
              <span>Total a pagar</span>
              <strong data-testid="payable-amount" data-amount={sale.sale.payableAmount}>{sale.sale.payableAmount}</strong>
            </div>
            <div className="pos-payment-stat">
              <span>Pendiente</span>
              <strong data-testid="payment-remaining">{remainingAmount ?? sale.sale.payableAmount}</strong>
            </div>
            {/* El identificador se muestra porque el cajero lo necesita para pedir
                el recibo: el cliente vuelve con una duda y hay que recuperarla. */}
            <p className="pos-payment-sale-id">Venta <span data-testid="sale-id">{sale.sale.saleId}</span></p>
          </div>
          <label>Importe de este pago en efectivo<input data-testid="payment-amount-input" aria-label="Importe de este pago en efectivo" value={paymentAmount} placeholder={remainingAmount ?? sale.sale.payableAmount} onChange={event => setPaymentAmount(event.target.value)} disabled={sale.busy || completed} inputMode="decimal" /></label>
              <div className="pos-cash-calculator" aria-label="Contador de efectivo recibido">
                <label>Efectivo recibido (COP)<input aria-label="Efectivo recibido (COP)" inputMode="numeric" value={manualTendered}
                  onChange={event=>{const value=event.target.value; if (/^\d{0,12}$/.test(value)) setManualTendered(value.replace(/^0+(?=\d)/, ""));}}
                  disabled={sale.busy || completed} placeholder="0" /></label>
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
                            disabled={sale.busy || completed || (denominationCounts[denomination.value] ?? 0) >= 99}
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
                              disabled={sale.busy || completed || (denominationCounts[denomination.value] ?? 0) === 0}>−</button>
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
                      disabled={sale.busy || completed}>{key}</button>
                  ))}
                </div>
                </details>
                <div className="pos-cash-summary">
                  <div><span>Dinero recibido</span><strong>{formatCopPesos(receivedTotal)}</strong></div>
                  <div><span>A cobrar en este pago</span><strong>{previewPayable !== null ? formatCopMicros(previewPayable) : "No disponible"}</strong></div>
                  {previewDelta !== null && !completed && (
                    <div
                      data-testid="cash-change-estimate"
                      role="status"
                      data-coverage={previewDelta >= 0n ? "change" : "shortage"}
                    >
                      <span>{previewDelta >= 0n ? "Cambio estimado" : "Falta para cubrir"}</span>
                      <strong>{formatCopMicros(previewDelta >= 0n ? previewDelta : -previewDelta)}</strong>
                    </div>
                  )}
                </div>
              </div>
          <div className="pos-payment-actions" role="group" aria-label="Métodos de cobro">
            <button className="pos-primary-action" type="button"
              data-testid="charge-cash-button"
              onClick={() => { void sale.chargeCash(tendered || undefined, paymentAmount || undefined); }}
              disabled={sale.busy || completed || (confirmedCoverage !== null && !paymentAmount.trim())}
            >
              Confirmar cobro en efectivo
            </button>
            {/* Reportar la transferencia y atestiguarla son dos actos distintos,
                con dos permisos distintos (`UC-PAY-002` y `UC-PAY-003`). La
                pantalla no los funde en un botón: el cajero recibe el comprobante
                y alguien da el dinero por bueno, que no tiene por qué ser el
                mismo. */}
            <button
              data-testid="register-transfer-button"
              onClick={() => { void sale.registerTransfer(); }}
              disabled={sale.busy || completed || sale.transfer !== null}
            >
              Transferencia
            </button>
            <button
              data-testid="factus-pay-collect-button"
              onClick={() => { void sale.collectFactusPay(); }}
              disabled={sale.busy || sale.factusPay !== null}
            >
              Generar QR FACTUS Pay
            </button>
            <button
              data-testid="factus-pay-resume-button"
              onClick={() => { void sale.resumeFactusPay(); }}
              disabled={sale.busy || sale.factusPay !== null}
            >
              Recuperar FACTUS Pay
            </button>
          </div>
        </div>
      )}

      </section>
      </div>

      <div className="pos-sale-results" aria-live="polite">
      {sale.payment !== null && (
        sale.payment.sale_completed ? (
          <div className="pos-result-success" data-testid="sale-completed">
            Venta cobrada · cambio {sale.payment.change_amount ?? "0.000000"}
          </div>
        ) : (
          <div className="pos-result-pending" data-testid="payment-partial">
            Pago registrado ({sale.payment.outcome}) · cobertura{" "}
            <span data-testid="confirmed-coverage">{sale.payment.confirmed_coverage ?? "0.000000"}</span>
            {" "}· la venta aún no está cobrada
          </div>
        )
      )}

      {sale.transfer !== null && (
        <div className="pos-result-pending" data-testid="transfer-registered">
          Transferencia registrada · pago{" "}
          <span data-testid="transfer-payment-id">{sale.transfer.paymentId}</span>
          {" · estado "}
          <span data-testid="transfer-status">{sale.transfer.status}</span>
          {" · reportado "}
          <span data-testid="transfer-expected-amount">{sale.transfer.expectedAmount}</span>
          {/* Registrada NO es cobrada: mientras nadie atestigüe, la venta sigue
              sin completarse y no suena nada. */}
          {sale.transfer.status === "CREATED" && <div data-testid="transfer-pending">Pendiente de confirmación</div>}
          {canRefreshTransfer && !completed && (sale.transfer.status === "CREATED" || sale.transfer.status === "CONFIRMED") && (
            <button type="button" onClick={() => { void sale.refreshTransfer(); }} disabled={sale.busy || sale.unresolved}>
              Actualizar estado de la transferencia
            </button>
          )}
          {canConfirmTransfer && <button
            data-testid="confirm-transfer-button"
            onClick={() => { void sale.confirmTransfer(); }}
            disabled={sale.busy || sale.unresolved || sale.transfer.status !== "CREATED"}
          >
            Confirmar transferencia
          </button>}
        </div>
      )}

      {transferCompleted ? (
        <div className="pos-result-success" data-testid="transfer-sale-completed">
          Venta cobrada por transferencia · cobertura{" "}
          <span data-testid="transfer-confirmed-coverage">
            {sale.transferReceiptAmount ?? sale.transferConfirmation?.confirmed_coverage}
          </span>
        </div>
      ) : sale.transferConfirmation !== null || sale.transfer?.status === "CONFIRMED" ? (
        <div className="pos-result-pending" data-testid="transfer-partial">Transferencia {sale.transferConfirmation?.outcome ?? "confirmada"} · la venta aún no está cobrada</div>
      ) : null}

      {sale.factusPay !== null && (
        <div className="pos-result-pending" data-testid="factus-pay-registered">
          FACTUS Pay · pago{" "}
          <span data-testid="factus-pay-payment-id">{sale.factusPay.paymentId}</span>
          {" · ref "}
          <span data-testid="factus-pay-reference">{sale.factusPay.referenceCode}</span>
          {" · importe "}
          <span data-testid="factus-pay-amount">{sale.factusPay.expectedAmount}</span>
          {sale.factusPay.providerStatus !== null && (
            <>
              {" · proveedor "}
              <span data-testid="factus-pay-provider-status">{sale.factusPay.providerStatus}</span>
            </>
          )}
          <div data-testid="factus-pay-pending">Pendiente de verificación con el proveedor</div>
          {sale.factusPay.qr !== null && (
            <img
              data-testid="factus-pay-qr"
              src={sale.factusPay.qr}
              alt="Código QR FACTUS Pay"
              width={240}
              height={240}
            />
          )}
          <button
            data-testid="factus-pay-verify-button"
            onClick={() => { void sale.verifyFactusPay(); }}
            disabled={sale.busy}
          >
            Verificar FACTUS Pay
          </button>
        </div>
      )}

      {sale.factusPayConfirmation !== null && (
        sale.factusPayConfirmation.sale_completed ? (
          <div className="pos-result-success" data-testid="factus-pay-sale-completed">
            Venta cobrada por FACTUS Pay · cobertura{" "}
            <span data-testid="factus-pay-confirmed-coverage">
              {sale.factusPayConfirmation.confirmed_coverage}
            </span>
          </div>
        ) : (
          <div className="pos-result-pending" data-testid="factus-pay-partial">
            FACTUS Pay {sale.factusPayConfirmation.outcome} · la venta aún no está cobrada
          </div>
        )
      )}

      {sale.closedShift !== null && (
        sale.closedShift.outcome === "CLOSED" ? (
          <div className="pos-result-success" data-testid="shift-close-result">
            Turno cerrado · esperado{" "}
            <span data-testid="shift-expected-cash">{sale.closedShift.expected_cash}</span>
            {" · contado "}
            <span data-testid="shift-counted-amount">{sale.closedShift.counted_amount}</span>
            {" · diferencia "}
            <strong data-testid="shift-difference">{sale.closedShift.difference_amount}</strong>
          </div>
        ) : (
          /* Un cierre rechazado no se disfraza: el código estable es la única
             pista accionable que tiene el cajero. */
          <div className="pos-result-pending" data-testid="shift-close-rejected">{sale.closedShift.outcome}</div>
        )
      )}
      </div>

      {sale.unresolved && <div role="alert">Hay una operación pendiente de respuesta.
        <button type="button" data-testid="retry-pending-operation" disabled={sale.busy} onClick={() => { void sale.retryPending(); }}>Reintentar operación pendiente</button>
      </div>}
      {sale.error !== null && (
        <div data-testid="sale-error">
          {sale.error === "INSUFFICIENT_STOCK"
            ? "No se pudo completar el cobro: el inventario ya no es elegible (p. ej. lote vencido). El pago no se registró."
            : sale.error}
          {sale.error === "INSUFFICIENT_STOCK" && sale.sale !== null && (
            <button
              type="button"
              data-testid="cancel-blocked-sale-button"
              disabled={sale.busy || sale.unresolved}
              onClick={() => { void sale.cancelSale(); }}
            >
              Cancelar venta y liberar reserva
            </button>
          )}
        </div>
      )}
      <button data-testid="reset-button" onClick={() => { if (!sale.reset()) return; setManualTendered(""); setDenominationCounts({}); setPaymentAmount(""); setShowDenominations(false); }} disabled={sale.busy}>
        Nueva venta
      </button>
    </section>
  );
}
