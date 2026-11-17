import { useEffect, useState } from "react";
import { CanonicalPermission } from "@pos-platform/contracts";
import { useBakeryAdmin } from "../hooks/useBakeryAdmin.js";

/**
 * Pastelería administrativa: recetas y producción sobre el inventario compartido.
 * No es una caja paralela; el cobro sigue en SalePanel.
 */
export function BakeryPanel({ permissions }: {
  permissions: ReadonlySet<string>;
}): React.JSX.Element | null {
  const canManage = permissions.has(CanonicalPermission.BAKERY_RECIPE_MANAGE);
  const canProduce = permissions.has(CanonicalPermission.BAKERY_PRODUCTION_EXECUTE);
  const canDeviate = permissions.has(CanonicalPermission.BAKERY_PRODUCTION_DEVIATE);
  const canRead = permissions.has(CanonicalPermission.BAKERY_PRODUCTION_READ) || canProduce;
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
  const [plannedQty, setPlannedQty] = useState("1000.000000");
  const [orderId, setOrderId] = useState("");
  const [actualQty, setActualQty] = useState("900.000000");
  const [actualNetMass, setActualNetMass] = useState("900.000000");
  const [batchCode, setBatchCode] = useState("");
  const [lotId, setLotId] = useState("");
  const [plannedConsumptionQty, setPlannedConsumptionQty] = useState("600.000000");
  const [actualConsumptionQty, setActualConsumptionQty] = useState("600.000000");
  const [deviationKind, setDeviationKind] = useState<"OMISSION" | "SUBSTITUTION" | "QUANTITY_VARIANCE">(
    "QUANTITY_VARIANCE",
  );
  const [deviationReason, setDeviationReason] = useState("");
  const [deviationApprovedQty, setDeviationApprovedQty] = useState("600.000000");
  const [approvalId, setApprovalId] = useState("");
  const [includeDeviationOnConfirm, setIncludeDeviationOnConfirm] = useState(false);

  useEffect(() => {
    if (bakery.lastRecipeId) setRecipeId(bakery.lastRecipeId);
  }, [bakery.lastRecipeId]);

  useEffect(() => {
    if (bakery.lastOrderId) setOrderId(bakery.lastOrderId);
  }, [bakery.lastOrderId]);

  useEffect(() => {
    if (bakery.lastApprovalIds.length > 0) {
      setApprovalId(bakery.lastApprovalIds[0] ?? "");
      setIncludeDeviationOnConfirm(true);
    }
  }, [bakery.lastApprovalIds]);

  if (!canManage && !canProduce && !canRead && !canDeviate) return null;

  return (
    <section data-testid="bakery-panel" aria-label="Pastelería" className="pos-panel-section">
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
          <h3>Orden de producción</h3>
          <label>Receta <input value={recipeId} onChange={(e) => setRecipeId(e.target.value)} /></label>
          <label>Cantidad planificada <input value={plannedQty} onChange={(e) => setPlannedQty(e.target.value)} /></label>
          <button
            type="button"
            disabled={bakery.busy || recipeId.trim() === ""}
            onClick={() => bakery.createProductionOrder({
              recipeId,
              plannedQuantity: plannedQty,
            })}
          >
            Crear orden
          </button>
          <label>Orden <input value={orderId} onChange={(e) => setOrderId(e.target.value)} /></label>
          <button
            type="button"
            disabled={bakery.busy || orderId.trim() === ""}
            onClick={() => bakery.planProductionOrder(orderId)}
          >
            Planificar (verificar insumos)
          </button>
        </div>
      ) : null}

      {canDeviate ? (
        <div>
          <h3>Autorizar desviación</h3>
          <label>Orden <input value={orderId} onChange={(e) => setOrderId(e.target.value)} /></label>
          <label>Tipo
            <select
              value={deviationKind}
              onChange={(e) => setDeviationKind(e.target.value as typeof deviationKind)}
            >
              <option value="QUANTITY_VARIANCE">Variación de cantidad</option>
              <option value="SUBSTITUTION">Sustitución</option>
              <option value="OMISSION">Omisión</option>
            </select>
          </label>
          <label>Presentación receta <input value={ingPresentationId} onChange={(e) => setIngPresentationId(e.target.value)} /></label>
          <label>Cantidad aprobada <input value={deviationApprovedQty} onChange={(e) => setDeviationApprovedQty(e.target.value)} /></label>
          <label>Motivo <input value={deviationReason} onChange={(e) => setDeviationReason(e.target.value)} /></label>
          <button
            type="button"
            disabled={bakery.busy || orderId.trim() === "" || deviationReason.trim() === ""}
            onClick={() => bakery.authorizeDeviation({
              orderId,
              deviations: [{
                kind: deviationKind,
                recipePresentationId: deviationKind === "SUBSTITUTION" ? null : ingPresentationId || null,
                ingredientPresentationId: ingPresentationId || null,
                approvedQuantity: deviationApprovedQty,
                equivalenceBasis: null,
                reason: deviationReason,
              }],
            })}
          >
            Autorizar desviación
          </button>
          {approvalId ? <p>Aprobación: {approvalId}</p> : null}
        </div>
      ) : null}

      {canProduce ? (
        <div>
          <h3>Confirmar producción</h3>
          <label>Orden <input value={orderId} onChange={(e) => setOrderId(e.target.value)} /></label>
          <label>Cantidad comercial <input value={actualQty} onChange={(e) => setActualQty(e.target.value)} /></label>
          <label>Masa neta medida <input value={actualNetMass} onChange={(e) => setActualNetMass(e.target.value)} /></label>
          <label>Lote terminado <input value={batchCode} onChange={(e) => setBatchCode(e.target.value)} /></label>
          <label>Lote ingrediente <input value={lotId} onChange={(e) => setLotId(e.target.value)} /></label>
          <label>Presentación ingrediente <input value={ingPresentationId} onChange={(e) => setIngPresentationId(e.target.value)} /></label>
          <label>Cantidad planificada consumo <input value={plannedConsumptionQty} onChange={(e) => setPlannedConsumptionQty(e.target.value)} /></label>
          <label>Cantidad real consumo <input value={actualConsumptionQty} onChange={(e) => setActualConsumptionQty(e.target.value)} /></label>
          <label>
            <input
              type="checkbox"
              checked={includeDeviationOnConfirm}
              onChange={(e) => setIncludeDeviationOnConfirm(e.target.checked)}
            />
            Incluir desviación autorizada en la confirmación
          </label>
          <label>ID aprobación <input value={approvalId} onChange={(e) => setApprovalId(e.target.value)} /></label>
          <button
            type="button"
            disabled={bakery.busy || orderId.trim() === ""}
            onClick={() => bakery.confirmProduction({
              orderId,
              actualQuantity: actualQty,
              actualNetMassQuantity: actualNetMass,
              shrinkageQuantity: "0.000000",
              shrinkageReason: null,
              productionDate: new Date().toISOString().slice(0, 10),
              finishedBatchCode: batchCode,
              consumptions: [{
                ingredientPresentationId: ingPresentationId,
                lotId,
                plannedQuantity: plannedConsumptionQty,
                actualQuantity: actualConsumptionQty,
                massQuantity: actualConsumptionQty,
              }],
              recipeDeviations: includeDeviationOnConfirm && approvalId.trim() !== ""
                ? [{
                  kind: deviationKind,
                  recipePresentationId: deviationKind === "SUBSTITUTION" ? null : ingPresentationId || null,
                  ingredientPresentationId: ingPresentationId || null,
                  reason: deviationReason.trim() !== "" ? deviationReason : "AUTHORIZED_DEVIATION",
                  approvalId,
                }]
                : [],
              directCosts: [],
              shrinkageAttributions: [],
            })}
          >
            Confirmar producción
          </button>
          <button
            type="button"
            disabled={bakery.busy || orderId.trim() === ""}
            onClick={() => bakery.releaseFinishedLot(orderId)}
          >
            Liberar lote terminado
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
