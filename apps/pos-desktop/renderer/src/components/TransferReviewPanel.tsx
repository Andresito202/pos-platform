import { useState } from "react";
import { CanonicalPermission } from "@pos-platform/contracts";
import { useCommercialSale } from "../hooks/useCommercialSale.js";
import { formatScale6Display } from "../money-display.js";

/** Existing payment operations, without a cart or a second payment implementation. */
export function TransferReviewPanel({ permissions }: { permissions: ReadonlySet<string> }): React.JSX.Element {
  const [reference, setReference] = useState("");
  const payment = useCommercialSale();
  const transfer = payment.transfer;
  const pending = transfer?.status === "CREATED" && transfer.version !== null;
  const locked = payment.busy || payment.unresolved;
  const status = transfer?.status === "CONFIRMED" ? "Confirmada"
    : transfer?.status === "CANCELLED" ? "Cancelada"
    : transfer?.status === "CREATED" ? "Pendiente de revisión" : "Estado no disponible";
  const statusTone = transfer?.status === "CONFIRMED" ? "confirmed"
    : transfer?.status === "CANCELLED" ? "cancelled"
    : transfer?.status === "CREATED" ? "pending" : "unknown";

  return <section className="pos-admin-panel" data-testid="transfer-review-panel">
    <header className="pos-admin-header"><div>
      <span className="pos-admin-eyebrow">SUPERVISIÓN</span>
      <h2>Revisión de transferencias</h2>
      <p>
        Consulta el pago reportado por caja y comprueba el ingreso antes de confirmarlo.
        Esta pantalla no abre el carrito ni permite vender. Un importe reportado no acredita
        dinero recibido.
      </p>
    </div></header>

    <form className="pos-admin-audit-toolbar" onSubmit={event => {
      event.preventDefault();
      if (!locked && permissions.has(CanonicalPermission.PAYMENTS_PAYMENT_READ) && reference.trim()) void payment.loadTransfer(reference.trim());
    }}>
      <label>Referencia del pago<input aria-label="Referencia del pago" value={reference}
        onChange={event => setReference(event.target.value)} disabled={locked} required /></label>
      <button type="submit" disabled={locked || !reference.trim() || !permissions.has(CanonicalPermission.PAYMENTS_PAYMENT_READ)}>Consultar transferencia</button>
    </form>

    {transfer === null && (
      <div className="pos-admin-empty" role="status">
        <span>Sin transferencia cargada.</span>
        <span>Ingresa la referencia del pago reportado por caja para revisarlo.</span>
      </div>
    )}

    {transfer && <div className="pos-admin-surface">
      <div className="pos-admin-grid pos-admin-grid--two">
        <article className="pos-admin-card" data-metric-state="unavailable">
          <span>Importe reportado</span>
          <strong data-amount={transfer.expectedAmount ?? ""}>{formatScale6Display(transfer.expectedAmount)}</strong>
          <small>Este importe no acredita que el dinero haya llegado ni que el pago esté confirmado.</small>
        </article>
        <article className="pos-admin-card" data-transfer-status={statusTone}>
          <span>Estado del pago</span>
          <strong role="status">{status}</strong>
          <small>
            {statusTone === "pending"
              ? "Pendiente de revisión supervisora. No tratar como cobro cerrado."
              : statusTone === "confirmed"
                ? "Ingreso verificado por autorización de transferencia."
                : statusTone === "cancelled"
                  ? "Pago cancelado; no representa dinero recibido."
                  : "Estado no clasificado por el servicio."}
          </small>
        </article>
      </div>
      <p className="pos-payment-reference">Pago <code>{transfer.paymentId}</code></p>
      <div className="pos-admin-audit-actions">
        {permissions.has(CanonicalPermission.PAYMENTS_TRANSFER_CONFIRM) && <button type="button"
          className="pos-primary-action"
          disabled={locked || !pending} onClick={() => void payment.confirmTransfer()}>Confirmar ingreso verificado</button>}
        {permissions.has(CanonicalPermission.PAYMENTS_PAYMENT_CANCEL) && <button type="button"
          className="pos-danger-action"
          disabled={locked || !pending} onClick={() => void payment.cancelTransfer()}>Cancelar pago pendiente</button>}
      </div>
      {payment.transferConfirmation?.sale_completed === true && (
        <p className="pos-result-success" role="status">Venta pagada por completo.</p>
      )}
      {payment.transferConfirmation !== null && payment.transferConfirmation.sale_completed !== true && (
        <p className="pos-result-pending" role="status">
          Transferencia atendida · la venta aún no está cobrada por completo.
        </p>
      )}
    </div>}

    <section className="pos-admin-surface pos-reporting-slots" aria-label="Indicadores de supervisión pendientes">
      <h3>Preparación para Reporting de sucursal</h3>
      <p>Espacios reservados para contratos futuros. Sin cifras simuladas.</p>
      <ul className="pos-reporting-slot-list">
        {[
          "Transferencias pendientes del turno",
          "Pagos confirmados del día",
          "Operaciones que requieren revisión",
          "Diferencias de caja",
          "Actividad de la sucursal autorizada",
        ].map((slot) => (
          <li key={slot} data-metric-state="unavailable">
            <span>{slot}</span>
            <strong>No disponible</strong>
            <small>Reporting no materializado (REP-001).</small>
          </li>
        ))}
      </ul>
    </section>

    {payment.error !== null && <p className="pos-result-pending" role="alert">No se pudo completar la operación: {payment.error}</p>}
    {payment.unresolved && <div className="pos-result-pending" role="alert"><p>La operación sigue pendiente. Reinténtala antes de consultar otro pago.</p>
      <button type="button" disabled={payment.busy} onClick={() => void payment.retryPending()}>Reintentar operación pendiente</button></div>}
  </section>;
}
