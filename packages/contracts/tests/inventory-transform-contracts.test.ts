import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  CatalogFoodPolicyUpsertRequestSchema,
  CatalogPresentationRegisterRequestSchema,
  InventoryTransformExecuteRequestSchema,
  InventoryTransformExecuteResultSchema,
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

describe("prompt-5 commercial contracts", () => {
  it("accepts presentation register, food policy and transform execute envelopes", () => {
    expect(IpcMessageTypeSchema.options).toContain("catalog.presentation.register");
    expect(IpcMessageTypeSchema.options).toContain("catalog.food_policy.upsert");
    expect(IpcMessageTypeSchema.options).toContain("inventory.transform.execute");

    expect(CatalogPresentationRegisterRequestSchema.parse({
      ...base,
      message_type: "catalog.presentation.register",
      payload: {
        product_id: randomUUID(),
        presentation_name: "Kilogramo",
        unit_code: "KGM",
        unit_precision: 3,
        barcode: "7701234567890",
        price_amount: "9500.000000",
        currency_code: "COP",
      },
    }).message_type).toBe("catalog.presentation.register");

    expect(CatalogFoodPolicyUpsertRequestSchema.parse({
      ...base,
      message_type: "catalog.food_policy.upsert",
      payload: {
        product_id: randomUUID(),
        conservation_code: "CHILLED",
        requires_lot_tracking: true,
        requires_expiry: true,
        notes: null,
      },
    }).payload.conservation_code).toBe("CHILLED");

    const parsed = InventoryTransformExecuteRequestSchema.parse({
      ...base,
      message_type: "inventory.transform.execute",
      payload: {
        reason_code: "BUTCHER_BREAKDOWN",
        business_date: "2026-09-07",
        canonical_mass_unit: "KG",
        inputs: [{
          presentation_id: randomUUID(),
          lot_id: randomUUID(),
          quantity: "1.000000",
          mass_quantity: "2.000000",
        }],
        outputs: [{
          presentation_id: randomUUID(),
          quantity: "1.800000",
          mass_quantity: "1.800000",
          batch_code: "LOT-OUT-1",
        }],
        shrinkage: [{
          presentation_id: randomUUID(),
          lot_id: randomUUID(),
          quantity: "1.000000",
          mass_quantity: "0.200000",
        }],
      },
    });
    expect(parsed.payload.outputs).toHaveLength(1);
    expect(InventoryTransformExecuteResultSchema.shape.outcome.options)
      .toContain("UNIT_EQUIVALENCE_FAILED");
  });

  it("rejects caller-asserted identity on transform execute", () => {
    expect(() => InventoryTransformExecuteRequestSchema.parse({
      ...base,
      message_type: "inventory.transform.execute",
      actor_type: "USER",
      payload: {
        reason_code: "BUTCHER_BREAKDOWN",
        business_date: "2026-09-07",
        canonical_mass_unit: null,
        inputs: [{
          presentation_id: randomUUID(),
          lot_id: randomUUID(),
          quantity: "1.000000",
          mass_quantity: null,
        }],
        outputs: [{
          presentation_id: randomUUID(),
          quantity: "1.000000",
          mass_quantity: null,
          batch_code: "LOT-OUT-1",
        }],
        shrinkage: [],
      },
    })).toThrow();
  });
});
