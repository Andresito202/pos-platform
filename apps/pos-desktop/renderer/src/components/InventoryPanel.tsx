import { useState } from "react";
import {
  useInventoryAdmin,
  type AdjustMovement,
  type ReceiveMovement,
} from "../hooks/useInventoryAdmin.js";

const RECEIVE_MOVEMENTS: readonly ReceiveMovement[] = [
  "OPENING_COUNT",
  "PURCHASE_RECEIPT",
  "TRANSFER_IN",
];

const ADJUST_MOVEMENTS: readonly AdjustMovement[] = [
  "ADJUSTMENT_POSITIVE",
  "ADJUSTMENT_NEGATIVE",
  "SHRINKAGE",
  "TRANSFER_OUT",
];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Entrada, ajuste y consulta de existencia.
 *
 * Dos formularios separados con listas de motivo disjuntas. Recibir suma;
 * ajustar corrige y puede restar. Un solo formulario con siete motivos
 * permitiría registrar una merma eligiendo «compra», y el libro de movimientos
 * dejaría de servir para auditar.
 */
export function InventoryPanel(): React.JSX.Element {
  const inventory = useInventoryAdmin();
  const [presentationId, setPresentationId] = useState("");
  const [receiveType, setReceiveType] = useState<ReceiveMovement>("PURCHASE_RECEIPT");
  const [receiveQuantity, setReceiveQuantity] = useState("");
  const [receiveReason, setReceiveReason] = useState("PURCHASE");
  const [adjustType, setAdjustType] = useState<AdjustMovement>("ADJUSTMENT_NEGATIVE");
  const [adjustQuantity, setAdjustQuantity] = useState("");
  const [adjustReason, setAdjustReason] = useState("COUNT_CORRECTION");
  const [adjustLot, setAdjustLot] = useState("");
  const [businessDate, setBusinessDate] = useState(today());
  const [conversionTarget, setConversionTarget] = useState("");
  const [conversionQuantity, setConversionQuantity] = useState("");

  const target = presentationId.trim();

  return (
    <section className="card" data-testid="inventory-panel">
      <h2>Existencia</h2>

      <input
        data-testid="inventory-presentation-input"
        value={presentationId}
        onChange={(e) => { setPresentationId(e.target.value); }}
        placeholder="ID de presentación"
        disabled={inventory.busy}
      />
      <input
        data-testid="inventory-business-date-input"
        value={businessDate}
        onChange={(e) => { setBusinessDate(e.target.value); }}
        placeholder="Fecha de negocio"
        disabled={inventory.busy}
      />

      <h3>Entrada</h3>
      <select
        data-testid="receive-movement-select"
        value={receiveType}
        onChange={(e) => { setReceiveType(e.target.value as ReceiveMovement); }}
        disabled={inventory.busy}
      >
        {RECEIVE_MOVEMENTS.map((movement) => (
          <option key={movement} value={movement}>{movement}</option>
        ))}
      </select>
      <input
        data-testid="receive-quantity-input"
        value={receiveQuantity}
        onChange={(e) => { setReceiveQuantity(e.target.value); }}
        placeholder="Cantidad"
        disabled={inventory.busy}
      />
      <input
        data-testid="receive-reason-input"
        value={receiveReason}
        onChange={(e) => { setReceiveReason(e.target.value); }}
        placeholder="Motivo"
        disabled={inventory.busy}
      />
      <button
        data-testid="receive-stock-button"
        onClick={() => {
          void inventory.receive(
            target, receiveType, receiveQuantity, receiveReason.trim(), businessDate.trim(),
          );
        }}
        disabled={inventory.busy || target === "" || receiveQuantity.trim() === ""}
      >
        Recibir
      </button>

      <h3>Ajuste</h3>
      <select
        data-testid="adjust-movement-select"
        value={adjustType}
        onChange={(e) => { setAdjustType(e.target.value as AdjustMovement); }}
        disabled={inventory.busy}
      >
        {ADJUST_MOVEMENTS.map((movement) => (
          <option key={movement} value={movement}>{movement}</option>
        ))}
      </select>
      <input
        data-testid="adjust-quantity-input"
        value={adjustQuantity}
        onChange={(e) => { setAdjustQuantity(e.target.value); }}
        placeholder="Cantidad"
        disabled={inventory.busy}
      />
      <input
        data-testid="adjust-reason-input"
        value={adjustReason}
        onChange={(e) => { setAdjustReason(e.target.value); }}
        placeholder="Motivo"
        disabled={inventory.busy}
      />
      {/* En una salida, vacío resuelve por FEFO sobre lotes vigentes; un lote
          vencido sólo sale nombrándolo aquí, y la merma EXPIRED lo exige. En un
          ajuste positivo, nombra la tanda existente a la que se suma. */}
      <input
        data-testid="adjust-lot-input"
        value={adjustLot}
        onChange={(e) => { setAdjustLot(e.target.value); }}
        placeholder="Lote (opcional)"
        disabled={inventory.busy}
      />
      <button
        data-testid="adjust-stock-button"
        onClick={() => {
          void inventory.adjust(
            target, adjustType, adjustQuantity, adjustReason.trim(), businessDate.trim(),
            adjustLot,
          );
        }}
        disabled={inventory.busy || target === "" || adjustQuantity.trim() === ""}
      >
        Ajustar
      </button>

      <h3>Consulta</h3>
      <button
        data-testid="get-stock-button"
        onClick={() => { void inventory.getStock(target); }}
        disabled={inventory.busy || target === ""}
      >
        Consultar
      </button>

      {inventory.movement !== null && (
        <div data-testid="inventory-movement">
          <span data-testid="movement-outcome">{inventory.movement.outcome}</span>
          {inventory.movement.quantity_after !== null && (
            <span data-testid="movement-quantity-after">{inventory.movement.quantity_after}</span>
          )}
          {/* Sólo se rellena en el rechazo por falta de existencia, y es lo que
              permite corregir la captura sin ir a buscar el saldo. */}
          {inventory.movement.available !== null && (
            <span data-testid="movement-available">{inventory.movement.available}</span>
          )}
        </div>
      )}

      {inventory.stock !== null && inventory.stock.outcome === "FOUND" && (
        <div data-testid="stock-found">
          <span data-testid="stock-quantity">{inventory.stock.quantity_on_hand}</span>
        </div>
      )}
      {inventory.stock !== null && inventory.stock.outcome === "NOT_FOUND" && (
        <div data-testid="stock-not-found">sin movimientos</div>
      )}
      {inventory.stock !== null && inventory.stock.outcome === "UNAUTHORIZED" && (
        <div data-testid="stock-unauthorized">{inventory.stock.outcome}</div>
      )}
      <h3>Abrir presentación</h3>
      {/* El factor no se teclea: lo pone el catálogo. Pedirlo aquí convertiría
          esto en un ajuste de existencia con otro nombre. */}
      <input
        data-testid="conversion-target-input"
        value={conversionTarget}
        onChange={(e) => { setConversionTarget(e.target.value); }}
        placeholder="Presentación destino"
        disabled={inventory.busy}
      />
      <input
        data-testid="conversion-quantity-input"
        value={conversionQuantity}
        onChange={(e) => { setConversionQuantity(e.target.value); }}
        placeholder="Cuántas abrir"
        disabled={inventory.busy}
      />
      <button
        data-testid="apply-conversion-button"
        onClick={() => {
          void inventory.applyConversion(
            target, conversionTarget.trim(), conversionQuantity,
            "BREAK_PACK", businessDate.trim(),
          );
        }}
        disabled={
          inventory.busy || target === ""
          || conversionTarget.trim() === "" || conversionQuantity.trim() === ""
        }
      >
        Abrir
      </button>

      {inventory.conversion !== null && (
        <div data-testid="conversion-result">
          <span data-testid="conversion-outcome">{inventory.conversion.outcome}</span>
          {inventory.conversion.source_quantity_after !== null && (
            <span data-testid="conversion-source-after">
              {inventory.conversion.source_quantity_after}
            </span>
          )}
          {inventory.conversion.target_quantity_after !== null && (
            <span data-testid="conversion-target-after">
              {inventory.conversion.target_quantity_after}
            </span>
          )}
          {/* Lo que explica el rechazo: existencia disponible, o la cantidad
              que no cabía en la unidad destino. */}
          {inventory.conversion.detail_quantity !== null && (
            <span data-testid="conversion-detail">{inventory.conversion.detail_quantity}</span>
          )}
        </div>
      )}

      {inventory.error !== null && <div data-testid="inventory-error">{inventory.error}</div>}
    </section>
  );
}
