import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  BakeryProductionOrderCreateRequestSchema,
  BakeryProductionOrderPlanRequestSchema,
  BakeryProductionReleaseRequestSchema,
  BakeryProductionConfirmRequestSchema,
  IpcMessageTypeSchema,
} from "../src/index.js";

const base = {
  protocol_version: "1.0.0" as const,
  payload_schema_version: "1.0.0" as const,
  request_id: randomUUID(),
  correlation_id: randomUUID(),
  operation_id: randomUUID(),
  idempotency_key: randomUUID(),
};

describe("bloque-4 bakery production IPC contracts", () => {
  it("exposes create/plan/release message types and accepts envelopes", () => {
    expect(IpcMessageTypeSchema.options).toContain("bakery.production.order.create");
    expect(IpcMessageTypeSchema.options).toContain("bakery.production.order.plan");
    expect(IpcMessageTypeSchema.options).toContain("bakery.production.release");

    expect(BakeryProductionOrderCreateRequestSchema.parse({
      ...base,
      message_type: "bakery.production.order.create",
      payload: {
        recipe_id: randomUUID(),
        planned_quantity: "1000.000000",
      },
    }).payload.planned_quantity).toBe("1000.000000");

    expect(BakeryProductionOrderPlanRequestSchema.parse({
      ...base,
      message_type: "bakery.production.order.plan",
      payload: { order_id: randomUUID() },
    }).payload.order_id).toMatch(/-/);

    expect(BakeryProductionReleaseRequestSchema.parse({
      ...base,
      message_type: "bakery.production.release",
      payload: { order_id: randomUUID() },
    }).message_type).toBe("bakery.production.release");
  });

  it("keeps confirm deviations optional but structured when present", () => {
    const parsed = BakeryProductionConfirmRequestSchema.parse({
      ...base,
      message_type: "bakery.production.confirm",
      payload: {
        order_id: randomUUID(),
        actual_quantity: "900.000000",
        actual_net_mass_quantity: "900.000000",
        shrinkage_quantity: "0.000000",
        shrinkage_reason: null,
        production_date: "2026-11-17",
        finished_batch_code: "BATCH-1",
        consumptions: [{
          ingredient_presentation_id: randomUUID(),
          lot_id: randomUUID(),
          planned_quantity: "600.000000",
          actual_quantity: "600.000000",
          mass_quantity: "600.000000",
        }],
        recipe_deviations: [{
          kind: "QUANTITY_VARIANCE",
          recipe_presentation_id: randomUUID(),
          ingredient_presentation_id: randomUUID(),
          reason: "authorized variance",
          approval_id: randomUUID(),
        }],
        direct_costs: [],
        shrinkage_attributions: [],
      },
    });
    expect(parsed.payload.recipe_deviations).toHaveLength(1);
  });
});
