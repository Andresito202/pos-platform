import { useState } from "react";
import { useCustomerCredit } from "../hooks/useCustomerCredit.js";

/**
 * Fiado: cuenta, cupo, venta a crédito y abono.
 *
 * Los tres números que deciden —cupo, saldo, disponible— se muestran **tal
 * como los devuelve el servicio**, que los recomputa desde el libro del
 * cliente. La pantalla no los suma ni los deduce: un disponible calculado aquí
 * podría diferir del real justo en el momento en que el cajero decide si fía.
 *
 * Los rechazos se muestran por su nombre y no como «error». `CUSTOMER_REQUIRED`
 * le dice al cajero que asocie un adquiriente a la venta;
 * `CREDIT_LIMIT_EXCEEDED` le dice cuánto quedaba de verdad para que cobre la
 * diferencia en efectivo. Un mensaje genérico obligaría a adivinar las dos.
 */
export function CreditPanel(): React.JSX.Element {
  const credit = useCustomerCredit();
  const [customerId, setCustomerId] = useState("");
  const [creditLimit, setCreditLimit] = useState("");
  const [currencyCode, setCurrencyCode] = useState("COP");
  const [saleId, setSaleId] = useState("");
  const [chargeAmount, setChargeAmount] = useState("");
  const [repaymentAmount, setRepaymentAmount] = useState("");
  const [method, setMethod] = useState<"CASH" | "TRANSFER">("CASH");
  const [cashRegisterId, setCashRegisterId] = useState("");
  const [businessDate, setBusinessDate] = useState("");

  const customerMissing = customerId.trim() === "";
  const repaymentIncomplete = customerMissing
    || repaymentAmount.trim() === ""
    || businessDate.trim() === ""
    // El contrato rechaza un abono en efectivo sin caja; el botón no deja
    // llegar hasta ahí.
    || (method === "CASH" && cashRegisterId.trim() === "");

  return (
    <section className="card" data-testid="credit-panel">
      <h2>Fiado</h2>

      <input
        data-testid="credit-customer-id-input"
        value={customerId}
        onChange={(e) => { setCustomerId(e.target.value); }}
        placeholder="ID del cliente"
        disabled={credit.busy}
      />
      <input
        data-testid="credit-limit-input"
        value={creditLimit}
        onChange={(e) => { setCreditLimit(e.target.value); }}
        placeholder="Cupo, escala 6 (p. ej. 200000.000000)"
        disabled={credit.busy}
      />
      <input
        data-testid="credit-currency-input"
        value={currencyCode}
        onChange={(e) => { setCurrencyCode(e.target.value); }}
        placeholder="Moneda"
        disabled={credit.busy}
      />
      <button
        data-testid="open-credit-account-button"
        onClick={() => {
          void credit.openAccount({
            customerId: customerId.trim(),
            creditLimit: creditLimit.trim(),
            currencyCode: currencyCode.trim(),
          });
        }}
        disabled={credit.busy || customerMissing || creditLimit.trim() === ""}
      >
        Abrir cuenta de crédito
      </button>
      <button
        data-testid="read-credit-account-button"
        onClick={() => { void credit.readAccount(customerId.trim()); }}
        disabled={credit.busy || customerMissing}
      >
        Consultar cupo y saldo
      </button>

      {credit.opened !== null && (
        <div data-testid="credit-opened">
          <span data-testid="credit-opened-outcome">{credit.opened.outcome}</span>
          {credit.opened.account_id !== null && (
            <span data-testid="credit-opened-account-id">{credit.opened.account_id}</span>
          )}
        </div>
      )}

      {credit.account !== null && credit.account.outcome === "FOUND" && (
        <div data-testid="credit-account">
          <span data-testid="credit-account-limit">{credit.account.credit_limit}</span>
          <span data-testid="credit-account-balance">{credit.account.outstanding_balance}</span>
          <span data-testid="credit-account-available">{credit.account.available_credit}</span>
          <span data-testid="credit-account-currency">{credit.account.currency_code}</span>
        </div>
      )}
      {credit.account !== null && credit.account.outcome !== "FOUND" && (
        <div data-testid="credit-account-missing">{credit.account.outcome}</div>
      )}

      <h3>Fiar una venta</h3>
      <input
        data-testid="credit-sale-id-input"
        value={saleId}
        onChange={(e) => { setSaleId(e.target.value); }}
        placeholder="ID de la venta"
        disabled={credit.busy}
      />
      <input
        data-testid="credit-charge-amount-input"
        value={chargeAmount}
        onChange={(e) => { setChargeAmount(e.target.value); }}
        placeholder="Importe a fiar"
        disabled={credit.busy}
      />
      <button
        data-testid="charge-to-credit-button"
        onClick={() => { void credit.chargeToCredit(saleId.trim(), chargeAmount.trim()); }}
        disabled={credit.busy || saleId.trim() === "" || chargeAmount.trim() === ""}
      >
        Fiar
      </button>

      {credit.charged !== null && credit.charged.outcome === "CONFIRMED" && (
        <div data-testid="credit-charged">
          <span data-testid="credit-charged-payment-id">{credit.charged.payment_id}</span>
          <span data-testid="credit-charged-completed">
            {credit.charged.sale_completed === true ? "COMPLETED" : "PARTIAL"}
          </span>
        </div>
      )}
      {credit.charged !== null && credit.charged.outcome === "CREDIT_LIMIT_EXCEEDED" && (
        // Rechazo duro y sin override. Se muestra lo único accionable: cuánto
        // quedaba, para cobrar la diferencia por otro medio.
        <div data-testid="credit-limit-exceeded">
          <span data-testid="credit-limit-exceeded-available">{credit.charged.available_credit}</span>
        </div>
      )}
      {credit.charged !== null
        && credit.charged.outcome !== "CONFIRMED"
        && credit.charged.outcome !== "CREDIT_LIMIT_EXCEEDED" && (
        <div data-testid="credit-charge-rejected">{credit.charged.outcome}</div>
      )}

      <h3>Abono</h3>
      <input
        data-testid="credit-repayment-amount-input"
        value={repaymentAmount}
        onChange={(e) => { setRepaymentAmount(e.target.value); }}
        placeholder="Importe del abono"
        disabled={credit.busy}
      />
      <select
        data-testid="credit-repayment-method-select"
        value={method}
        onChange={(e) => { setMethod(e.target.value === "TRANSFER" ? "TRANSFER" : "CASH"); }}
        disabled={credit.busy}
      >
        <option value="CASH">Efectivo</option>
        <option value="TRANSFER">Transferencia</option>
      </select>
      <input
        data-testid="credit-repayment-register-input"
        value={cashRegisterId}
        onChange={(e) => { setCashRegisterId(e.target.value); }}
        placeholder="Caja donde entra el efectivo"
        disabled={credit.busy || method === "TRANSFER"}
      />
      <input
        data-testid="credit-repayment-date-input"
        value={businessDate}
        onChange={(e) => { setBusinessDate(e.target.value); }}
        placeholder="Fecha de negocio (AAAA-MM-DD)"
        disabled={credit.busy}
      />
      <button
        data-testid="register-repayment-button"
        onClick={() => {
          void credit.registerRepayment({
            customerId: customerId.trim(),
            amount: repaymentAmount.trim(),
            currencyCode: currencyCode.trim(),
            method,
            cashRegisterId: cashRegisterId.trim(),
            businessDate: businessDate.trim(),
          });
        }}
        disabled={credit.busy || repaymentIncomplete}
      >
        Registrar abono
      </button>

      {credit.repaid !== null && credit.repaid.outcome === "RECORDED" && (
        <div data-testid="credit-repaid">
          <span data-testid="credit-repaid-transaction-id">{credit.repaid.transaction_id}</span>
          <span data-testid="credit-repaid-balance">{credit.repaid.outstanding_balance}</span>
          <span data-testid="credit-repaid-available">{credit.repaid.available_credit}</span>
        </div>
      )}
      {credit.repaid !== null && credit.repaid.outcome !== "RECORDED" && (
        <div data-testid="credit-repayment-rejected">{credit.repaid.outcome}</div>
      )}

      {credit.error !== null && <div data-testid="credit-error">{credit.error}</div>}
    </section>
  );
}
