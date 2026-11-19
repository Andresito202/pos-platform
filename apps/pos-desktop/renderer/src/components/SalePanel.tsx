import { useEffect, useState } from "react";
import { formatCopMicros, formatCopPesos, parseCopMicros, remainingPayableScale6 } from "../money-display.js";
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

export function SalePanel(): React.JSX.Element {
  const sale = useCommercialSale();
  const [registerId, setRegisterId] = useState("");
  const [opening, setOpening] = useState("0.000000");
  const [barcode, setBarcode] = useState("");
  const [quantity, setQuantity] = useState("1.000000");
  const [counted, setCounted] = useState("");
  const [manualTendered, setManualTendered] = useState("");
  const [denominationCounts, setDenominationCounts] = useState<Record<number, number>>({});
  const [showDenominations, setShowDenominations] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const completed = sale.payment?.sale_completed === true || sale.transferConfirmation?.sale_completed === true || sale.factusPayConfirmation?.sale_completed === true;
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
          Total a pagar: <span data-testid="payable-amount" data-amount={sale.sale.payableAmount}>{sale.sale.payableAmount}</span>
          {/* El identificador se muestra porque el cajero lo necesita para pedir
              el recibo: el cliente vuelve con una duda y hay que recuperarla. */}
          {" · venta "}<span data-testid="sale-id">{sale.sale.saleId}</span>
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
                    <div data-testid="cash-change-estimate" role="status">
                      <span>{previewDelta >= 0n ? "Cambio estimado" : "Falta para cubrir"}</span>
                      <strong>{formatCopMicros(previewDelta >= 0n ? previewDelta : -previewDelta)}</strong>
                    </div>
                  )}
                </div>
              </div>
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
            disabled={sale.busy || sale.transfer !== null}
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

      {sale.transfer !== null && (
        <div data-testid="transfer-registered">
          Transferencia registrada · pago{" "}
          <span data-testid="transfer-payment-id">{sale.transfer.paymentId}</span>
          {" · estado "}
          <span data-testid="transfer-status">{sale.transfer.status}</span>
          {" · reportado "}
          <span data-testid="transfer-expected-amount">{sale.transfer.expectedAmount}</span>
          {/* Registrada NO es cobrada: mientras nadie atestigüe, la venta sigue
              sin completarse y no suena nada. */}
          <div data-testid="transfer-pending">Pendiente de confirmación</div>
          <button
            data-testid="confirm-transfer-button"
            onClick={() => { void sale.confirmTransfer(); }}
            disabled={sale.busy}
          >
            Confirmar transferencia
          </button>
        </div>
      )}

      {sale.transferConfirmation !== null && (
        sale.transferConfirmation.sale_completed ? (
          <div data-testid="transfer-sale-completed">
            Venta cobrada por transferencia · cobertura{" "}
            <span data-testid="transfer-confirmed-coverage">
              {sale.transferConfirmation.confirmed_coverage}
            </span>
          </div>
        ) : (
          <div data-testid="transfer-partial">
            Transferencia {sale.transferConfirmation.outcome} · la venta aún no está cobrada
          </div>
        )
      )}

      {sale.factusPay !== null && (
        <div data-testid="factus-pay-registered">
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
          <div data-testid="factus-pay-sale-completed">
            Venta cobrada por FACTUS Pay · cobertura{" "}
            <span data-testid="factus-pay-confirmed-coverage">
              {sale.factusPayConfirmation.confirmed_coverage}
            </span>
          </div>
        ) : (
          <div data-testid="factus-pay-partial">
            FACTUS Pay {sale.factusPayConfirmation.outcome} · la venta aún no está cobrada
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
      <button data-testid="reset-button" onClick={() => { sale.reset(); setManualTendered(""); setDenominationCounts({}); setPaymentAmount(""); setShowDenominations(false); }} disabled={sale.busy}>
        Nueva venta
      </button>
    </section>
  );
}
