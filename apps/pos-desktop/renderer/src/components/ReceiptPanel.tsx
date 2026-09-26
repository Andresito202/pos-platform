import { useState } from "react";
import { useReceipt, type PrintOutcome } from "../hooks/useReceipt.js";

/**
 * Qué hacer con cada desenlace de la impresora (`D-46`). Lo importante es la
 * diferencia entre «no salió nada, vuelva a intentarlo» y «pudo salir a
 * medias, mire la impresora antes de pedir otro».
 */
const PRINT_MESSAGES: Record<PrintOutcome, string> = {
  PRINTED: "Recibo enviado a la impresora.",
  PRINT_FAILED: "La impresora no imprimió. Revise papel y tapa, y vuelva a intentarlo.",
  PRINT_REJECTED: "La impresora respondió algo que no se entiende. Avise a soporte; reintentar no lo arregla.",
  PRINT_UNCERTAIN: "No se sabe si el recibo salió. Mire la impresora antes de pedir otro: el siguiente saldrá como reimpresión.",
  IN_PROGRESS: "Ese recibo se está imprimiendo ahora mismo.",
  NOT_CONFIGURED: "Este equipo no tiene impresora configurada.",
  NOT_FOUND: "Esa venta no existe en esta caja.",
  NOT_COMPLETED: "La venta todavía no está cobrada.",
  IDEMPOTENCY_CONFLICT: "Petición repetida con datos distintos. Vuelva a intentarlo.",
  UNAUTHORIZED: "No tiene permiso para imprimir recibos.",
};

/**
 * El recibo en pantalla — `DEC-019`.
 *
 * Lo que el cajero necesita ver de una venta ya cobrada, y sólo eso. Toma el
 * identificador de la venta porque así es como se pide una reimpresión: el
 * cliente vuelve con una duda y el cajero tiene que poder recuperarla.
 *
 * **Nada de lo que se pinta aquí se calcula aquí.** Todas las cifras llegan
 * congeladas desde la venta, por `sales.receipt.get`.
 *
 * **No hay cabecera fiscal, ni CUFE, ni QR.** No falta maquetarlos: no existen.
 * El contrato ni siquiera admite esos campos, para que nadie los rellene con un
 * valor inventado mientras no haya identidad de compañía en local ni consumidor
 * del adapter fiscal.
 */
export function ReceiptPanel(): React.JSX.Element {
  const receipt = useReceipt();
  const [saleId, setSaleId] = useState("");

  return (
    <section className="card" data-testid="receipt-panel">
      <h2>Recibo</h2>
      <input
        data-testid="receipt-sale-id-input"
        value={saleId}
        onChange={(e) => { setSaleId(e.target.value); }}
        placeholder="ID de la venta"
        disabled={receipt.busy}
      />
      <button
        data-testid="receipt-load-button"
        onClick={() => { void receipt.load(saleId.trim()); }}
        disabled={receipt.busy || saleId.trim() === ""}
      >
        Ver recibo
      </button>

      {/* Los dos desenlaces que no son un recibo se muestran por separado: cada
          uno pide una reacción distinta del cajero. */}
      {receipt.outcome === "NOT_FOUND" && (
        <div data-testid="receipt-not-found">
          Esa venta no existe en esta caja.
        </div>
      )}
      {receipt.outcome === "NOT_COMPLETED" && (
        <div data-testid="receipt-not-completed">
          La venta existe pero todavía no está cobrada.
        </div>
      )}
      {receipt.outcome === "UNAUTHORIZED" && (
        <div data-testid="receipt-unauthorized">
          No tiene permiso para consultar recibos.
        </div>
      )}
      {receipt.error !== null && <div data-testid="receipt-error">{receipt.error}</div>}

      {receipt.receipt !== null && (
        <div data-testid="receipt">
          <button
            data-testid="receipt-print-button"
            onClick={() => { void receipt.printReceipt(receipt.receipt!.sale_id!); }}
            disabled={receipt.busy}
          >
            Imprimir recibo
          </button>
          {receipt.print !== null && (
            <div data-testid="receipt-print-outcome" data-outcome={receipt.print.outcome}>
              {PRINT_MESSAGES[receipt.print.outcome]}
              {receipt.print.copy === "REPRINT" && receipt.print.outcome === "PRINTED" && " (copia marcada como reimpresión)"}
              {receipt.print.diagnostic_code !== null && (
                <> · <span data-testid="receipt-print-diagnostic">{receipt.print.diagnostic_code}</span></>
              )}
            </div>
          )}
          <div>
            Venta <span data-testid="receipt-sale-id">{receipt.receipt.sale_id}</span>
            {" · "}
            <span data-testid="receipt-document">
              {receipt.receipt.document_series}-{receipt.receipt.sale_number}
            </span>
          </div>
          <div>
            Fecha <span data-testid="receipt-business-date">{receipt.receipt.business_date}</span>
            {" · cobrada "}
            <span data-testid="receipt-completed-at">{receipt.receipt.completed_at}</span>
          </div>

          <ul data-testid="receipt-lines">
            {(receipt.receipt.lines ?? []).map((line) => (
              <li key={line.line_number} data-testid="receipt-line">
                <span data-testid="receipt-line-name">{line.product_name}</span>
                {" · "}
                <span data-testid="receipt-line-presentation">{line.presentation_name}</span>
                {" · "}
                <span data-testid="receipt-line-quantity">{line.quantity}</span>
                {" "}{line.unit_code}{" × "}
                <span data-testid="receipt-line-unit-price">{line.unit_price_amount}</span>
                {" = "}
                <span data-testid="receipt-line-total">{line.line_total_amount}</span>
              </li>
            ))}
          </ul>

          <div>
            Subtotal <span data-testid="receipt-subtotal">{receipt.receipt.subtotal_amount}</span>
            {" · descuento "}
            <span data-testid="receipt-discount">{receipt.receipt.discount_amount}</span>
            {" · impuesto "}
            <span data-testid="receipt-tax">{receipt.receipt.tax_amount}</span>
          </div>
          <div>
            {/* El ajuste de redondeo se muestra en vez de absorberse: es la
                diferencia entre lo que suman las líneas y lo que se cobró. */}
            Redondeo{" "}
            <span data-testid="receipt-rounding">
              {receipt.receipt.commercial_rounding_adjustment}
            </span>
          </div>
          <div>
            Total pagado{" "}
            <strong data-testid="receipt-payable">{receipt.receipt.payable_amount}</strong>
            {" "}<span data-testid="receipt-currency">{receipt.receipt.currency_code}</span>
          </div>

          <ul data-testid="receipt-payments">
            {(receipt.receipt.payments ?? []).map((payment, index) => (
              <li key={`${payment.payment_method}-${String(index)}`} data-testid="receipt-payment">
                <span data-testid="receipt-payment-method">{payment.payment_method}</span>
                {" "}
                <span data-testid="receipt-payment-amount">{payment.confirmed_amount}</span>
                {payment.change_amount !== null && (
                  <> · cambio <span data-testid="receipt-payment-change">{payment.change_amount}</span></>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
