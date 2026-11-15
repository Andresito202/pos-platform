import { useState } from "react";
import { useInventoryTransform } from "../hooks/useInventoryTransform.js";

/**
 * Despiece / transformación sobre el inventario compartido.
 * Solo administrador con `INVENTORY_STOCK_ADJUST`. No inventa stock ni porcentajes.
 */
export function InventoryTransformPanel({ businessDate }: {
  businessDate: string;
}): React.JSX.Element {
  const transform = useInventoryTransform();
  const [reasonCode, setReasonCode] = useState("BUTCHER_BREAKDOWN");
  const [massUnit, setMassUnit] = useState<"" | "G" | "KG">("KG");
  const [inputPresentationId, setInputPresentationId] = useState("");
  const [inputLotId, setInputLotId] = useState("");
  const [inputQuantity, setInputQuantity] = useState("");
  const [inputMass, setInputMass] = useState("");
  const [outputPresentationId, setOutputPresentationId] = useState("");
  const [outputQuantity, setOutputQuantity] = useState("");
  const [outputMass, setOutputMass] = useState("");
  const [outputBatch, setOutputBatch] = useState("");
  const [shrinkLotId, setShrinkLotId] = useState("");
  const [shrinkQuantity, setShrinkQuantity] = useState("");
  const [shrinkMass, setShrinkMass] = useState("");

  return (
    <section data-testid="inventory-transform-panel">
      <h3>Despiece / transformación</h3>
      <p>Una sola transacción. Si falla una salida, se revierte el consumo. La merma documenta masa ya consumida; no descuenta de nuevo. Sin masa medida solo se admite conservación exacta de la misma unidad.</p>
      <div className="pos-form-grid">
        <label className="pos-field">Motivo
          <input data-testid="transform-reason" aria-label="Motivo de transformación"
            value={reasonCode} disabled={transform.busy}
            onChange={(event) => setReasonCode(event.target.value)} />
        </label>
        <label className="pos-field">Unidad de masa canónica
          <select data-testid="transform-mass-unit" aria-label="Unidad de masa canónica"
            value={massUnit} disabled={transform.busy}
            onChange={(event) => setMassUnit(event.target.value as typeof massUnit)}>
            <option value="">Sin conciliación de masa</option>
            <option value="KG">Kilogramo</option>
            <option value="G">Gramo</option>
          </select>
        </label>
        <label className="pos-field">Presentación de entrada
          <input data-testid="transform-input-presentation" value={inputPresentationId}
            disabled={transform.busy} onChange={(event) => setInputPresentationId(event.target.value)} />
        </label>
        <label className="pos-field">Lote de entrada
          <input data-testid="transform-input-lot" value={inputLotId}
            disabled={transform.busy} onChange={(event) => setInputLotId(event.target.value)} />
        </label>
        <label className="pos-field">Cantidad de entrada
          <input data-testid="transform-input-quantity" value={inputQuantity}
            disabled={transform.busy} onChange={(event) => setInputQuantity(event.target.value)} />
        </label>
        <label className="pos-field">Masa de entrada
          <input data-testid="transform-input-mass" value={inputMass}
            disabled={transform.busy || massUnit === ""}
            onChange={(event) => setInputMass(event.target.value)} />
        </label>
        <label className="pos-field">Presentación de salida
          <input data-testid="transform-output-presentation" value={outputPresentationId}
            disabled={transform.busy} onChange={(event) => setOutputPresentationId(event.target.value)} />
        </label>
        <label className="pos-field">Cantidad de salida
          <input data-testid="transform-output-quantity" value={outputQuantity}
            disabled={transform.busy} onChange={(event) => setOutputQuantity(event.target.value)} />
        </label>
        <label className="pos-field">Masa de salida
          <input data-testid="transform-output-mass" value={outputMass}
            disabled={transform.busy || massUnit === ""}
            onChange={(event) => setOutputMass(event.target.value)} />
        </label>
        <label className="pos-field">Código de lote resultante
          <input data-testid="transform-output-batch" value={outputBatch}
            disabled={transform.busy} onChange={(event) => setOutputBatch(event.target.value)} />
        </label>
        <label className="pos-field">Lote de merma (opcional)
          <input data-testid="transform-shrink-lot" value={shrinkLotId}
            disabled={transform.busy} onChange={(event) => setShrinkLotId(event.target.value)} />
        </label>
        <label className="pos-field">Cantidad de merma
          <input data-testid="transform-shrink-quantity" value={shrinkQuantity}
            disabled={transform.busy} onChange={(event) => setShrinkQuantity(event.target.value)} />
        </label>
        <label className="pos-field">Masa de merma
          <input data-testid="transform-shrink-mass" value={shrinkMass}
            disabled={transform.busy || massUnit === ""}
            onChange={(event) => setShrinkMass(event.target.value)} />
        </label>
        <button data-testid="transform-execute-button"
          disabled={transform.busy || inputPresentationId.trim() === "" || inputLotId.trim() === ""
            || inputQuantity.trim() === "" || outputPresentationId.trim() === ""
            || outputQuantity.trim() === "" || outputBatch.trim() === ""}
          onClick={() => {
            const shrinkage = shrinkLotId.trim() === "" || shrinkQuantity.trim() === ""
              ? []
              : [{
                presentationId: inputPresentationId,
                lotId: shrinkLotId,
                quantity: shrinkQuantity,
                massQuantity: shrinkMass,
                batchCode: "",
              }];
            void transform.execute({
              reasonCode: reasonCode.trim(),
              businessDate,
              canonicalMassUnit: massUnit === "" ? null : massUnit,
              inputs: [{
                presentationId: inputPresentationId,
                lotId: inputLotId,
                quantity: inputQuantity,
                massQuantity: inputMass,
                batchCode: "",
              }],
              outputs: [{
                presentationId: outputPresentationId,
                lotId: "",
                quantity: outputQuantity,
                massQuantity: outputMass,
                batchCode: outputBatch,
              }],
              shrinkage,
            });
          }}>Ejecutar transformación</button>
      </div>
      {transform.outcome !== null && (
        <div data-testid="transform-outcome">{transform.outcome}
          {transform.orderId ? ` ${transform.orderId}` : ""}</div>
      )}
      {transform.error !== null && <div data-testid="transform-error">{transform.error}</div>}
    </section>
  );
}
