import { CanonicalPermission } from "@pos-platform/contracts";
import { useState } from "react";
import { useCommercialSale } from "../hooks/useCommercialSale.js";
import { ProductAvatar } from "./ProductAvatar.js";

const paymentButtons = [
  { id: "cash", label: "Efectivo", icon: new URL("../assets/payment-icons/banknote.svg", import.meta.url).href },
  { id: "transfer", label: "Transferencia / Nequi / Daviplata / QR manual", icon: new URL("../assets/payment-icons/landmark.svg", import.meta.url).href },
  { id: "card", label: "Tarjeta", icon: new URL("../assets/payment-icons/credit-card.svg", import.meta.url).href },
  { id: "qr", label: "QR integrado", icon: new URL("../assets/payment-icons/qr-code.svg", import.meta.url).href },
  { id: "credit", label: "Fiado / crédito", icon: new URL("../assets/payment-icons/notebook-pen.svg", import.meta.url).href },
] as const;

function PaymentMethodContent({ icon, label }: { icon: string; label: string }): React.JSX.Element {
  return <span className="pos-payment-method-content">
    <img className="pos-payment-method-icon" src={icon} width={24} height={24} alt="" aria-hidden="true" />
    <span>{label}</span>
  </span>;
}

const calculatorKeys = ["1","2","3","4","5","6","7","8","9","0","00","Borrar"] as const;

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
  const [opening, setOpening] = useState("0.000000");
  const [barcode, setBarcode] = useState("");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [quantity, setQuantity] = useState("1.000000");
  const [counted, setCounted] = useState("");
  const [tendered, setTendered] = useState("");
  const [paymentId, setPaymentId] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");

  const appendTendered = (key: string): void => {
    if (key === "Borrar") {
      setTendered("");
      return;
    }
    setTendered((current) => `${current}${key}`.replace(/^0+(?=\d)/, ""));
  };

  return (
    <section data-testid="sale-panel">
      <h2>Caja</h2>
      {sale.shift === null ? (
        <div data-testid="shift-closed" className="pos-shift-card">
          <input data-testid="cash-register-input" aria-label="ID de la caja" value={registerId}
            onChange={(e) => { setRegisterId(e.target.value); }} placeholder="ID de la caja" disabled={sale.busy} />
          <input data-testid="opening-amount-input" aria-label="Base inicial" value={opening}
            onChange={(e) => { setOpening(e.target.value); }} placeholder="Base inicial" disabled={sale.busy} />
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
            <div><h2>Productos</h2><p>Catálogo táctil real: cada tarjeta usa nombre, presentación y precio del catálogo activo.</p></div>
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
                  onClick={() => { sale.addCatalogItem(item, quantity.trim()); }} disabled={sale.busy || sale.unresolved || sale.sale !== null}>
                  <ProductAvatar item={item} />
                  <strong className="pos-product-name-value">{item.name}</strong>
                  <span className="pos-product-presentation">{item.presentation_name}</span>
                  <span className="pos-product-price">{item.price_amount}</span>
                </button>
              ))
            ) : sale.foundItem !== null ? (
              <button type="button" className="pos-product-tile" data-testid="found-product-tile"
                onClick={() => { sale.addFoundItem(quantity.trim()); }}
                disabled={sale.busy || sale.unresolved || sale.sale !== null || sale.foundItem.price_amount === null}>
                <ProductAvatar item={sale.foundItem} />
                <strong className="pos-product-name-value" data-testid="found-item-name">{sale.foundItem.name}</strong>
                <span className="pos-product-presentation">{sale.foundItem.presentation_name}</span>
                <span className="pos-product-price" data-testid="found-item-price">
                  {sale.foundItem.price_amount ?? "Sin precio"}
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
              <strong>Captura de cantidad</strong>
              <span>
                {sale.foundItem !== null
                  ? `${sale.foundItem.unit_code} · precisión ${sale.foundItem.unit_precision}`
                  : "La precisión final la valida el catálogo al crear la venta"}
              </span>
            </div>
            <div className="pos-weighing-row">
              <label>Cantidad<input data-testid="quantity-input" aria-label="Cantidad" value={quantity}
                onChange={(e) => { setQuantity(e.target.value); }} disabled={sale.busy} /></label>
              <button data-testid="read-scale-button" type="button" disabled
                title="La lectura real depende del adaptador de balanza del Hardware Service.">Leer balanza</button>
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
          <h2>Carrito</h2>
          <ul data-testid="cart" className="pos-cart-list">
            {sale.lines.map((line, index) => (
              <li key={`${line.presentationId}-${String(index)}`} data-testid="cart-line">
                <span><strong>{line.name}</strong><small>{line.presentationName} · {line.quantity}</small></span>
                <strong>{line.priceAmount}</strong>
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
              <div className="pos-total"><span>Total a pagar</span><strong data-testid="payable-amount">{sale.sale.payableAmount}</strong></div>
              <span className="pos-payment-reference">Venta {sale.sale.saleId}</span>
              <h3>Medio de pago</h3>
              <label>Importe de este pago<input data-testid="payment-amount-input" aria-label="Importe de este pago"
                value={paymentAmount} placeholder={sale.sale.payableAmount} onChange={(event) => setPaymentAmount(event.target.value)} disabled={sale.busy || completed} /></label>
              <div className="pos-payment-methods">
                {paymentButtons.map((method) => (
                  method.id === "cash" ? (
                    <button key={method.id} type="button" data-testid="charge-cash-button"
                      onClick={() => { void sale.chargeCash(tendered || undefined, paymentAmount || undefined); }}
                      disabled={sale.busy || completed || !permissions.has(CanonicalPermission.PAYMENTS_PAYMENT_REGISTER)}><PaymentMethodContent icon={method.icon} label={method.label} /></button>
                  ) : method.id === "transfer" ? (
                    <button key={method.id} type="button" data-testid="register-transfer-button"
                      onClick={() => { void sale.registerTransfer(paymentAmount || undefined); }}
                      disabled={sale.busy || completed || !permissions.has(CanonicalPermission.PAYMENTS_TRANSFER_REPORT) || (sale.transfer !== null && sale.transfer.status !== "CANCELLED" && sale.transfer.status !== "CONFIRMED")}><PaymentMethodContent icon={method.icon} label={method.label} /></button>
                  ) : (
                    <button key={method.id} type="button" disabled title="Interfaz reservada; falta el contrato de pago integrado.">
                      <PaymentMethodContent icon={method.icon} label={method.label} /><small>En materialización</small>
                    </button>
                  )
                ))}
              </div>

              <div className="pos-cash-calculator">
                <div><span>Efectivo recibido</span><strong data-testid="tendered-display">{tendered || "0"}</strong></div>
                <div className="pos-calculator-grid">
                  {calculatorKeys.map((key) => (
                    <button key={key} type="button" onClick={() => { appendTendered(key); }} disabled={sale.busy}>{key}</button>
                  ))}
                </div>
              </div>
              <p className="pos-payment-note">El cambio lo determina el servicio de pagos; la pantalla no inventa ni recalcula el valor.</p>
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
          <div data-testid="sale-completed" className="pos-result-success">Venta cobrada · cambio {sale.payment.change_amount ?? "0.000000"}</div>
        ) : (
          !completed && <div data-testid="payment-partial">Pago registrado ({sale.payment.outcome}) · cobertura <span data-testid="confirmed-coverage">{sale.payment.confirmed_coverage ?? "0.000000"}</span> · la venta aún no está cobrada</div>
        )
      )}

      {sale.transfer !== null && (
        <div data-testid="transfer-registered" className="pos-result-pending">
          Transferencia registrada · pago <span data-testid="transfer-payment-id">{sale.transfer.paymentId}</span> · estado <span data-testid="transfer-status">{sale.transfer.status}</span> · reportado <span data-testid="transfer-expected-amount">{sale.transfer.expectedAmount}</span>
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
          <div data-testid="transfer-sale-completed" className="pos-result-success">Venta cobrada por transferencia · cobertura <span data-testid="transfer-confirmed-coverage">{sale.transferConfirmation.confirmed_coverage}</span></div>
        ) : (
          !completed && <div data-testid="transfer-partial">Transferencia {sale.transferConfirmation.outcome} · la venta aún no está cobrada</div>
        )
      )}

      {sale.closedShift !== null && (
        sale.closedShift.outcome === "CLOSED" ? (
          <div data-testid="shift-close-result">Turno cerrado · esperado <span data-testid="shift-expected-cash">{sale.closedShift.expected_cash}</span> · contado <span data-testid="shift-counted-amount">{sale.closedShift.counted_amount}</span> · diferencia <strong data-testid="shift-difference">{sale.closedShift.difference_amount}</strong></div>
        ) : <div data-testid="shift-close-rejected">{sale.closedShift.outcome}</div>
      )}

      {sale.error !== null && <div data-testid="sale-error">{sale.error}</div>}
      {sale.unresolved && <div role="alert">
        El resultado de una operación sigue pendiente. El reintento conserva los datos y el importe originales. Resuélvala antes de iniciar otra.
        <button data-testid="retry-pending-operation" disabled={sale.busy} onClick={() => { void sale.retryPending(); }}>Reintentar operación pendiente</button>
      </div>}
      <button data-testid="reset-button" onClick={() => { if (sale.reset()) { setTendered(""); setPaymentAmount(""); } }} disabled={sale.busy}>Nueva venta</button>
    </section>
  );
}
