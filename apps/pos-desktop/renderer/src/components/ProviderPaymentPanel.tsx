import { useState } from "react";
import { useProviderPayment } from "../hooks/useProviderPayment.js";

/**
 * Cobro por QR y cancelación de un pago abandonado.
 *
 * Las dos operaciones viven juntas porque son el mismo problema operativo: un
 * QR que nadie paga deja la venta con un componente pendiente, y alguien tiene
 * que poder soltarlo. Hasta este bloque ninguna de las dos tenía pantalla
 * aunque el puente las ruteaba.
 *
 * **Sin adquiriente configurado el panel sigue sirviendo.** El servicio
 * responde `PROVIDER_NOT_CONFIGURED`, que es el estado real de una instalación
 * sin proveedor y se muestra como tal. Ocultar el botón convertiría esa
 * respuesta en «la operación no existe», peor diagnóstico para quien monta el
 * equipo.
 */
export function ProviderPaymentPanel(): React.JSX.Element {
  const provider = useProviderPayment();
  const [saleId, setSaleId] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentId, setPaymentId] = useState("");

  const version = provider.payment?.version ?? null;

  return (
    <section className="card" data-testid="provider-payment-panel">
      <h2>Cobro por QR</h2>
      <input
        data-testid="qr-sale-id-input"
        value={saleId}
        onChange={(e) => { setSaleId(e.target.value); }}
        placeholder="ID de la venta"
        disabled={provider.busy}
      />
      <input
        data-testid="qr-amount-input"
        value={amount}
        onChange={(e) => { setAmount(e.target.value); }}
        placeholder="Importe"
        disabled={provider.busy}
      />
      <button
        data-testid="charge-qr-button"
        onClick={() => { void provider.chargeWithQr(saleId.trim(), amount.trim()); }}
        disabled={provider.busy || saleId.trim() === "" || amount.trim() === ""}
      >
        Cobrar con QR
      </button>

      {provider.qr !== null && provider.qr.outcome === "PENDING" && (
        // **Pendiente no es cobrado.** El dinero lo confirma el proveedor por
        // otra vía; declararlo aquí sería dar por buena una imagen.
        <div data-testid="qr-pending">
          Pendiente de pago · pago{" "}
          <span data-testid="qr-payment-id">{provider.qr.payment_id}</span>
          {" · referencia "}
          <span data-testid="qr-provider-reference">{provider.qr.provider_reference}</span>
          {provider.qr.checkout_url !== null && (
            <span data-testid="qr-checkout-url">{provider.qr.checkout_url}</span>
          )}
        </div>
      )}

      {provider.qr !== null && provider.qr.outcome === "PROVIDER_NOT_CONFIGURED" && (
        <div data-testid="qr-provider-not-configured">
          Este equipo no tiene adquiriente configurado: no puede cobrar por QR.
        </div>
      )}

      {provider.qr !== null
        && provider.qr.outcome !== "PENDING"
        && provider.qr.outcome !== "PROVIDER_NOT_CONFIGURED" && (
        <div data-testid="qr-rejected">{provider.qr.outcome}</div>
      )}

      <h3>Estado del pago</h3>
      <input
        data-testid="payment-id-input"
        value={paymentId}
        onChange={(e) => { setPaymentId(e.target.value); }}
        placeholder="ID del pago"
        disabled={provider.busy}
      />
      <button
        data-testid="read-payment-button"
        onClick={() => { void provider.readPayment(paymentId.trim()); }}
        disabled={provider.busy || paymentId.trim() === ""}
      >
        Consultar
      </button>

      {provider.payment !== null && provider.payment.outcome === "FOUND" && (
        <div data-testid="payment-found">
          <span data-testid="payment-status">{provider.payment.status}</span>
          <span data-testid="payment-method">{provider.payment.method}</span>
          <span data-testid="payment-expected-amount">{provider.payment.expected_amount}</span>
          <span data-testid="payment-confirmed-amount">{provider.payment.confirmed_amount}</span>
          <span data-testid="payment-version">{provider.payment.version}</span>
        </div>
      )}
      {provider.payment !== null && provider.payment.outcome !== "FOUND" && (
        <div data-testid="payment-missing">{provider.payment.outcome}</div>
      )}

      {/* Cancelar exige la versión leída: es control optimista, no un contador
          que la pantalla lleve por su cuenta. Sin lectura previa no hay orden
          que dar, y por eso el botón depende de ella. */}
      <button
        data-testid="cancel-payment-button"
        onClick={() => {
          if (version === null) return;
          void provider.cancelPayment(paymentId.trim(), version);
        }}
        disabled={provider.busy || paymentId.trim() === "" || version === null}
      >
        Cancelar pago
      </button>

      {provider.cancelled !== null
        && (provider.cancelled.outcome === "CANCELLED" || provider.cancelled.outcome === "IDEMPOTENT") && (
        // `IDEMPOTENT` **no** es un rechazo: el servicio lo devuelve cuando el
        // pago ya estaba cancelado (`sqlite-payment-store.ts`), que es el mismo
        // hecho operativo. Pintarlo como fallo haría dudar al cajero de una
        // cancelación que sí ocurrió.
        <div data-testid="payment-cancelled">
          Pago cancelado · <span data-testid="cancelled-payment-id">{provider.cancelled.payment_id}</span>
          {provider.cancelled.outcome === "IDEMPOTENT" && (
            <span data-testid="payment-already-cancelled"> (ya lo estaba)</span>
          )}
        </div>
      )}
      {provider.cancelled !== null && provider.cancelled.outcome === "PAYMENT_NOT_CANCELLABLE" && (
        // No es un fallo: un pago confirmado es inmutable y deshacerlo es una
        // operación compensatoria que V1 no implementa (D-22).
        <div data-testid="payment-not-cancellable">
          Este pago ya no se puede cancelar.
        </div>
      )}
      {provider.cancelled !== null
        && provider.cancelled.outcome !== "CANCELLED"
        && provider.cancelled.outcome !== "IDEMPOTENT"
        && provider.cancelled.outcome !== "PAYMENT_NOT_CANCELLABLE" && (
        <div data-testid="cancel-rejected">{provider.cancelled.outcome}</div>
      )}

      {provider.error !== null && <div data-testid="provider-payment-error">{provider.error}</div>}
    </section>
  );
}
