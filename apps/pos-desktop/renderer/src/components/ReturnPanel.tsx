import { useState } from "react";
import type {
  PaymentsRefundConfirmResult,
  ReturnPhysicalCondition,
  SalesReturnApproveResult,
  SalesReturnCreateResult,
  SalesReturnExecuteResult,
  SalesReturnRequestResult,
} from "@pos-platform/contracts";
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
  REFUND_METHOD_NOT_SUPPORTED: "La venta no se cobró con un único pago en efectivo o transferencia. El reembolso de QR, fiado o pago mixto todavía no existe.",
  ROUNDING_SHARE_NOT_SUPPORTED: "Esta venta tuvo ajuste de redondeo: por ahora sólo se puede devolver entera.",
  CASH_REGISTER_REQUIRED: "Esta venta se cobró en efectivo: indique de qué caja sale el dinero.",
  CASH_SHIFT_MISSING: "Esa caja no tiene turno abierto. Abra turno para entregar el efectivo.",
  CASH_SHIFT_NOT_OPEN: "El turno de esa caja se está cerrando.",
  CURRENCY_MISMATCH: "La moneda de la venta no es la del turno.",
  INSUFFICIENT_CASH: "La caja no tiene ese efectivo según el turno. No se entregó nada.",
};

type ConfirmRejection = Exclude<PaymentsRefundConfirmResult["outcome"], "CONFIRMED" | "IDEMPOTENT">;

const CONFIRM_REJECTION_MESSAGES: Record<ConfirmRejection, string> = {
  UNAUTHORIZED: "No tiene permiso para confirmar reembolsos de transferencia.",
  IDEMPOTENCY_CONFLICT: "Petición repetida con datos distintos. Vuelva a intentarlo.",
  REFUND_NOT_FOUND: "Ese reembolso no existe, ya se confirmó por otra vía, o no es de transferencia.",
  REFUND_NOT_PENDING: "Ese reembolso ya no está pendiente de confirmación.",
  SAME_ACTOR_NOT_ALLOWED: "Quien solicitó la devolución no puede confirmar su propio reembolso: debe hacerlo otra persona, desde su propio usuario.",
};

/**
 * Flujo segregado de devolución — `D-50`: solicitar, aprobar y ejecutar son
 * tres operaciones distintas, cada una con su propio permiso. A diferencia de
 * "Devolver y reembolsar" (arriba), un cajero con sólo el permiso de
 * solicitud puede empezarla sin poder terminarla.
 */
type RequestRejection = Exclude<SalesReturnRequestResult["outcome"], "REQUESTED" | "IDEMPOTENT">;

const REQUEST_REJECTION_MESSAGES: Record<RequestRejection, string> = {
  UNAUTHORIZED: "No tiene permiso para solicitar una devolución.",
  IDEMPOTENCY_CONFLICT: "Petición repetida con datos distintos. Vuelva a intentarlo.",
  SALE_NOT_FOUND: "Esa venta no existe en esta sucursal.",
  SALE_NOT_COMPLETED: "La venta no está cobrada: no hay nada que devolver.",
  LINE_NOT_FOUND: "Una de las líneas no pertenece a esa venta.",
  LINE_ALREADY_RETURNED: "Una de las líneas ya se devolvió o tiene otra solicitud en curso.",
  CONDITION_NOT_SUPPORTED: "Ese estado del producto exige un destino de inventario que todavía no existe.",
  REFUND_METHOD_NOT_SUPPORTED: "La venta no se cobró con un único pago en efectivo o transferencia.",
  ROUNDING_SHARE_NOT_SUPPORTED: "Esta venta tuvo ajuste de redondeo: por ahora sólo se puede devolver entera.",
};

type ApproveRejection = Exclude<SalesReturnApproveResult["outcome"], "APPROVED" | "IDEMPOTENT">;

const APPROVE_REJECTION_MESSAGES: Record<ApproveRejection, string> = {
  UNAUTHORIZED: "No tiene permiso para aprobar devoluciones.",
  IDEMPOTENCY_CONFLICT: "Petición repetida con datos distintos. Vuelva a intentarlo.",
  RETURN_NOT_FOUND: "Esa solicitud de devolución no existe.",
  RETURN_NOT_PENDING: "Esa solicitud ya no está pendiente de aprobación.",
};

