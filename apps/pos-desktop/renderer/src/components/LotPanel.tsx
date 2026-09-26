import { useState } from "react";
import { useLots } from "../hooks/useLots.js";
import { useReceipt } from "../hooks/useReceipt.js";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Las salidas que no son venta, dichas como las diría el mostrador. */
const OUTFLOW_LABEL: Readonly<Record<string, string>> = {
  SALE: "Venta",
  SHRINKAGE: "Merma",
  ADJUSTMENT_NEGATIVE: "Ajuste",
  TRANSFER_OUT: "Traslado",
  CONVERSION_OUT: "Apertura",
};

/**
 * Lotes y vencimientos — `UC-INVENTORY-002` §Lotes y §Vencimientos.
 *
 * Tres cosas, en el orden en que pasan: llega la tanda y se declara; se mira
 * qué vence antes; y, si el proveedor avisa de un problema, se rastrea a qué
 * ventas fue.
 *
 * El rastro devuelve la venta, no al comprador: quién compró es dato de
 * ventas. Cada venta se abre con su recibo, que es el contrato de su dueño.
 * Una venta de mostrador anónima no tiene comprador que mostrar, y la
 * pantalla no finge que lo tiene.
 */
export function LotPanel(): React.JSX.Element {
  const lots = useLots();
  const receipt = useReceipt();
  const [presentationId, setPresentationId] = useState("");
  const [businessDate, setBusinessDate] = useState(today());
  const [lotCode, setLotCode] = useState("");
  const [quantity, setQuantity] = useState("");
  const [manufacturedDate, setManufacturedDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [reasonCode, setReasonCode] = useState("SUPPLIER_DELIVERY");

  const target = presentationId.trim();
  const code = lotCode.trim();
  const busy = lots.busy || receipt.busy;

  return (
    <section data-testid="lot-panel">
      <h2>Lotes y vencimientos</h2>

      <input
        data-testid="lot-presentation-input"
        value={presentationId}
        onChange={(e) => { setPresentationId(e.target.value); }}
        placeholder="ID de presentación"
        disabled={busy}
      />
      <input
        data-testid="lot-business-date-input"
        value={businessDate}
        onChange={(e) => { setBusinessDate(e.target.value); }}
        placeholder="Fecha de negocio"
        disabled={busy}
      />
      <input
        data-testid="lot-code-input"
        value={lotCode}
        onChange={(e) => { setLotCode(e.target.value); }}
        placeholder="Código de lote"
        disabled={busy}
      />

      <h3>Recibir tanda</h3>
      <input
        data-testid="lot-quantity-input"
        value={quantity}
        onChange={(e) => { setQuantity(e.target.value); }}
        placeholder="Cantidad"
        disabled={busy}
      />
      <input
        data-testid="lot-manufactured-input"
        value={manufacturedDate}
        onChange={(e) => { setManufacturedDate(e.target.value); }}
        placeholder="Fabricación (opcional)"
        disabled={busy}
      />
      <input
        data-testid="lot-expiry-input"
        value={expiryDate}
        onChange={(e) => { setExpiryDate(e.target.value); }}
        placeholder="Vencimiento (opcional)"
        disabled={busy}
      />
      <input
        data-testid="lot-reason-input"
        value={reasonCode}
        onChange={(e) => { setReasonCode(e.target.value); }}
        placeholder="Motivo"
        disabled={busy}
      />
      <button
        data-testid="lot-receive-button"
        onClick={() => {
          void lots.receive({
            presentationId: target, lotCode: code, quantity,
            manufacturedDate, expiryDate, reasonCode, businessDate,
          });
        }}
        disabled={busy || target === "" || code === "" || quantity.trim() === ""}
      >
        Recibir lote
      </button>

      {lots.received !== null && (
        <div data-testid="lot-received">
          <span data-testid="lot-received-outcome">{lots.received.outcome}</span>
          {lots.received.lot_quantity_on_hand !== null && (
            <span data-testid="lot-received-quantity">{lots.received.lot_quantity_on_hand}</span>
          )}
        </div>
      )}

      <h3>Qué vence primero</h3>
      <button
        data-testid="lot-list-button"
        onClick={() => { void lots.list(target, businessDate); }}
        disabled={busy || target === ""}
      >
        Ver lotes
      </button>

      {lots.listed !== null && (
        <table data-testid="lot-list">
          <tbody>
            {/* En el orden que da el servicio: FEFO. La pantalla no reordena. */}
            {lots.listed.lots.map((lot) => (
              <tr key={lot.lot_id} data-testid={`lot-row-${lot.lot_code}`}>
                <td>{lot.lot_code}</td>
                <td>{lot.expiry_date ?? "sin vencimiento"}</td>
                <td data-testid={`lot-row-quantity-${lot.lot_code}`}>{lot.quantity_on_hand}</td>
                <td data-testid={`lot-row-expiry-state-${lot.lot_code}`}>{lot.expiry_state}</td>
                <td>{lot.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>Rastro</h3>
      <button
        data-testid="lot-trace-button"
        onClick={() => { void lots.traceLot(target, code); }}
        disabled={busy || target === "" || code === ""}
      >
        Rastrear lote
      </button>

      {lots.trace !== null && lots.trace.outcome !== "FOUND" && (
        <div data-testid="lot-trace-outcome">{lots.trace.outcome}</div>
      )}
      {lots.trace !== null && lots.trace.lot !== null && (
        <div data-testid="lot-trace">
          <div>
            Recibido <span data-testid="lot-trace-received">{lots.trace.quantity_received}</span>
            {" · queda "}
            <span data-testid="lot-trace-on-hand">{lots.trace.lot.quantity_on_hand}</span>
          </div>
          {/* Un rastro cortado se dice: si no, un retiro dejaría ventas fuera sin saberlo. */}
          {lots.trace.truncated && (
            <div data-testid="lot-trace-truncated">Hay más salidas de las que se muestran</div>
          )}
          <table>
            <tbody>
              {lots.trace.outflows.map((outflow, index) => (
                <tr key={`${outflow.occurred_at}-${String(index)}`} data-testid="lot-trace-outflow">
                  <td data-testid="lot-trace-outflow-type">
                    {OUTFLOW_LABEL[outflow.movement_type] ?? outflow.movement_type}
                  </td>
                  <td data-testid="lot-trace-outflow-quantity">{outflow.quantity}</td>
                  <td>{outflow.business_date}</td>
                  <td>{outflow.reason_code}</td>
                  <td>
                    {outflow.sale_id !== null && (
                      <button
                        data-testid="lot-trace-open-sale"
                        onClick={() => { void receipt.load(outflow.sale_id ?? ""); }}
                        disabled={busy}
                      >
                        Ver venta
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {receipt.receipt !== null && (
        <div data-testid="lot-trace-sale">
          <span data-testid="lot-trace-sale-document">
            {receipt.receipt.document_series}-{String(receipt.receipt.sale_number)}
          </span>
          {" · "}
          <span>{receipt.receipt.business_date}</span>
        </div>
      )}
      {receipt.outcome !== null && receipt.outcome !== "FOUND" && (
        <div data-testid="lot-trace-sale-outcome">{receipt.outcome}</div>
      )}

      {(lots.error ?? receipt.error) !== null && (
        <div data-testid="lot-error">{lots.error ?? receipt.error}</div>
      )}
    </section>
  );
}
