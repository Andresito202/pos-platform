import { useState } from "react";
import { useFiscalIssuance, type FiscalCustomerChoice } from "../hooks/useFiscalIssuance.js";

/**
 * Emisión fiscal de una venta ya cobrada — `DEC-021` F5.
 *
 * ## Por qué el adquiriente se elige, y no se teclea aquí
 *
 * El panel ofrece dos caminos —un adquiriente ya registrado por su id, o la
 * ausencia declarada con su motivo— y ninguno permite escribir los campos
 * fiscales del tercero. Eso es de `CustomerPanel`, que ya los valida contra las
 * tablas DIAN antes de guardarlos. Dejar teclearlos también aquí crearía un
 * segundo adquiriente que nadie validó, y el que acabaría en la factura sería
 * ése.
 *
 * ## Por qué el motivo del bloqueo se muestra tal cual
 *
 * Hoy, una venta de mostrador anónima **no se puede facturar**: `D-13`, el
 * tercero genérico de la DIAN no está verificado en este repositorio. El panel
 * no lo esconde ni lo traduce a «error»: muestra `GENERIC_ACQUIRER_NOT_VERIFIED`
 * con su ruta, porque es la diferencia entre «el sistema falló» y «esta venta
 * necesita un adquiriente identificado».
 */
export function FiscalPanel(): React.JSX.Element {
  const fiscal = useFiscalIssuance();
  const [saleId, setSaleId] = useState("");
  const [customerId, setCustomerId] = useState("");
  // La última petición, tal cual se envió: confirmar la diferencia de
  // adquiriente reenvía **esa**, no lo que haya en los campos ahora.
  const [lastRequest, setLastRequest] = useState<{
    readonly saleId: string; readonly customer: FiscalCustomerChoice;
  } | null>(null);

  const issued = fiscal.issued;
  const send = (sale: string, customer: FiscalCustomerChoice): void => {
    setLastRequest({ saleId: sale, customer });
    void fiscal.issue(sale, "SALES_INVOICE", customer);
  };
  const mismatch = issued !== null && issued.block_code === "CUSTOMER_MISMATCH"
    ? issued.customer_mismatch
    : null;

  return (
    <section className="card" data-testid="fiscal-panel">
      <h2>Emisión fiscal</h2>

      <input
        data-testid="fiscal-sale-id-input"
        value={saleId}
        onChange={(e) => { setSaleId(e.target.value); }}
        placeholder="ID de la venta cobrada"
        disabled={fiscal.busy}
      />
      <input
        data-testid="fiscal-customer-id-input"
        value={customerId}
        onChange={(e) => { setCustomerId(e.target.value); }}
        placeholder="ID del adquiriente registrado"
        disabled={fiscal.busy}
      />

      <button
        data-testid="issue-identified-button"
        onClick={() => {
          send(saleId.trim(), { kind: "IDENTIFIED", customerId: customerId.trim() });
        }}
        disabled={fiscal.busy || saleId.trim() === "" || customerId.trim() === ""}
      >
        Emitir con adquiriente
      </button>

      {/* Venta de mostrador sin identificar. Se ofrece porque es el caso
          mayoritario de un POS y el operador tiene que poder intentarlo y ver
          por qué no se puede, en vez de suponer que el botón no existe. */}
      <button
        data-testid="issue-anonymous-button"
        onClick={() => {
          send(saleId.trim(), { kind: "NOT_IDENTIFIED", reason: "ANONYMOUS_COUNTER_SALE" });
        }}
        disabled={fiscal.busy || saleId.trim() === ""}
      >
        Emitir sin identificar
      </button>

      {issued !== null && (issued.outcome === "ISSUED" || issued.outcome === "ALREADY_ISSUED") && (
        <div data-testid="fiscal-issued">
          <span data-testid="fiscal-issued-outcome">{issued.outcome}</span>
          <span data-testid="fiscal-issued-cufe">{issued.cufe}</span>
          <span data-testid="fiscal-issued-number">{issued.issued_number}</span>
        </div>
      )}

      {/* `D-40`, «advertir»: la factura no nombra al cliente que nombró la
          venta. Se dicen los dos y se pide confirmar; nada se emitió todavía.
          Puede ser legítimo —la factura a nombre de la empresa del cliente—, y
          quien lo sabe es el operador. */}
      {mismatch !== null && lastRequest !== null && (
        <div data-testid="fiscal-customer-mismatch">
          La venta nombró a{" "}
          <span data-testid="fiscal-mismatch-sale-customer">
            {mismatch.sale_customer_id ?? "ningún cliente (venta de mostrador)"}
          </span>
          {" "}y la factura va a{" "}
          <span data-testid="fiscal-mismatch-requested-customer">
            {mismatch.requested_customer_id ?? "consumidor sin identificar"}
          </span>
          .{" "}
          <button
            data-testid="fiscal-confirm-mismatch-button"
            onClick={() => {
              void fiscal.issue(lastRequest.saleId, "SALES_INVOICE", lastRequest.customer, true);
            }}
            disabled={fiscal.busy}
          >
            Emitir de todos modos
          </button>
        </div>
      )}

      {issued !== null && issued.outcome === "BLOCKED" && mismatch === null && (
        <div data-testid="fiscal-blocked">
          <span data-testid="fiscal-blocked-code">{issued.block_code}</span>
          {issued.reasons.map((reason, index) => (
            <span key={`${String(index)}`} data-testid="fiscal-blocked-reason">
              {JSON.stringify(reason)}
            </span>
          ))}
        </div>
      )}

      {/*
        Los tres desenlaces que no son ni éxito ni bloqueo previo. `UNCERTAIN` y
        `REQUIRES_RECONCILIATION` se nombran aparte a propósito: el documento
        **pudo haberse emitido** y volver a intentarlo duplicaría la factura ante
        la DIAN. La pantalla no ofrece un botón de reintento para ellos.
      */}
      {issued !== null && (
        issued.outcome === "UNCERTAIN"
        || issued.outcome === "REQUIRES_RECONCILIATION"
      ) && (
        <div data-testid="fiscal-uncertain">
          <span data-testid="fiscal-uncertain-outcome">{issued.outcome}</span>
          <span data-testid="fiscal-uncertain-status">{issued.transport_status}</span>
        </div>
      )}

      {issued !== null && (issued.outcome === "TRANSPORT_FAILED" || issued.outcome === "NOT_ELIGIBLE") && (
        <div data-testid="fiscal-retriable">
          <span data-testid="fiscal-retriable-outcome">{issued.outcome}</span>
        </div>
      )}

      {fiscal.error !== null && <div data-testid="fiscal-error">{fiscal.error}</div>}
    </section>
  );
}
