import { useState } from "react";
import { CanonicalPermission } from "@pos-platform/contracts";
import { useBakeryAdmin } from "../hooks/useBakeryAdmin.js";

/**
 * Pastelería administrativa: recetas y confirmación de producción sobre el
 * inventario compartido. No es una caja paralela; el cobro sigue en SalePanel.
 */
export function BakeryPanel({ permissions }: {
  permissions: ReadonlySet<string>;
}): React.JSX.Element | null {
  const canManage = permissions.has(CanonicalPermission.BAKERY_RECIPE_MANAGE);
  const canProduce = permissions.has(CanonicalPermission.BAKERY_PRODUCTION_EXECUTE);
  const canRead = permissions.has(CanonicalPermission.BAKERY_PRODUCTION_READ) || canProduce;
  if (!canManage && !canProduce && !canRead) return null;

  const bakery = useBakeryAdmin();
  const [name, setName] = useState("Bizcocho");
  const [finishedProductId, setFinishedProductId] = useState("");
  const [finishedPresentationId, setFinishedPresentationId] = useState("");
  const [baseQty, setBaseQty] = useState("1000.000000");
  const [yieldQty, setYieldQty] = useState("900.000000");
  const [shrinkQty, setShrinkQty] = useState("100.000000");
  const [ingProductId, setIngProductId] = useState("");
  const [ingPresentationId, setIngPresentationId] = useState("");
  const [ingQty, setIngQty] = useState("600.000000");
  const [recipeId, setRecipeId] = useState("");
  const [recipeVersion, setRecipeVersion] = useState("1");
  const [orderId, setOrderId] = useState("");
  const [actualQty, setActualQty] = useState("900.000000");
  const [batchCode, setBatchCode] = useState("");
  const [lotId, setLotId] = useState("");

  return (
    <section aria-label="Pastelería" className="pos-panel-section">
      <h2>Pastelería / producción</h2>
      <p>
        Recetas versionadas y órdenes sobre el inventario compartido. No inventa
        existencias ni usa precios de catálogo como costo.
      </p>
      {bakery.error ? <p role="alert">{bakery.error}</p> : null}
      {bakery.lastOutcome ? <p>Resultado: {bakery.lastOutcome}</p> : null}

      {canManage ? (
        <div>
          <h3>Receta (borrador)</h3>
          <label>Nombre <input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label>Producto terminado <input value={finishedProductId} onChange={(e) => setFinishedProductId(e.target.value)} /></label>
          <label>Presentación <input value={finishedPresentationId} onChange={(e) => setFinishedPresentationId(e.target.value)} /></label>
          <label>Cantidad base <input value={baseQty} onChange={(e) => setBaseQty(e.target.value)} /></label>
          <label>Rendimiento esperado <input value={yieldQty} onChange={(e) => setYieldQty(e.target.value)} /></label>
          <label>Merma esperada <input value={shrinkQty} onChange={(e) => setShrinkQty(e.target.value)} /></label>
          <label>Ingrediente producto <input value={ingProductId} onChange={(e) => setIngProductId(e.target.value)} /></label>
          <label>Ingrediente presentación <input value={ingPresentationId} onChange={(e) => setIngPresentationId(e.target.value)} /></label>
          <label>Cantidad ingrediente <input value={ingQty} onChange={(e) => setIngQty(e.target.value)} /></label>
          <button
            type="button"
            disabled={bakery.busy}
            onClick={() => bakery.createRecipeDraft({
              name,
              finishedProductId,
              finishedPresentationId,
              baseBatchQuantity: baseQty,
              expectedYieldQuantity: yieldQty,
              expectedShrinkageQuantity: shrinkQty,
              canonicalMassUnit: "G",
              lines: [{
                ingredientProductId: ingProductId,
                ingredientPresentationId: ingPresentationId,
                quantity: ingQty,
                unitCode: "G",
                massQuantity: ingQty,
              }],
            })}
          >
            Crear borrador
          </button>
          <label>Receta a aprobar <input value={recipeId} onChange={(e) => setRecipeId(e.target.value)} /></label>
          <label>Versión <input value={recipeVersion} onChange={(e) => setRecipeVersion(e.target.value)} /></label>
          <button
            type="button"
            disabled={bakery.busy}
            onClick={() => bakery.approveRecipe({
              recipeId,
              expectedVersion: Number(recipeVersion),
            })}
          >
            Aprobar receta
          </button>
        </div>
      ) : null}

      {canProduce ? (
        <div>
          <h3>Confirmar producción</h3>
          <label>Orden <input value={orderId} onChange={(e) => setOrderId(e.target.value)} /></label>
          <label>Cantidad real <input value={actualQty} onChange={(e) => setActualQty(e.target.value)} /></label>
          <label>Lote terminado <input value={batchCode} onChange={(e) => setBatchCode(e.target.value)} /></label>
          <label>Lote ingrediente <input value={lotId} onChange={(e) => setLotId(e.target.value)} /></label>
          <button
            type="button"
            disabled={bakery.busy}
            onClick={() => bakery.confirmProduction({
              orderId,
              actualQuantity: actualQty,
              shrinkageQuantity: "0.000000",
              shrinkageReason: null,
              productionDate: new Date().toISOString().slice(0, 10),
              finishedBatchCode: batchCode,
              consumptions: [{
                ingredientPresentationId: ingPresentationId,
                lotId,
                plannedQuantity: ingQty,
                actualQuantity: ingQty,
                massQuantity: ingQty,
              }],
              directCosts: [],
              shrinkageAttributions: [],
            })}
          >
            Confirmar producción
          </button>
        </div>
      ) : null}

      {canRead ? (
        <div>
          <h3>Trazabilidad</h3>
          <label>Orden <input value={orderId} onChange={(e) => setOrderId(e.target.value)} /></label>
          <button type="button" disabled={bakery.busy} onClick={() => bakery.getTrace(orderId)}>
            Consultar
          </button>
          {bakery.traceJson ? <pre>{bakery.traceJson}</pre> : null}
        </div>
      ) : null}
    </section>
  );
}
