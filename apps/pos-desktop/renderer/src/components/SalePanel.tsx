import { useState } from "react";
import { useCommercialSale } from "../hooks/useCommercialSale.js";

/**
 * La primera superficie comercial alcanzable: abrir caja, buscar por código de
 * barras, armar la venta, crearla y cobrarla en efectivo.
 *
 * Funcional antes que bonita. Lo que no puede fallar es la semántica: el total
 * mostrado es el que emitió el servicio, y la confirmación sonora la decide
 * `shouldPlayChime`, no esta vista.
 */
export function SalePanel(): React.JSX.Element {
  const sale = useCommercialSale();
  const [registerId, setRegisterId] = useState("");
  const [opening, setOpening] = useState("0.000000");
  const [barcode, setBarcode] = useState("");
  const [quantity, setQuantity] = useState("1.000000");
  const [counted, setCounted] = useState("");

  return (
    <section data-testid="sale-panel">
      <h2>Caja</h2>
      {sale.shift === null ? (
        <div data-testid="shift-closed">
          <input
            data-testid="cash-register-input"
            value={registerId}
            onChange={(e) => { setRegisterId(e.target.value); }}
            placeholder="ID de la caja"
            disabled={sale.busy}
          />
          <input
            data-testid="opening-amount-input"
            value={opening}
            onChange={(e) => { setOpening(e.target.value); }}
            placeholder="Base inicial"
            disabled={sale.busy}
          />
          <button
            data-testid="open-shift-button"
            onClick={() => { void sale.openShift(registerId.trim(), opening.trim()); }}
            disabled={sale.busy || registerId.trim() === ""}
          >
            Abrir turno
          </button>
        </div>
      ) : (
        <div data-testid="shift-open">
          Turno abierto · caja <span data-testid="shift-register">{sale.shift.cashRegisterId}</span>
          {/* Cerrar el turno es lo que permite abrir el siguiente: `DEC-012`
              §25.2 admite un único turno OPEN o CLOSING por caja, así que sin
              cierre la caja queda inservible al día siguiente. */}
          <input
            data-testid="counted-amount-input"
            value={counted}
            onChange={(e) => { setCounted(e.target.value); }}
            placeholder="Efectivo contado"
            disabled={sale.busy}
          />
          <button
            data-testid="close-shift-button"
            onClick={() => { void sale.closeShift(counted.trim()); }}
            disabled={sale.busy || counted.trim() === ""}
          >
            Cerrar turno
          </button>
        </div>
      )}

      <h2>Producto</h2>
      <input
        data-testid="barcode-input"
        value={barcode}
        onChange={(e) => { setBarcode(e.target.value); }}
        placeholder="Código de barras"
        disabled={sale.busy}
      />
      <button
        data-testid="find-item-button"
        onClick={() => { void sale.findItem(barcode.trim()); }}
        disabled={sale.busy || barcode.trim() === ""}
      >
        Buscar
      </button>
      {sale.foundItem !== null && (
        <div data-testid="found-item">
          <span data-testid="found-item-name">{sale.foundItem.name}</span>
          {" · "}
          <span data-testid="found-item-price">{sale.foundItem.price_amount ?? "sin precio"}</span>
          <input
            data-testid="quantity-input"
            value={quantity}
            onChange={(e) => { setQuantity(e.target.value); }}
            disabled={sale.busy}
          />
          <button
            data-testid="add-item-button"
            onClick={() => { sale.addFoundItem(quantity.trim()); }}
            disabled={sale.busy || sale.foundItem.price_amount === null}
          >
            Agregar
          </button>
        </div>
      )}

      <h2>Venta</h2>
      <ul data-testid="cart">
        {sale.lines.map((line, index) => (
          <li key={`${line.presentationId}-${String(index)}`} data-testid="cart-line">
            {line.name} · {line.presentationName} · {line.quantity} × {line.priceAmount}
          </li>
        ))}
      </ul>
      <button
        data-testid="create-sale-button"
        onClick={() => { void sale.createSale(); }}
        disabled={sale.busy || sale.lines.length === 0 || sale.sale !== null}
      >
        Crear venta
      </button>

      {sale.sale !== null && (
        <div data-testid="sale-created">
          Total a pagar: <span data-testid="payable-amount">{sale.sale.payableAmount}</span>
          {/* El identificador se muestra porque el cajero lo necesita para pedir
              el recibo: el cliente vuelve con una duda y hay que recuperarla. */}
          {" · venta "}<span data-testid="sale-id">{sale.sale.saleId}</span>
          <button
            data-testid="charge-cash-button"
            onClick={() => { void sale.chargeCash(); }}
            disabled={sale.busy}
          >
            Cobrar en efectivo
          </button>
        </div>
      )}

      {sale.payment !== null && (
        sale.payment.sale_completed ? (
          <div data-testid="sale-completed">
            Venta cobrada · cambio {sale.payment.change_amount ?? "0.000000"}
          </div>
        ) : (
          <div data-testid="payment-partial">
            Pago registrado ({sale.payment.outcome}) · cobertura{" "}
            <span data-testid="confirmed-coverage">{sale.payment.confirmed_coverage ?? "0.000000"}</span>
            {" "}· la venta aún no está cobrada
          </div>
        )
      )}

      {sale.closedShift !== null && (
        sale.closedShift.outcome === "CLOSED" ? (
          <div data-testid="shift-close-result">
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
          <div data-testid="shift-close-rejected">{sale.closedShift.outcome}</div>
        )
      )}

      {sale.error !== null && <div data-testid="sale-error">{sale.error}</div>}
      <button data-testid="reset-button" onClick={() => { sale.reset(); }} disabled={sale.busy}>
        Nueva venta
      </button>
    </section>
  );
}
