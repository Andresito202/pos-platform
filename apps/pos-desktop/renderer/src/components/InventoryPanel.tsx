import { InventoryBatchPanel } from "./InventoryBatchPanel.js";
import { InventoryConversionPanel } from "./InventoryConversionPanel.js";
import { InventoryCsvImport } from "./InventoryCsvImport.js";
import { InventoryTransformPanel } from "./InventoryTransformPanel.js";
import { CanonicalPermission, LicenseSectorEntitlement } from "@pos-platform/contracts";
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

const movementLabels: Record<ReceiveMovement | AdjustMovement, string> = {
  OPENING_COUNT: "Inventario inicial",
  PURCHASE_RECEIPT: "Recepción de compra",
  TRANSFER_IN: "Traslado recibido",
  ADJUSTMENT_POSITIVE: "Ajuste de entrada",
  ADJUSTMENT_NEGATIVE: "Ajuste de salida",
  SHRINKAGE: "Merma o pérdida",
  TRANSFER_OUT: "Traslado enviado",
};

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
export function InventoryPanel({ permissions, entitlements = new Set(), initialPresentationId = null }: {
  permissions: ReadonlySet<string>;
  entitlements?: ReadonlySet<string>;
  initialPresentationId?: string | null;
}): React.JSX.Element {
  const inventory = useInventoryAdmin();
  const [presentationId, setPresentationId] = useState("");
  const [batchPending,setBatchPending]=useState(false);
  useEffect(() => { if (initialPresentationId !== null&&!batchPending) setPresentationId(initialPresentationId); }, [initialPresentationId,batchPending]);
  const [receiveType, setReceiveType] = useState<ReceiveMovement>("PURCHASE_RECEIPT");
  const [receiveQuantity, setReceiveQuantity] = useState("");
  const [receiveReason, setReceiveReason] = useState("PURCHASE");
  const [batchEnabled,setBatchEnabled]=useState(false);
  const [batchCode,setBatchCode]=useState("");
  const [batchManufacture,setBatchManufacture]=useState("");
  const [batchExpiry,setBatchExpiry]=useState("");
  const [supplierReference,setSupplierReference]=useState("");
  const [receiptDocument,setReceiptDocument]=useState("");
  const [adjustLotId,setAdjustLotId]=useState("");
  const [adjustType, setAdjustType] = useState<AdjustMovement>("ADJUSTMENT_NEGATIVE");
  const [adjustQuantity, setAdjustQuantity] = useState("");
  const [adjustReason, setAdjustReason] = useState("COUNT_CORRECTION");
  const [businessDate, setBusinessDate] = useState(today());

  const target = presentationId.trim();

  return (
    <section data-testid="inventory-panel">
      <h2>Existencia</h2>
      {permissions.has(CanonicalPermission.INVENTORY_STOCK_RECEIVE) && <InventoryCsvImport enabled={permissions.has(CanonicalPermission.INVENTORY_STOCK_RECEIVE) && !inventory.busy && !inventory.pending} />}
      {inventory.pending && <div role="status"><p>Hay un movimiento pendiente de confirmación. No cierres esta pantalla hasta resolverlo.</p>
        <button type="button" disabled={inventory.busy} onClick={() => void inventory.retryPending()}>Reintentar el mismo movimiento</button></div>}
      <div className="pos-form-grid">

      <label className="pos-field">ID de presentación
      <input
        data-testid="inventory-presentation-input"
        aria-label="ID de presentación"
        value={presentationId}
        onChange={(e) => { setPresentationId(e.target.value); }}
        placeholder="ID de presentación"
        disabled={inventory.busy || inventory.pending || batchPending}
      />
      </label>
      {(permissions.has(CanonicalPermission.INVENTORY_STOCK_RECEIVE) || permissions.has(CanonicalPermission.INVENTORY_STOCK_ADJUST)) && <label className="pos-field">Fecha de negocio
      <input
        data-testid="inventory-business-date-input"
        aria-label="Fecha de negocio"
        value={businessDate}
        onChange={(e) => { setBusinessDate(e.target.value); }}
        placeholder="Fecha de negocio"
        disabled={inventory.busy || inventory.pending}
      />
      </label>}

      {permissions.has(CanonicalPermission.INVENTORY_STOCK_RECEIVE) && <>
      <h3>Entrada</h3>
      <label className="pos-field">Tipo de entrada
      <select
        data-testid="receive-movement-select"
        value={receiveType}
        onChange={(e) => { setReceiveType(e.target.value as ReceiveMovement); }}
        disabled={inventory.busy || inventory.pending}
      >
        {RECEIVE_MOVEMENTS.map((movement) => (
          <option key={movement} value={movement}>{movementLabels[movement]}</option>
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
        disabled={inventory.busy || inventory.pending}
      />
      </label>
      <label className="pos-field">Motivo de entrada
      <input
        data-testid="receive-reason-input"
        aria-label="Motivo de entrada"
        value={receiveReason}
        onChange={(e) => { setReceiveReason(e.target.value); }}
        placeholder="Motivo"
        disabled={inventory.busy || inventory.pending}
      />
      </label>
      {receiveType==="PURCHASE_RECEIPT"&&<label className="pos-field">
        <input type="checkbox" checked={batchEnabled} onChange={e=>setBatchEnabled(e.target.checked)}
          disabled={inventory.busy||inventory.pending}/> Recepción con lote trazable
      </label>}
      {batchEnabled&&receiveType==="PURCHASE_RECEIPT"&&<fieldset className="pos-form-grid" aria-label="Datos del lote">
        <label className="pos-field">Código de lote
          <input data-testid="batch-code-input" value={batchCode} onChange={e=>setBatchCode(e.target.value)}
            disabled={inventory.busy||inventory.pending} required/>
        </label>
        <label className="pos-field">Fabricación (opcional)
          <input type="date" value={batchManufacture} onChange={e=>setBatchManufacture(e.target.value)}
            disabled={inventory.busy||inventory.pending}/>
        </label>
        <label className="pos-field">Vencimiento (opcional)
          <input type="date" value={batchExpiry} onChange={e=>setBatchExpiry(e.target.value)}
            disabled={inventory.busy||inventory.pending}/>
        </label>
        <label className="pos-field">Proveedor
          <input value={supplierReference} onChange={e=>setSupplierReference(e.target.value)}
            disabled={inventory.busy||inventory.pending} required/>
        </label>
        <label className="pos-field">Documento de recepción
          <input value={receiptDocument} onChange={e=>setReceiptDocument(e.target.value)}
            disabled={inventory.busy||inventory.pending} required/>
        </label>
      </fieldset>}
      <button
        data-testid="receive-stock-button"
        onClick={() => {
          void inventory.receive(
            target, receiveType, receiveQuantity, receiveReason.trim(), businessDate.trim(),
            batchEnabled&&receiveType==="PURCHASE_RECEIPT"?{
              code:batchCode.trim(),manufacture_date:batchManufacture||null,expiry_date:batchExpiry||null,
              supplier_reference:supplierReference.trim(),receipt_document:receiptDocument.trim(),
            }:undefined,
          );
        }}
        disabled={inventory.busy || inventory.pending || !permissions.has(CanonicalPermission.INVENTORY_STOCK_RECEIVE) || target === "" || receiveQuantity.trim() === "" || (batchEnabled&&receiveType==="PURCHASE_RECEIPT"&&(!batchCode.trim()||!supplierReference.trim()||!receiptDocument.trim()))}
      >
        Recibir
      </button>

      </>}

      {permissions.has(CanonicalPermission.INVENTORY_STOCK_ADJUST) && <>
      <h3>Ajuste</h3>
      <label className="pos-field">Tipo de ajuste
      <select
        data-testid="adjust-movement-select"
        value={adjustType}
        onChange={(e) => { setAdjustType(e.target.value as AdjustMovement); }}
        disabled={inventory.busy || inventory.pending}
      >
        {ADJUST_MOVEMENTS.map((movement) => (
          <option key={movement} value={movement}>{movementLabels[movement]}</option>
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
        disabled={inventory.busy || inventory.pending}
      />
      </label>
      <label className="pos-field">Motivo del ajuste
      <input
        data-testid="adjust-reason-input"
        aria-label="Motivo del ajuste"
        value={adjustReason}
        onChange={(e) => { setAdjustReason(e.target.value); }}
        placeholder="Motivo"
        disabled={inventory.busy || inventory.pending}
      />
      </label>
      <label className="pos-field">ID de lote (solo si hay control por lotes)
        <input data-testid="adjust-batch-id" value={adjustLotId} onChange={e=>setAdjustLotId(e.target.value)}
          disabled={inventory.busy||inventory.pending} placeholder="UUID del lote"/>
      </label>
      <button
        data-testid="adjust-stock-button"
        onClick={() => {
          void inventory.adjust(
            target, adjustType, adjustQuantity, adjustReason.trim(), businessDate.trim(),
            adjustLotId.trim()||undefined,
          );
        }}
        disabled={inventory.busy || inventory.pending || !permissions.has(CanonicalPermission.INVENTORY_STOCK_ADJUST) || target === "" || adjustQuantity.trim() === ""}
      >
        Ajustar
      </button>

      </>}

      {permissions.has(CanonicalPermission.INVENTORY_STOCK_ADJUST)&&target!==""&&
        <InventoryConversionPanel key={target} sourcePresentationId={target} businessDate={businessDate.trim()}
          canApprove={permissions.has(CanonicalPermission.CATALOG_PRODUCT_REGISTER)} />}

      {permissions.has(CanonicalPermission.INVENTORY_STOCK_ADJUST)
        && entitlements.has(LicenseSectorEntitlement.SALSAMENTARIA) &&
        <InventoryTransformPanel businessDate={businessDate.trim() || "2026-09-07"} />}

      <h3>Consulta</h3>
      {permissions.has(CanonicalPermission.INVENTORY_STOCK_READ)&&target!==""&&
        <InventoryBatchPanel key={target} presentationId={target} canAdjust={permissions.has(CanonicalPermission.INVENTORY_STOCK_ADJUST)} onPendingChange={setBatchPending}/>}

      <button
        data-testid="get-stock-button"
        onClick={() => { void inventory.getStock(target); }}
        disabled={inventory.busy || !permissions.has(CanonicalPermission.INVENTORY_STOCK_READ) || target === ""}
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
      {inventory.error !== null && <div data-testid="inventory-error">{inventory.error}</div>}
      </div>
    </section>
  );
}
