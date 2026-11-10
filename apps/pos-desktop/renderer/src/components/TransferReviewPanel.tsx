import { useState } from "react";
import { CanonicalPermission } from "@pos-platform/contracts";
import { useCommercialSale } from "../hooks/useCommercialSale.js";
import { formatScale6Display } from "../money-display.js";

/** Existing payment operations, without a cart or a second payment implementation. */
export function TransferReviewPanel({ permissions }: { permissions: ReadonlySet<string> }): React.JSX.Element {
  const [reference, setReference] = useState("");
  const payment = useCommercialSale({ canReadCatalog: false,
    canReadPayment: permissions.has(CanonicalPermission.PAYMENTS_PAYMENT_READ) });
  const transfer = payment.transfer;
  const pending = transfer?.status === "CREATED" && transfer.version !== null;
  const locked = payment.busy || payment.unresolved;
  const status = transfer?.status === "CONFIRMED" ? "Confirmada"
    : transfer?.status === "CANCELLED" ? "Cancelada"
    : transfer?.status === "CREATED" ? "Pendiente de revisión" : "Estado no disponible";

  return <section className="pos-admin-panel" data-testid="transfer-review-panel">
    <header className="pos-admin-header"><div>
      <h2>Revisión de transferencias</h2>
      <p>Consulta el pago reportado por caja y comprueba el ingreso antes de confirmarlo.</p>
    </div></header>
    <form className="pos-admin-audit-toolbar" onSubmit={event => {
      event.preventDefault();
      if (!locked && reference.trim()) void payment.loadTransfer(reference.trim());
    }}>
      <label>Referencia del pago<input aria-label="Referencia del pago" value={reference}
        onChange={event => setReference(event.target.value)} disabled={locked} required /></label>
      <button type="submit" disabled={locked || !reference.trim() || !permissions.has(CanonicalPermission.PAYMENTS_PAYMENT_READ)}>Consultar transferencia</button>
    </form>
    {transfer && <div className="pos-admin-surface">
      <div className="pos-admin-grid">
        <article className="pos-admin-card"><span>Importe reportado</span>
          <strong data-amount={transfer.expectedAmount ?? ""}>{formatScale6Display(transfer.expectedAmount)}</strong>
          <small>Este importe no acredita que el dinero haya llegado.</small></article>
        <article className="pos-admin-card"><span>Estado</span><strong role="status">{status}</strong></article>
      </div>
      <div className="pos-admin-audit-actions">
        {permissions.has(CanonicalPermission.PAYMENTS_TRANSFER_CONFIRM) && <button type="button"
          disabled={locked || !pending} onClick={() => void payment.confirmTransfer()}>Confirmar ingreso verificado</button>}
        {permissions.has(CanonicalPermission.PAYMENTS_PAYMENT_CANCEL) && <button type="button"
          disabled={locked || !pending} onClick={() => void payment.cancelTransfer()}>Cancelar pago pendiente</button>}
      </div>
      {payment.transferConfirmation?.sale_completed === true && <p role="status">Venta pagada por completo.</p>}
    </div>}
    {payment.error !== null && <p role="alert">No se pudo completar la operación: {payment.error}</p>}
    {payment.unresolved && <div role="alert"><p>La operación sigue pendiente. Reinténtala antes de consultar otro pago.</p>
      <button type="button" disabled={payment.busy} onClick={() => void payment.retryPending()}>Reintentar operación pendiente</button></div>}
  </section>;
}
