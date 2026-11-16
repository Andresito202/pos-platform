import { useState } from "react";

type Outcome = string | null;

async function invoke<T>(messageType: string, payload: Record<string, unknown>): Promise<T> {
  const api = (window as unknown as {
    pos?: { invoke: (channel: string, body: unknown) => Promise<T> };
  }).pos;
  if (!api) throw new Error("POS_BRIDGE_UNAVAILABLE");
  return api.invoke(`pos:${messageType}`, {
    protocol_version: "1.0.0",
    request_id: crypto.randomUUID(),
    correlation_id: crypto.randomUUID(),
    causation_id: null,
    idempotency_key: crypto.randomUUID(),
    occurred_at: new Date().toISOString(),
    message_type: messageType,
    payload,
  });
}

export function useBakeryAdmin() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Outcome>(null);
  const [lastOutcome, setLastOutcome] = useState<Outcome>(null);
  const [traceJson, setTraceJson] = useState<string | null>(null);

  return {
    busy,
    error,
    lastOutcome,
    traceJson,
    async createRecipeDraft(input: {
      name: string;
      finishedProductId: string;
      finishedPresentationId: string;
      baseBatchQuantity: string;
      expectedYieldQuantity: string;
      expectedShrinkageQuantity: string;
      canonicalMassUnit: "G" | "KG" | null;
      lines: ReadonlyArray<{
        ingredientProductId: string;
        ingredientPresentationId: string;
        quantity: string;
        unitCode: string;
        massQuantity: string | null;
      }>;
    }) {
      setBusy(true); setError(null);
      try {
        const result = await invoke<{ result?: { outcome?: string; recipe_id?: string } }>(
          "bakery.recipe.draft.create",
          {
            recipe_family_id: null,
            name: input.name,
            finished_product_id: input.finishedProductId,
            finished_presentation_id: input.finishedPresentationId,
            base_batch_quantity: input.baseBatchQuantity,
            expected_yield_quantity: input.expectedYieldQuantity,
            expected_shrinkage_quantity: input.expectedShrinkageQuantity,
            canonical_mass_unit: input.canonicalMassUnit,
            instructions: null,
            lines: input.lines.map((line) => ({
              ingredient_product_id: line.ingredientProductId,
              ingredient_presentation_id: line.ingredientPresentationId,
              quantity: line.quantity,
              unit_code: line.unitCode,
              mass_quantity: line.massQuantity,
            })),
          },
        );
        setLastOutcome(result.result?.outcome ?? "UNKNOWN");
      } catch (err) {
        setError(err instanceof Error ? err.message : "BAKERY_ERROR");
      } finally {
        setBusy(false);
      }
    },
    async approveRecipe(input: { recipeId: string; expectedVersion: number }) {
      setBusy(true); setError(null);
      try {
        const result = await invoke<{ result?: { outcome?: string } }>("bakery.recipe.approve", {
          recipe_id: input.recipeId,
          expected_version: input.expectedVersion,
        });
        setLastOutcome(result.result?.outcome ?? "UNKNOWN");
      } catch (err) {
        setError(err instanceof Error ? err.message : "BAKERY_ERROR");
      } finally {
        setBusy(false);
      }
    },
    async confirmProduction(input: {
      orderId: string;
      actualQuantity: string;
      actualNetMassQuantity: string | null;
      shrinkageQuantity: string;
      shrinkageReason: string | null;
      productionDate: string;
      finishedBatchCode: string;
      consumptions: ReadonlyArray<{
        ingredientPresentationId: string;
        lotId: string;
        plannedQuantity: string;
        actualQuantity: string;
        massQuantity: string | null;
      }>;
      recipeDeviations?: ReadonlyArray<{
        kind: "OMISSION" | "SUBSTITUTION" | "QUANTITY_VARIANCE";
        recipePresentationId: string | null;
        ingredientPresentationId: string | null;
        reason: string;
        approvalId: string;
      }>;
      directCosts: ReadonlyArray<{ costKind: string; amount: string; sourceNote: string }>;
      shrinkageAttributions: ReadonlyArray<{
        presentationId: string; lotId: string; quantity: string; massQuantity: string | null;
      }>;
    }) {
      setBusy(true); setError(null);
      try {
        const result = await invoke<{ result?: { outcome?: string } }>("bakery.production.confirm", {
          order_id: input.orderId,
          actual_quantity: input.actualQuantity,
          actual_net_mass_quantity: input.actualNetMassQuantity,
          shrinkage_quantity: input.shrinkageQuantity,
          shrinkage_reason: input.shrinkageReason,
          production_date: input.productionDate,
          finished_batch_code: input.finishedBatchCode,
          consumptions: input.consumptions.map((line) => ({
            ingredient_presentation_id: line.ingredientPresentationId,
            lot_id: line.lotId,
            planned_quantity: line.plannedQuantity,
            actual_quantity: line.actualQuantity,
            mass_quantity: line.massQuantity,
          })),
          recipe_deviations: (input.recipeDeviations ?? []).map((line) => ({
            kind: line.kind,
            recipe_presentation_id: line.recipePresentationId,
            ingredient_presentation_id: line.ingredientPresentationId,
            reason: line.reason,
            approval_id: line.approvalId,
          })),
          direct_costs: input.directCosts.map((line) => ({
            cost_kind: line.costKind,
            amount: line.amount,
            source_note: line.sourceNote,
          })),
          shrinkage_attributions: input.shrinkageAttributions.map((line) => ({
            presentation_id: line.presentationId,
            lot_id: line.lotId,
            quantity: line.quantity,
            mass_quantity: line.massQuantity,
          })),
        });
        setLastOutcome(result.result?.outcome ?? "UNKNOWN");
      } catch (err) {
        setError(err instanceof Error ? err.message : "BAKERY_ERROR");
      } finally {
        setBusy(false);
      }
    },
    async getTrace(orderId: string) {
      setBusy(true); setError(null);
      try {
        const result = await invoke<{ result?: unknown }>("bakery.production.trace.get", {
          order_id: orderId,
        });
        setTraceJson(JSON.stringify(result.result ?? {}, null, 2));
        setLastOutcome("TRACE");
      } catch (err) {
        setError(err instanceof Error ? err.message : "BAKERY_ERROR");
      } finally {
        setBusy(false);
      }
    },
  };
}
