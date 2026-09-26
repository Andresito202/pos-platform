import { useState } from "react";
import { useLots } from "../hooks/useLots.js";
import { useReceipt } from "../hooks/useReceipt.js";
import { useCustomerDirectory } from "../hooks/useCustomerDirectory.js";
import { useLotBuyers } from "../hooks/useLotBuyers.js";

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
 * El rastro devuelve la venta; el recibo, el cliente que la venta nombró; y
 * `customer.get`, su nombre y contacto. Cada salto lo da el contrato de su
 * dueño. Una venta de mostrador no tiene comprador que mostrar, y la pantalla
 * lo dice en vez de dejar el hueco.
 */
export function LotPanel(): React.JSX.Element {
  const lots = useLots();
  const receipt = useReceipt();
  const buyer = useCustomerDirectory();
  const buyers = useLotBuyers();
  const [presentationId, setPresentationId] = useState("");
  const [businessDate, setBusinessDate] = useState(today());
  const [lotCode, setLotCode] = useState("");
  const [quantity, setQuantity] = useState("");
  const [manufacturedDate, setManufacturedDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [reasonCode, setReasonCode] = useState("SUPPLIER_DELIVERY");

  const target = presentationId.trim();
  const code = lotCode.trim();
  const busy = lots.busy || receipt.busy || buyer.busy || buyers.busy;
  const saleIds = (lots.trace?.outflows ?? [])
    .map((outflow) => outflow.sale_id)
    .filter((id): id is string => id !== null);
  const derived = lots.trace?.derived_lots ?? [];

  // Saltar a otro lote del rastro —la paca de origen o un lote de unidades—
  // deja los campos con lo que se está mirando, para no rastrear una cosa
  // mostrando otra.
  const follow = (nextPresentation: string, nextCode: string): void => {
    setPresentationId(nextPresentation);
    setLotCode(nextCode);
    void lots.traceLot(nextPresentation, nextCode);
  };
  // El comprador se muestra sólo si es el de la venta abierta: abrir otra
  // venta no puede dejar a la vista el comprador de la anterior.
  const shownBuyer = buyer.found !== null
    && receipt.receipt !== null
    && buyer.found.customer_id === receipt.receipt.customer_id
    ? buyer.found
    : null;

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
          {/* De dónde viene: las unidades de una paca abierta llevan su tanda. */}
          {lots.trace.origin_lot !== null && (
            <div data-testid="lot-trace-origin">
              Viene de abrir{" "}
              <span data-testid="lot-trace-origin-code">{lots.trace.origin_lot.lot_code}</span>
              {" "}
              <button
                data-testid="lot-trace-follow-origin"
                onClick={() => {
                  if (lots.trace?.origin_lot) {
                    follow(lots.trace.origin_lot.presentation_id, lots.trace.origin_lot.lot_code);
                  }
                }}
                disabled={busy}
              >
                Rastrear origen
              </button>
            </div>
          )}
          {/* Adónde fue al abrirse: las ventas sueltas están en esos lotes. */}
          {derived.length > 0 && (
            <ul data-testid="lot-trace-derived">
              {derived.map((lot) => (
                <li key={`${lot.presentation_id}/${lot.lot_code}`} data-testid="lot-trace-derived-lot">
                  Abierto en unidades · queda{" "}
                  <span data-testid="lot-trace-derived-quantity">{lot.quantity_on_hand}</span>
                  {" "}
                  <button
                    data-testid="lot-trace-follow-derived"
                    onClick={() => { follow(lot.presentation_id, lot.lot_code); }}
                    disabled={busy}
                  >
                    Rastrear unidades
                  </button>
                </li>
              ))}
            </ul>
          )}
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
          {receipt.receipt.customer_id === null ? (
            <div data-testid="lot-trace-sale-anonymous">Venta de mostrador, sin comprador identificado</div>
          ) : (
            <button
              data-testid="lot-trace-sale-customer"
              onClick={() => { void buyer.get(receipt.receipt?.customer_id ?? ""); }}
              disabled={busy}
            >
              Ver comprador
            </button>
          )}
        </div>
      )}
      {shownBuyer !== null && (
        <div data-testid="lot-trace-buyer">
          <span data-testid="lot-trace-buyer-name">{shownBuyer.names ?? shownBuyer.company}</span>
          {" · "}
          <span data-testid="lot-trace-buyer-identification">{shownBuyer.identification}</span>
          {" · "}
          <span data-testid="lot-trace-buyer-phone">{shownBuyer.phone ?? "sin teléfono"}</span>
          {" · "}
          <span data-testid="lot-trace-buyer-email">{shownBuyer.email ?? "sin correo"}</span>
        </div>
      )}
      {buyer.found !== null && buyer.found.outcome !== "FOUND" && (
        <div data-testid="lot-trace-buyer-outcome">{buyer.found.outcome}</div>
      )}

      {/* La lista de un retiro: todos los compradores identificados de la
          tanda, las ventas anónimas contadas aparte y lo que no se pudo leer
          con su código. Nada se descarta en silencio. */}
      {lots.trace !== null && lots.trace.outcome === "FOUND"
        && (saleIds.length > 0 || derived.length > 0) && (
        <button
          data-testid="lot-buyers-button"
          onClick={() => { if (lots.trace) void buyers.collect(lots.trace); }}
          disabled={busy}
        >
          Compradores del lote
        </button>
      )}
      {buyers.buyers !== null && (
        <div data-testid="lot-buyers">
          <table>
            <tbody>
              {buyers.buyers.map((entry) => (
                <tr key={entry.customer.customer_id ?? ""} data-testid="lot-buyer">
                  <td data-testid="lot-buyer-name">{entry.customer.names ?? entry.customer.company}</td>
                  <td>{entry.customer.identification}</td>
                  <td data-testid="lot-buyer-phone">{entry.customer.phone ?? "sin teléfono"}</td>
                  <td>{entry.customer.email ?? "sin correo"}</td>
                  <td data-testid="lot-buyer-sales">{String(entry.saleIds.length)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div>
            Ventas de mostrador sin comprador:{" "}
            <span data-testid="lot-buyers-anonymous">{String(buyers.anonymousSales)}</span>
          </div>
          {buyers.derivedLots > 0 && (
            <div>
              Incluye las ventas de{" "}
              <span data-testid="lot-buyers-derived">{String(buyers.derivedLots)}</span>
              {" "}lote(s) de unidades abiertas de esta tanda
            </div>
          )}
          {buyers.truncated && (
            <div data-testid="lot-buyers-truncated">
              Algún rastro venía cortado: esta lista puede no estar completa
            </div>
          )}
          {buyers.failures.length > 0 && (
            <ul data-testid="lot-buyers-failures">
              {buyers.failures.map((failure) => (
                <li key={failure.subject} data-testid="lot-buyers-failure">
                  {failure.subject}: {failure.code}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {receipt.outcome !== null && receipt.outcome !== "FOUND" && (
        <div data-testid="lot-trace-sale-outcome">{receipt.outcome}</div>
      )}

      {(lots.error ?? receipt.error ?? buyer.error) !== null && (
        <div data-testid="lot-error">{lots.error ?? receipt.error ?? buyer.error}</div>
      )}
    </section>
  );
}
