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
  const status = transfer?.status === "CONFIRMED" ? "Pago confirmado"
    : transfer?.status === "CANCELLED" ? "Pago cancelado"
    : transfer?.status === "CREATED" ? "Pendiente de revisión" : "Operación no disponible";
  const statusTone = transfer?.status === "CONFIRMED" ? "confirmed"
    : transfer?.status === "CANCELLED" ? "cancelled"
    : transfer?.status === "CREATED" ? "pending" : "unknown";

  return <section className="pos-admin-panel" data-testid="transfer-review-panel">
    <header className="pos-admin-header"><div>
      <span className="pos-admin-eyebrow">SUPERVISIÓN</span>
      <h2>Revisión de transferencias</h2>
      <p>Consulta un pago reportado por caja y confirma el ingreso solo cuando lo hayas verificado.</p>
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
        <span>Ingresa la referencia del pago para revisarlo.</span>
      </div>
    )}

    {transfer && <div className="pos-admin-surface">
      <div className="pos-admin-grid pos-admin-grid--two">
        <article className="pos-admin-card" data-metric-state="unavailable">
          <span>Importe reportado</span>
          <strong data-amount={transfer.expectedAmount ?? ""}>{formatScale6Display(transfer.expectedAmount)}</strong>
          <small>Monto informado por caja. Todavía no confirma que el dinero haya llegado.</small>
        </article>
        <article className="pos-admin-card" data-transfer-status={statusTone}>
          <span>Estado del pago</span>
          <strong role="status">{status}</strong>
          <small>
            {statusTone === "pending"
              ? "Espera tu revisión antes de darlo por recibido."
              : statusTone === "confirmed"
                ? "El ingreso quedó verificado."
                : statusTone === "cancelled"
                  ? "Este pago fue cancelado."
                  : "No fue posible determinar el estado."}
          </small>
        </article>
      </div>
      <p className="pos-payment-reference">Referencia: {transfer.paymentId}</p>
      <div className="pos-admin-audit-actions">
        {permissions.has(CanonicalPermission.PAYMENTS_TRANSFER_CONFIRM) && <button type="button"
          className="pos-primary-action"
          disabled={locked || !pending} onClick={() => void payment.confirmTransfer()}>Aprobar transferencia manualmente</button>}
        {permissions.has(CanonicalPermission.PAYMENTS_PAYMENT_CANCEL) && <button type="button"
          className="pos-danger-action"
          disabled={locked || !pending} onClick={() => void payment.cancelTransfer()}>Cancelar pago pendiente</button>}
      </div>
      {payment.transferConfirmation?.sale_completed === true && (
        <p className="pos-result-success" role="status">Venta pagada por completo.</p>
      )}
      {payment.transferConfirmation !== null && payment.transferConfirmation.sale_completed !== true && (
        <p className="pos-result-pending" role="status">
          La transferencia se registró, pero la venta aún no está cobrada por completo.
        </p>
      )}
    </div>}

    <section className="pos-admin-surface pos-reporting-slots" aria-label="Indicadores próximos">
      <h3>Próximos indicadores</h3>
      <p>Estas consultas se habilitarán cuando estén disponibles para tu sucursal.</p>
      <ul className="pos-reporting-slot-list">
        {[
          "Transferencias pendientes del turno",
          "Pagos confirmados del día",
          "Operaciones por revisar",
          "Diferencias de caja",
          "Actividad de la sucursal",
        ].map((slot) => (
          <li key={slot} data-metric-state="unavailable">
            <span>{slot}</span>
            <strong>Información no disponible</strong>
            <small>Aún no se puede consultar.</small>
          </li>
        ))}
      </ul>
    </section>

    {payment.error !== null && <p className="pos-result-pending" role="alert">No fue posible completar la operación: {payment.error}</p>}
    {payment.unresolved && <div className="pos-result-pending" role="alert"><p>La operación sigue pendiente. Reinténtala antes de consultar otro pago.</p>
      <button type="button" disabled={payment.busy} onClick={() => void payment.retryPending()}>Reintentar operación pendiente</button></div>}
  </section>;
}
