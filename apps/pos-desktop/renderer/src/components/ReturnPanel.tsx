import { useState } from "react";
import type { ReturnPhysicalCondition, SalesReturnCreateResult } from "@pos-platform/contracts";
import { useSaleReturn } from "../hooks/useSaleReturn.js";

/**
 * Estados físicos que la devolución sabe tratar. `QUARANTINE` y
 * `RETURN_TO_SUPPLIER` no se ofrecen: exigen un destino de inventario que no
 * existe, y el servicio los rechazaría siempre.
 */
const CONDITIONS: readonly { readonly value: ReturnPhysicalCondition; readonly label: string }[] = [
  { value: "RESTOCKABLE", label: "Vuelve a la estantería" },
  { value: "DAMAGED", label: "Dañado" },
  { value: "EXPIRED", label: "Vencido" },
  { value: "OPENED", label: "Abierto" },
  { value: "DISCARDED", label: "Se desecha" },
  { value: "NOT_APPLICABLE", label: "Sin mercancía (servicio)" },
];

/**
 * Motivos que ofrece la pantalla. **No es un catálogo ratificado**: el
 * contrato admite cualquier código estable y lo deja en la auditoría. Queda
 * pendiente de que el propietario fije la lista.
 */
const REASONS: readonly { readonly value: string; readonly label: string }[] = [
  { value: "CAMBIO_DE_OPINION", label: "El cliente cambió de opinión" },
  { value: "PRODUCTO_DEFECTUOSO", label: "Producto defectuoso" },
  { value: "PRODUCTO_EQUIVOCADO", label: "Se entregó otro producto" },
  { value: "OTRO", label: "Otro" },
];

type Rejection = Exclude<SalesReturnCreateResult["outcome"], "COMPLETED" | "IDEMPOTENT">;

const REJECTION_MESSAGES: Record<Rejection, string> = {
  UNAUTHORIZED: "No tiene permiso para devolver y reembolsar. Un cajero sólo puede solicitarlo, y la solicitud todavía no existe en el sistema: pida a quien tenga permiso que la haga.",
  IDEMPOTENCY_CONFLICT: "Petición repetida con datos distintos. Vuelva a intentarlo.",
  SALE_NOT_FOUND: "Esa venta no existe en esta sucursal.",
  SALE_NOT_COMPLETED: "La venta no está cobrada: no hay nada que devolver.",
  LINE_NOT_FOUND: "Una de las líneas no pertenece a esa venta.",
  LINE_ALREADY_RETURNED: "Una de las líneas ya se devolvió antes.",
  CONDITION_NOT_SUPPORTED: "Ese estado del producto exige un destino de inventario que todavía no existe.",
  REFUND_METHOD_NOT_SUPPORTED: "La venta no se cobró con un único pago en efectivo. El reembolso por transferencia, QR, fiado o pago mixto todavía no existe.",
  ROUNDING_SHARE_NOT_SUPPORTED: "Esta venta tuvo ajuste de redondeo: por ahora sólo se puede devolver entera.",
  CASH_SHIFT_MISSING: "Esa caja no tiene turno abierto. Abra turno para entregar el efectivo.",
  CASH_SHIFT_NOT_OPEN: "El turno de esa caja se está cerrando.",
  CURRENCY_MISMATCH: "La moneda de la venta no es la del turno.",
  INSUFFICIENT_CASH: "La caja no tiene ese efectivo según el turno. No se entregó nada.",
};

/**
 * Devolución de una venta cobrada en efectivo — `B11`.
 *
 * El cajero carga la venta por su identificador, marca qué líneas vuelven y en
 * qué estado, y nombra la caja de la que sale el efectivo. **El importe no se
 * escribe ni se calcula aquí**: lo decide el servicio a partir de la venta
 * congelada y llega en la respuesta.
 */
