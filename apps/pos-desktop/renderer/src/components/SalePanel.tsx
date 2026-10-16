import { useState } from "react";
import { useCommercialSale } from "../hooks/useCommercialSale.js";
import { ProductAvatar } from "./ProductAvatar.js";

const paymentButtons = [
  { id: "cash", label: "Efectivo" },
  { id: "transfer", label: "Transferencia / Nequi / Daviplata / QR manual" },
  { id: "card", label: "Tarjeta" },
  { id: "qr", label: "QR integrado" },
  { id: "credit", label: "Fiado / crédito" },
] as const;

const calculatorKeys = ["1","2","3","4","5","6","7","8","9","0","00","Borrar"] as const;

export function SalePanel(): React.JSX.Element {
  const sale = useCommercialSale();
  const [registerId, setRegisterId] = useState("");
  const [opening, setOpening] = useState("0.000000");
  const [barcode, setBarcode] = useState("");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [quantity, setQuantity] = useState("1.000000");
  const [counted, setCounted] = useState("");
  const [tendered, setTendered] = useState("");

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
        <div data-testid="shift-closed">
          <input data-testid="cash-register-input" aria-label="ID de la caja" value={registerId}
            onChange={(e) => { setRegisterId(e.target.value); }} placeholder="ID de la caja" disabled={sale.busy} />
          <input data-testid="opening-amount-input" aria-label="Base inicial" value={opening}
            onChange={(e) => { setOpening(e.target.value); }} placeholder="Base inicial" disabled={sale.busy} />
          <button data-testid="open-shift-button" onClick={() => { void sale.openShift(registerId.trim(), opening.trim()); }}
            disabled={sale.busy || registerId.trim() === ""}>Abrir turno</button>
        </div>
      ) : (
        <div data-testid="shift-open" className="pos-shift-bar">
          <span>Turno abierto · caja <strong data-testid="shift-register">{sale.shift.cashRegisterId}</strong></span>
          <input data-testid="counted-amount-input" aria-label="Efectivo contado" value={counted}
            onChange={(e) => { setCounted(e.target.value); }} placeholder="Efectivo contado" disabled={sale.busy} />
          <button data-testid="close-shift-button" onClick={() => { void sale.closeShift(counted.trim()); }}
            disabled={sale.busy || counted.trim() === ""}>Cerrar turno</button>
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
                disabled={sale.busy}>Buscar catálogo</button>
              <input data-testid="barcode-input" aria-label="Código de barras" value={barcode}
                onChange={(e) => { setBarcode(e.target.value); }} placeholder="Escanear o escribir código" disabled={sale.busy} />
              <button data-testid="find-item-button" onClick={() => { void sale.findItem(barcode.trim()); }}
                disabled={sale.busy || barcode.trim() === ""}>Buscar</button>
            </div>
          </div>

          <div className="pos-touch-grid" data-testid="touch-product-grid">
            {sale.catalogItems.length > 0 ? (
              sale.catalogItems.map((item) => (
                <button type="button" className="pos-product-tile" key={item.presentation_id} data-testid={`catalog-product-${item.presentation_id}`}
                  onClick={() => { sale.addCatalogItem(item, quantity.trim()); }} disabled={sale.busy}>
                  <ProductAvatar item={item} />
                  <strong className="pos-product-name-value">{item.name}</strong>
                  <span className="pos-product-presentation">{item.presentation_name}</span>
                  <span className="pos-product-price">{item.price_amount}</span>
                </button>
              ))
            ) : sale.foundItem !== null ? (
              <button type="button" className="pos-product-tile" data-testid="found-product-tile"
                onClick={() => { sale.addFoundItem(quantity.trim()); }}
                disabled={sale.busy || sale.foundItem.price_amount === null}>
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
            <button type="button" data-testid="catalog-load-more" onClick={() => { void sale.listCatalogItems(catalogQuery.trim(), sale.catalogItems.length); }} disabled={sale.busy}>
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
                  disabled={sale.busy || sale.foundItem.price_amount === null}>Agregar al carrito</button>
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
              </li>
            ))}
          </ul>
          <button data-testid="create-sale-button" className="pos-primary-action"
            onClick={() => { void sale.createSale(); }}
            disabled={sale.busy || sale.lines.length === 0 || sale.sale !== null}>Continuar al cobro</button>

          {sale.sale !== null && (
            <div data-testid="sale-created" className="pos-payment-card">
              <div className="pos-total"><span>Total a pagar</span><strong data-testid="payable-amount">{sale.sale.payableAmount}</strong></div>
              <span className="pos-payment-reference">Venta {sale.sale.saleId}</span>
              <h3>Medio de pago</h3>
              <div className="pos-payment-methods">
                {paymentButtons.map((method) => (
                  method.id === "cash" ? (
                    <button key={method.id} type="button" data-testid="charge-cash-button"
                      onClick={() => { void sale.chargeCash(tendered || sale.sale?.payableAmount); }}
                      disabled={sale.busy}>{method.label}</button>
                  ) : method.id === "transfer" ? (
                    <button key={method.id} type="button" data-testid="register-transfer-button"
                      onClick={() => { void sale.registerTransfer(); }}
                      disabled={sale.busy || sale.transfer !== null}>{method.label}</button>
                  ) : (
                    <button key={method.id} type="button" disabled title="Interfaz reservada; falta el contrato de pago integrado.">
                      {method.label}<small>En materialización</small>
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

      {sale.payment !== null && (
        sale.payment.sale_completed ? (
          <div data-testid="sale-completed" className="pos-result-success">Venta cobrada · cambio {sale.payment.change_amount ?? "0.000000"}</div>
        ) : (
          <div data-testid="payment-partial">Pago registrado ({sale.payment.outcome}) · cobertura <span data-testid="confirmed-coverage">{sale.payment.confirmed_coverage ?? "0.000000"}</span> · la venta aún no está cobrada</div>
        )
      )}

      {sale.transfer !== null && (
        <div data-testid="transfer-registered" className="pos-result-pending">
          Transferencia registrada · pago <span data-testid="transfer-payment-id">{sale.transfer.paymentId}</span> · estado <span data-testid="transfer-status">{sale.transfer.status}</span> · reportado <span data-testid="transfer-expected-amount">{sale.transfer.expectedAmount}</span>
          <div data-testid="transfer-pending">Pendiente de confirmación</div>
          <button data-testid="confirm-transfer-button" onClick={() => { void sale.confirmTransfer(); }} disabled={sale.busy}>Confirmar transferencia</button>
        </div>
      )}

      {sale.transferConfirmation !== null && (
        sale.transferConfirmation.sale_completed ? (
          <div data-testid="transfer-sale-completed" className="pos-result-success">Venta cobrada por transferencia · cobertura <span data-testid="transfer-confirmed-coverage">{sale.transferConfirmation.confirmed_coverage}</span></div>
        ) : (
          <div data-testid="transfer-partial">Transferencia {sale.transferConfirmation.outcome} · la venta aún no está cobrada</div>
        )
      )}

      {sale.closedShift !== null && (
        sale.closedShift.outcome === "CLOSED" ? (
          <div data-testid="shift-close-result">Turno cerrado · esperado <span data-testid="shift-expected-cash">{sale.closedShift.expected_cash}</span> · contado <span data-testid="shift-counted-amount">{sale.closedShift.counted_amount}</span> · diferencia <strong data-testid="shift-difference">{sale.closedShift.difference_amount}</strong></div>
        ) : <div data-testid="shift-close-rejected">{sale.closedShift.outcome}</div>
      )}

      {sale.error !== null && <div data-testid="sale-error">{sale.error}</div>}
      <button data-testid="reset-button" onClick={() => { sale.reset(); setTendered(""); }} disabled={sale.busy}>Nueva venta</button>
    </section>
  );
}
