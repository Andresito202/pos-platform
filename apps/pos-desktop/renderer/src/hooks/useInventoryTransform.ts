import { useCallback, useState } from "react";
import type { InventoryTransformExecuteResult } from "@pos-platform/contracts";
import { callCommercial, newIdempotencyKey } from "../pos-service.js";
import { toScale6 } from "../scale6.js";

export interface TransformLineDraft {
  readonly presentationId: string;
  readonly lotId: string;
  readonly quantity: string;
  readonly massQuantity: string;
  readonly batchCode: string;
}

export function useInventoryTransform() {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<InventoryTransformExecuteResult["outcome"] | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(async (input: {
    reasonCode: string;
    businessDate: string;
    canonicalMassUnit: "G" | "KG" | null;
    inputs: readonly TransformLineDraft[];
    outputs: readonly TransformLineDraft[];
    shrinkage: readonly TransformLineDraft[];
  }): Promise<void> => {
    setBusy(true);
    setError(null);
    setOutcome(null);
    setOrderId(null);
    try {
      const scale = (raw: string): string | null => toScale6(raw);
      const mapInput = (line: TransformLineDraft) => {
        const quantity = scale(line.quantity);
        if (quantity === null) return null;
        const mass = line.massQuantity.trim() === "" ? null : scale(line.massQuantity);
        if (line.massQuantity.trim() !== "" && mass === null) return null;
        return {
          presentation_id: line.presentationId.trim(),
          lot_id: line.lotId.trim(),
          quantity,
          mass_quantity: mass,
        };
      };
      const mapOutput = (line: TransformLineDraft) => {
        const quantity = scale(line.quantity);
        if (quantity === null) return null;
        const mass = line.massQuantity.trim() === "" ? null : scale(line.massQuantity);
        if (line.massQuantity.trim() !== "" && mass === null) return null;
        return {
          presentation_id: line.presentationId.trim(),
          quantity,
          mass_quantity: mass,
          batch_code: line.batchCode.trim(),
        };
      };
      const inputs = input.inputs.map(mapInput);
      const outputs = input.outputs.map(mapOutput);
      const shrinkage = input.shrinkage.map(mapInput);
      if (inputs.some((line) => line === null) || outputs.some((line) => line === null) || shrinkage.some((line) => line === null)) {
        setError("QUANTITY_NOT_SCALE6");
        return;
      }
      const response = await callCommercial<InventoryTransformExecuteResult>(
        "inventory.transform.execute",
        {
          reason_code: input.reasonCode,
          business_date: input.businessDate,
          canonical_mass_unit: input.canonicalMassUnit,
          inputs,
          outputs,
          shrinkage,
        },
        newIdempotencyKey(),
      );
      if (response.result === null) {
        setError(response.result_code);
        return;
      }
      setOutcome(response.result.outcome);
      setOrderId(response.result.order_id);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      setBusy(false);
    }
  }, []);

  return { busy, outcome, orderId, error, execute };
}