type ExecuteRejection = Exclude<SalesReturnExecuteResult["outcome"], "COMPLETED" | "IDEMPOTENT">;

const EXECUTE_REJECTION_MESSAGES: Record<ExecuteRejection, string> = {
  UNAUTHORIZED: "No tiene permiso para ejecutar la devolución y mover el reembolso.",
  IDEMPOTENCY_CONFLICT: "Petición repetida con datos distintos. Vuelva a intentarlo.",
  RETURN_NOT_FOUND: "Esa devolución no existe.",
  RETURN_NOT_APPROVED: "Esa devolución todavía no está aprobada.",
  REFUND_METHOD_NOT_SUPPORTED: "La venta no se cobró con un único pago en efectivo o transferencia.",
  CASH_REGISTER_REQUIRED: "Esta venta se cobró en efectivo: indique de qué caja sale el dinero.",
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

  const [providerReference, setProviderReference] = useState("");
  const [destinationReference, setDestinationReference] = useState("");

  const lines = sale.receipt?.lines ?? [];
  const detail = reasonDetail.trim();
  // La caja sólo hace falta si la venta se cobró en efectivo: una
  // transferencia no tiene de dónde sacar nada. Sin recibo todavía no se sabe
  // el medio, así que se pide por defecto — el servicio decide de verdad.
  const paymentMethod = sale.receipt?.payments?.[0]?.payment_method ?? null;
  const registerNeeded = paymentMethod !== "TRANSFER";
  const canSubmit = !sale.busy && sale.receipt !== null && chosen.size > 0
    && (!registerNeeded || registerId.trim() !== "") && (reasonCode !== "OTRO" || detail !== "");

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

  const requestResult = sale.requestResult;
  const requestDone = requestResult !== null
    && (requestResult.outcome === "REQUESTED" || requestResult.outcome === "IDEMPOTENT");
  const approveResult = sale.approveResult;
  const approveDone = approveResult !== null
    && (approveResult.outcome === "APPROVED" || approveResult.outcome === "IDEMPOTENT");
  const executeResult = sale.executeResult;
  const executeDone = executeResult !== null
    && (executeResult.outcome === "COMPLETED" || executeResult.outcome === "IDEMPOTENT");
  const formLocked = done || requestDone;
  const canRequest = !sale.busy && sale.receipt !== null && chosen.size > 0
    && (reasonCode !== "OTRO" || detail !== "");

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
                      disabled={sale.busy || formLocked}
                    />
                    {" "}{line.product_name} · {line.presentation_name} · {line.quantity} {line.unit_code}
                    {" = "}{line.line_total_amount}
                  </label>
                  {condition !== undefined && (
                    <select
                      data-testid={`return-line-condition-${String(line.line_number)}`}
                      value={condition}
                      onChange={(e) => { setCondition(line.line_number, e.target.value as ReturnPhysicalCondition); }}
                      disabled={sale.busy || formLocked}
                    >
                      {CONDITIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  )}
                </li>
              );
            })}
          </ul>
          {registerNeeded && (
            <input
              data-testid="return-register-input"
              value={registerId}
              onChange={(e) => { setRegisterId(e.target.value); }}
              placeholder="Caja de la que sale el efectivo"
              disabled={sale.busy || formLocked}
            />
          )}
          <select
            data-testid="return-reason-select"
            value={reasonCode}
            onChange={(e) => { setReasonCode(e.target.value); }}
            disabled={sale.busy || formLocked}
          >
            {REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <input
            data-testid="return-detail-input"
            value={reasonDetail}
            onChange={(e) => { setReasonDetail(e.target.value); }}
            placeholder={reasonCode === "OTRO" ? "Explique el motivo" : "Detalle (opcional)"}
            maxLength={200}
            disabled={sale.busy || formLocked}
          />
          <button
            data-testid="return-submit-button"
            onClick={() => {
              void sale.submit({
                saleId: sale.receipt!.sale_id!,
                cashRegisterId: registerNeeded ? registerId.trim() : null,
                reasonCode,
                reasonDetail: detail === "" ? null : detail,
                lines: [...chosen].map(([lineNumber, physicalCondition]) => ({ lineNumber, physicalCondition })),
              });
            }}
            disabled={!canSubmit || formLocked}
          >
            Devolver y reembolsar
          </button>
          <button
            data-testid="return-request-button"
            onClick={() => {
              void sale.requestReturn({
                saleId: sale.receipt!.sale_id!,
                cashRegisterId: null,
                reasonCode,
                reasonDetail: detail === "" ? null : detail,
                lines: [...chosen].map(([lineNumber, physicalCondition]) => ({ lineNumber, physicalCondition })),
              });
            }}
            disabled={!canRequest || formLocked}
          >
            Solicitar devolución (aprobación de otra persona)
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

      {/* El reembolso de transferencia no se completa aquí: es manual y exige
          un actor distinto del que solicitó la devolución (`UC-PAY-004`). */}
      {result !== null && done && result.refund_status === "PROCESSING" && sale.confirmResult?.outcome !== "CONFIRMED"
        && sale.confirmResult?.outcome !== "IDEMPOTENT" && (
        <div data-testid="return-refund-pending">
          <p>
            Reembolso pendiente de confirmar: transfiera{" "}
            <strong data-testid="return-refund-pending-amount">{result.refunded_amount}</strong>
            {" "}al cliente y regístrelo aquí. Debe hacerlo otra persona, no quien pidió la devolución.
          </p>
          <input
            data-testid="return-confirm-reference-input"
            value={providerReference}
            onChange={(e) => { setProviderReference(e.target.value); }}
            placeholder="Referencia de la transferencia"
            maxLength={100}
            disabled={sale.busy}
          />
          <input
            data-testid="return-confirm-destination-input"
            value={destinationReference}
            onChange={(e) => { setDestinationReference(e.target.value); }}
            placeholder="Cuenta destino"
            maxLength={200}
            disabled={sale.busy}
          />
          <button
            data-testid="return-confirm-button"
            onClick={() => {
              void sale.confirmRefund({
                refundId: result.refund_id!,
                providerReference: providerReference.trim(),
                destinationReference: destinationReference.trim(),
              });
            }}
            disabled={sale.busy || providerReference.trim() === "" || destinationReference.trim() === ""}
          >
            Confirmar reembolso
          </button>
        </div>
      )}
      {sale.confirmResult !== null && (sale.confirmResult.outcome === "CONFIRMED" || sale.confirmResult.outcome === "IDEMPOTENT") && (
        <div data-testid="return-refund-confirmed">
          Reembolso confirmado · {sale.confirmResult.completed_amount}
        </div>
      )}
      {sale.confirmResult !== null && sale.confirmResult.outcome !== "CONFIRMED" && sale.confirmResult.outcome !== "IDEMPOTENT" && (
        <div data-testid="return-confirm-rejected">
          {CONFIRM_REJECTION_MESSAGES[sale.confirmResult.outcome as ConfirmRejection]}
        </div>
      )}

      {result !== null && !done && (
        <div data-testid="return-rejected">
          {REJECTION_MESSAGES[result.outcome as Rejection]}
        </div>
      )}

      {/* Flujo segregado — `D-50`: solicitar, aprobar y ejecutar, cada uno con
          su propio permiso. Independiente de "Devolver y reembolsar" arriba. */}
      {requestDone && (
        <div data-testid="return-request-completed">
          Solicitud registrada · id{" "}
          <strong data-testid="return-sale-return-id">{requestResult!.sale_return_id}</strong>
          {" "}· monto solicitado{" "}
          <strong data-testid="return-requested-amount">{requestResult!.requested_amount}</strong>
          {!approveDone && (
            <button
              data-testid="return-approve-button"
              onClick={() => { void sale.approveReturn({ saleReturnId: requestResult!.sale_return_id! }); }}
              disabled={sale.busy}
            >
              Aprobar
            </button>
          )}
        </div>
      )}
      {requestResult !== null && !requestDone && (
        <div data-testid="return-request-rejected">
          {REQUEST_REJECTION_MESSAGES[requestResult.outcome as RequestRejection]}
        </div>
      )}

      {approveDone && !executeDone && (
        <div data-testid="return-approved">
          Devolución aprobada
          {registerNeeded && (
            <input
              data-testid="return-execute-register-input"
              value={registerId}
              onChange={(e) => { setRegisterId(e.target.value); }}
              placeholder="Caja de la que sale el efectivo"
              disabled={sale.busy}
            />
          )}
          <button
            data-testid="return-execute-button"
            onClick={() => {
              void sale.executeReturn({
                saleReturnId: requestResult!.sale_return_id!,
                cashRegisterId: registerNeeded ? registerId.trim() : null,
              });
            }}
            disabled={sale.busy || (registerNeeded && registerId.trim() === "")}
          >
            Ejecutar
          </button>
        </div>
      )}
      {approveResult !== null && !approveDone && (
        <div data-testid="return-approve-rejected">
          {APPROVE_REJECTION_MESSAGES[approveResult.outcome as ApproveRejection]}
        </div>
      )}

      {executeDone && (
        <div data-testid="return-execute-completed">
          Devolución ejecutada · entregue{" "}
          <strong data-testid="return-execute-refunded-amount">{executeResult!.refunded_amount}</strong>
          {" "}en efectivo · {executeResult!.restocked_lines} línea(s) vuelven a la estantería
          {executeResult!.rounding_adjustment !== null && executeResult!.rounding_adjustment !== "0.000000" && (
            <> · incluye redondeo <span data-testid="return-execute-rounding">{executeResult!.rounding_adjustment}</span></>
          )}
        </div>
      )}
      {executeDone && executeResult!.fiscal_correction === "REQUIRED_NOT_AVAILABLE" && (
        <div data-testid="return-execute-fiscal-pending">
          Esta venta tiene factura electrónica: falta la nota crédito, y el sistema todavía no la emite.
        </div>
      )}
      {executeDone && executeResult!.refund_status === "PROCESSING" && sale.confirmResult?.outcome !== "CONFIRMED"
        && sale.confirmResult?.outcome !== "IDEMPOTENT" && (
        <div data-testid="return-execute-refund-pending">
          <p>
            Reembolso pendiente de confirmar: transfiera{" "}
            <strong data-testid="return-execute-refund-pending-amount">{executeResult!.refunded_amount}</strong>
            {" "}al cliente y regístrelo aquí. Debe hacerlo otra persona, no quien ejecutó la devolución.
          </p>
          <input
            data-testid="return-execute-confirm-reference-input"
            value={providerReference}
            onChange={(e) => { setProviderReference(e.target.value); }}
            placeholder="Referencia de la transferencia"
            maxLength={100}
            disabled={sale.busy}
          />
          <input
            data-testid="return-execute-confirm-destination-input"
            value={destinationReference}
            onChange={(e) => { setDestinationReference(e.target.value); }}
            placeholder="Cuenta destino"
            maxLength={200}
            disabled={sale.busy}
          />
          <button
            data-testid="return-execute-confirm-button"
            onClick={() => {
              void sale.confirmRefund({
                refundId: executeResult!.refund_id!,
                providerReference: providerReference.trim(),
                destinationReference: destinationReference.trim(),
              });
            }}
            disabled={sale.busy || providerReference.trim() === "" || destinationReference.trim() === ""}
          >
            Confirmar reembolso
          </button>
        </div>
      )}
      {executeResult !== null && !executeDone && (
        <div data-testid="return-execute-rejected">
          {EXECUTE_REJECTION_MESSAGES[executeResult.outcome as ExecuteRejection]}
        </div>
      )}

      {sale.error !== null && <div data-testid="return-error">{sale.error}</div>}

      {(done || executeDone) && (
        <button
          data-testid="return-reset-button"
          onClick={() => {
            sale.reset(); setChosen(new Map()); setSaleId(""); setReasonDetail("");
            setProviderReference(""); setDestinationReference(""); setRegisterId("");
          }}
        >
          Otra devolución
        </button>
      )}
    </section>
  );
}
