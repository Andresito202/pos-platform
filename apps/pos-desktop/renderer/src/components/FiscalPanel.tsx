import { useEffect, useState } from "react";
import { useFiscalIssuance } from "../hooks/useFiscalIssuance.js";

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
export function FiscalPanel({ initialSaleId = null }: { initialSaleId?: string | null }): React.JSX.Element {
  const fiscal = useFiscalIssuance();
  const [saleId, setSaleId] = useState("");
  useEffect(() => { if (initialSaleId !== null) setSaleId(initialSaleId); }, [initialSaleId]);
  const [customerId, setCustomerId] = useState("");

  const issued = fiscal.resultSaleId === saleId.trim() ? fiscal.issued : null;
  const blocked = fiscal.isBlocked(saleId.trim(), "SALES_INVOICE");

  return (
    <section data-testid="fiscal-panel">
      <h2>Emisión fiscal</h2>

      <input
        data-testid="fiscal-sale-id-input"
        aria-label="ID de la venta cobrada"
        value={saleId}
        onChange={(e) => { setSaleId(e.target.value); }}
        placeholder="ID de la venta cobrada"
        disabled={fiscal.busy}
      />
      <input
        data-testid="fiscal-customer-id-input"
        aria-label="ID del adquiriente registrado"
        value={customerId}
        onChange={(e) => { setCustomerId(e.target.value); }}
        placeholder="ID del adquiriente registrado"
        disabled={fiscal.busy}
      />

      <button
        data-testid="issue-identified-button"
        onClick={() => {
          void fiscal.issue(saleId.trim(), "SALES_INVOICE", {
            kind: "IDENTIFIED", customerId: customerId.trim(),
          });
        }}
        disabled={fiscal.busy || blocked || saleId.trim() === "" || customerId.trim() === ""}
      >
        Emitir con adquiriente
      </button>

      {/* Venta de mostrador sin identificar. Se ofrece porque es el caso
          mayoritario de un POS y el operador tiene que poder intentarlo y ver
          por qué no se puede, en vez de suponer que el botón no existe. */}
      <button
        data-testid="issue-anonymous-button"
        onClick={() => {
          void fiscal.issue(saleId.trim(), "SALES_INVOICE", {
            kind: "NOT_IDENTIFIED", reason: "ANONYMOUS_COUNTER_SALE",
          });
        }}
        disabled={fiscal.busy || blocked || saleId.trim() === ""}
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

      {issued?.outcome === "FISCAL_REJECTED" && <div data-testid="fiscal-rejected" role="alert">
        <strong>Documento rechazado por el proveedor fiscal</strong>
        <p>El envío terminó, pero el documento no fue aceptado. Revisa el rechazo antes de corregirlo; no se volverá a emitir automáticamente.</p>
      </div>}
      {issued !== null && issued.outcome === "BLOCKED" && (
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

      {blocked && <p role="alert">Esta venta no admite otra emisión desde esta pantalla. Revisa el resultado y resuelve el rechazo o la conciliación con el proveedor; no hay corrección ni conciliación automática.</p>}
      {fiscal.resultSaleId === saleId.trim() && fiscal.error !== null && <div data-testid="fiscal-error">{fiscal.error}</div>}
    </section>
  );
}