export function ReturnPanel(): React.JSX.Element {
  const sale = useSaleReturn();
  const [saleId, setSaleId] = useState("");
  const [registerId, setRegisterId] = useState("");
  const [reasonCode, setReasonCode] = useState(REASONS[0]!.value);
  const [reasonDetail, setReasonDetail] = useState("");
  const [chosen, setChosen] = useState<ReadonlyMap<number, ReturnPhysicalCondition>>(new Map());

  const lines = sale.receipt?.lines ?? [];
  const detail = reasonDetail.trim();
  const canSubmit = !sale.busy && sale.receipt !== null && chosen.size > 0
    && registerId.trim() !== "" && (reasonCode !== "OTRO" || detail !== "");

  const toggle = (lineNumber: number, on: boolean): void => {
    const next = new Map(chosen);
    if (on) next.set(lineNumber, "RESTOCKABLE"); else next.delete(lineNumber);
    setChosen(next);
  };
  const setCondition = (lineNumber: number, condition: ReturnPhysicalCondition): void => {
    const next = new Map(chosen);
    next.set(lineNumber, condition);
    setChosen(next);
  };

  const result = sale.result;
  const done = result !== null && (result.outcome === "COMPLETED" || result.outcome === "IDEMPOTENT");

  return (
    <section className="card" data-testid="return-panel">
      <h2>Devoluciones</h2>
      <input
        data-testid="return-sale-id-input"
        value={saleId}
        onChange={(e) => { setSaleId(e.target.value); }}
        placeholder="ID de la venta"
        disabled={sale.busy}
      />
      <button
        data-testid="return-load-button"
        onClick={() => { setChosen(new Map()); void sale.load(saleId.trim()); }}
        disabled={sale.busy || saleId.trim() === ""}
      >
        Cargar venta
      </button>

      {sale.loadOutcome === "NOT_FOUND" && <div data-testid="return-sale-not-found">Esa venta no existe en esta caja.</div>}
      {sale.loadOutcome === "NOT_COMPLETED" && (
        <div data-testid="return-sale-not-completed">La venta no está cobrada: no hay nada que devolver.</div>
      )}
      {sale.loadOutcome === "UNAUTHORIZED" && (
        <div data-testid="return-sale-unauthorized">No tiene permiso para consultar la venta.</div>
      )}

      {sale.receipt !== null && (
        <div data-testid="return-form">
          <ul data-testid="return-lines">
            {lines.map((line) => {
              const condition = chosen.get(line.line_number);
              return (
                <li key={line.line_number} data-testid="return-line">
                  <label>
                    <input
                      type="checkbox"
                      data-testid={`return-line-check-${String(line.line_number)}`}
                      checked={condition !== undefined}
                      onChange={(e) => { toggle(line.line_number, e.target.checked); }}
                      disabled={sale.busy || done}
                    />
                    {" "}{line.product_name} · {line.presentation_name} · {line.quantity} {line.unit_code}
                    {" = "}{line.line_total_amount}
                  </label>
                  {condition !== undefined && (
                    <select
                      data-testid={`return-line-condition-${String(line.line_number)}`}
                      value={condition}
                      onChange={(e) => { setCondition(line.line_number, e.target.value as ReturnPhysicalCondition); }}
                      disabled={sale.busy || done}
                    >
                      {CONDITIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  )}
                </li>
              );
            })}
          </ul>
          <input
            data-testid="return-register-input"
            value={registerId}
            onChange={(e) => { setRegisterId(e.target.value); }}
            placeholder="Caja de la que sale el efectivo"
            disabled={sale.busy || done}
          />
          <select
            data-testid="return-reason-select"
            value={reasonCode}
            onChange={(e) => { setReasonCode(e.target.value); }}
            disabled={sale.busy || done}
          >
            {REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <input
            data-testid="return-detail-input"
            value={reasonDetail}
            onChange={(e) => { setReasonDetail(e.target.value); }}
            placeholder={reasonCode === "OTRO" ? "Explique el motivo" : "Detalle (opcional)"}
            maxLength={200}
            disabled={sale.busy || done}
          />
          <button
            data-testid="return-submit-button"
            onClick={() => {
              void sale.submit({
                saleId: sale.receipt!.sale_id!,
                cashRegisterId: registerId.trim(),
                reasonCode,
                reasonDetail: detail === "" ? null : detail,
                lines: [...chosen].map(([lineNumber, physicalCondition]) => ({ lineNumber, physicalCondition })),
              });
            }}
            disabled={!canSubmit || done}
          >
            Devolver y reembolsar
          </button>
        </div>
      )}

      {result !== null && done && (
        <div data-testid="return-completed">
          Devolución registrada · entregue{" "}
          <strong data-testid="return-refunded-amount">{result.refunded_amount}</strong>
          {" "}en efectivo · {result.restocked_lines} línea(s) vuelven a la estantería
          {result.rounding_adjustment !== null && result.rounding_adjustment !== "0.000000" && (
            <> · incluye redondeo <span data-testid="return-rounding">{result.rounding_adjustment}</span></>
          )}
        </div>
      )}
      {/* La devolución ya está hecha; esto dice lo que falta, no la bloquea. */}
      {result !== null && done && result.fiscal_correction === "REQUIRED_NOT_AVAILABLE" && (
        <div data-testid="return-fiscal-pending">
          Esta venta tiene factura electrónica: falta la nota crédito, y el sistema todavía no la emite.
        </div>
      )}
      {result !== null && !done && (
        <div data-testid="return-rejected">
          {REJECTION_MESSAGES[result.outcome as Rejection]}
        </div>
      )}
      {sale.error !== null && <div data-testid="return-error">{sale.error}</div>}

      {done && (
        <button
          data-testid="return-reset-button"
          onClick={() => { sale.reset(); setChosen(new Map()); setSaleId(""); setReasonDetail(""); }}
        >
          Otra devolución
        </button>
      )}
    </section>
  );
}
