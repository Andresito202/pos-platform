import { CanonicalPermission } from "@pos-platform/contracts";
import { useEffect, useState } from "react";
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
export function InventoryPanel({ permissions, initialPresentationId = null }: { permissions: ReadonlySet<string>; initialPresentationId?: string | null }): React.JSX.Element {
  const inventory = useInventoryAdmin();
  const [presentationId, setPresentationId] = useState("");
  useEffect(() => { if (initialPresentationId !== null) setPresentationId(initialPresentationId); }, [initialPresentationId]);
  const [receiveType, setReceiveType] = useState<ReceiveMovement>("PURCHASE_RECEIPT");
  const [receiveQuantity, setReceiveQuantity] = useState("");
  const [receiveReason, setReceiveReason] = useState("PURCHASE");
  const [adjustType, setAdjustType] = useState<AdjustMovement>("ADJUSTMENT_NEGATIVE");
  const [adjustQuantity, setAdjustQuantity] = useState("");
  const [adjustReason, setAdjustReason] = useState("COUNT_CORRECTION");
  const [businessDate, setBusinessDate] = useState(today());

  const target = presentationId.trim();

  return (
    <section data-testid="inventory-panel">
      <h2>Existencia</h2>
      <div className="pos-form-grid">

      <label className="pos-field">ID de presentación
      <input
        data-testid="inventory-presentation-input"
        aria-label="ID de presentación"
        value={presentationId}
        onChange={(e) => { setPresentationId(e.target.value); }}
        placeholder="ID de presentación"
        disabled={inventory.busy}
      />
      </label>
      <label className="pos-field">Fecha de negocio
      <input
        data-testid="inventory-business-date-input"
        aria-label="Fecha de negocio"
        value={businessDate}
        onChange={(e) => { setBusinessDate(e.target.value); }}
        placeholder="Fecha de negocio"
        disabled={inventory.busy}
      />
      </label>

      {permissions.has(CanonicalPermission.INVENTORY_STOCK_RECEIVE) && (<>
      <h3>Entrada</h3>
      <label className="pos-field">Tipo de entrada
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
      </label>
      <label className="pos-field">Cantidad de entrada
      <input
        data-testid="receive-quantity-input"
        aria-label="Cantidad de entrada"
        value={receiveQuantity}
        onChange={(e) => { setReceiveQuantity(e.target.value); }}
        placeholder="Cantidad"
        disabled={inventory.busy}
      />
      </label>
      <label className="pos-field">Motivo de entrada
      <input
        data-testid="receive-reason-input"
        aria-label="Motivo de entrada"
        value={receiveReason}
        onChange={(e) => { setReceiveReason(e.target.value); }}
        placeholder="Motivo"
        disabled={inventory.busy}
      />
      </label>
      <button
        data-testid="receive-stock-button"
        onClick={() => {
          void inventory.receive(
            target, receiveType, receiveQuantity, receiveReason.trim(), businessDate.trim(),
          );
        }}
        disabled={inventory.busy || !permissions.has(CanonicalPermission.INVENTORY_STOCK_RECEIVE) || target === "" || receiveQuantity.trim() === ""}
      >
        Recibir
      </button>

      </>)}

      {permissions.has(CanonicalPermission.INVENTORY_STOCK_ADJUST) && (<>
      <h3>Ajuste</h3>
      <label className="pos-field">Tipo de ajuste
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
      </label>
      <label className="pos-field">Cantidad de ajuste
      <input
        data-testid="adjust-quantity-input"
        aria-label="Cantidad de ajuste"
        value={adjustQuantity}
        onChange={(e) => { setAdjustQuantity(e.target.value); }}
        placeholder="Cantidad"
        disabled={inventory.busy}
      />
      </label>
      <label className="pos-field">Motivo del ajuste
      <input
        data-testid="adjust-reason-input"
        aria-label="Motivo del ajuste"
        value={adjustReason}
        onChange={(e) => { setAdjustReason(e.target.value); }}
        placeholder="Motivo"
        disabled={inventory.busy}
      />
      </label>
      <button
        data-testid="adjust-stock-button"
        onClick={() => {
          void inventory.adjust(
            target, adjustType, adjustQuantity, adjustReason.trim(), businessDate.trim(),
          );
        }}
        disabled={inventory.busy || !permissions.has(CanonicalPermission.INVENTORY_STOCK_ADJUST) || target === "" || adjustQuantity.trim() === ""}
      >
        Ajustar
      </button>

      </>)}

      {permissions.has(CanonicalPermission.INVENTORY_STOCK_READ) && (<>
      <h3>Consulta</h3>
      <button
        data-testid="get-stock-button"
        onClick={() => { void inventory.getStock(target); }}
        disabled={inventory.busy || !permissions.has(CanonicalPermission.INVENTORY_STOCK_READ) || target === ""}
      >
        Consultar
      </button>

      </>)}

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
      {inventory.error !== null && <div data-testid="inventory-error">{inventory.error}</div>}
      </div>
    </section>
  );
}
