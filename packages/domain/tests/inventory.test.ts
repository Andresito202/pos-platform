import { describe, expect, it } from "vitest";
import {
  InventoryAdjusted,
  InventoryDomainError,
  InventoryMovement,
  Quantity,
  TenantScope,
  calculateOnHandQuantity,
  roleMayAdjustInventory,
  roleMayConsumeInventoryReservation,
  roleMayRegisterWaste,
  roleMayReleaseInventoryReservation,
  roleMayReserveInventory,
  roleMayTransferInventory,
  type Role,
} from "../src/index.js";

const scope = new TenantScope(
  "018f0000-0000-7000-8000-000000000010",
  "018f0000-0000-7000-8000-000000000011",
  "018f0000-0000-7000-8000-000000000012",
);
const locationId = "018f0000-0000-7000-8000-000000000070";
const presentationId = "018f0000-0000-7000-8000-000000000080";
const occurredAt = new Date("2026-09-03T08:00:00Z");

function baseInput(overrides: Partial<Parameters<typeof InventoryMovement.positiveAdjustment>[0]> = {}) {
  return {
    id: "018f0000-0000-7000-8000-000000000900",
    scope,
    inventoryLocationId: locationId,
    presentationId,
    lotId: null,
    quantity: Quantity.fromString("5"),
    reasonCode: "PHYSICAL_COUNT_CORRECTION",
    occurredAt,
    ...overrides,
  };
}

describe("InventoryMovement.register", () => {
  it("accepts a movement with a strictly positive quantity", () => {
    const movement = InventoryMovement.register({
      ...baseInput(),
      movementType: "WASTE",
      direction: "OUT",
      reasonCode: "DAMAGED",
    });
    expect(movement.status).toBe("POSTED");
    expect(movement.quantity.toString()).toBe("5.000000");
  });

  it("rejects a zero quantity", () => {
    expect(() =>
      InventoryMovement.register({ ...baseInput({ quantity: Quantity.zero() }), movementType: "WASTE", direction: "OUT" }),
    ).toThrow(InventoryDomainError);
  });

  it("rejects a negative quantity — direction, not sign, encodes IN/OUT", () => {
    expect(() =>
      InventoryMovement.register({
        ...baseInput({ quantity: Quantity.fromString("-1") }),
        movementType: "WASTE",
        direction: "OUT",
      }),
    ).toThrow(InventoryDomainError);
  });
});

describe("InventoryMovement.positiveAdjustment / negativeAdjustment", () => {
  it("creates a POSITIVE_ADJUSTMENT with direction IN", () => {
    const movement = InventoryMovement.positiveAdjustment(baseInput());
    expect(movement.movementType).toBe("POSITIVE_ADJUSTMENT");
    expect(movement.direction).toBe("IN");
  });

  it("creates a NEGATIVE_ADJUSTMENT with direction OUT", () => {
    const movement = InventoryMovement.negativeAdjustment(baseInput());
    expect(movement.movementType).toBe("NEGATIVE_ADJUSTMENT");
    expect(movement.direction).toBe("OUT");
  });

  it("rejects an empty reason code on a positive adjustment", () => {
    expect(() => InventoryMovement.positiveAdjustment(baseInput({ reasonCode: "" }))).toThrow(InventoryDomainError);
  });

  it("rejects a whitespace-only reason code on a negative adjustment", () => {
    expect(() => InventoryMovement.negativeAdjustment(baseInput({ reasonCode: "   " }))).toThrow(InventoryDomainError);
  });

  it("accepts lotId as given, without enforcing a lot-control policy this repository cannot resolve", () => {
    const movement = InventoryMovement.positiveAdjustment(baseInput({ lotId: "018f0000-0000-7000-8000-0000000000a1" }));
    expect(movement.lotId).toBe("018f0000-0000-7000-8000-0000000000a1");

    const withoutLot = InventoryMovement.positiveAdjustment(baseInput({ lotId: null }));
    expect(withoutLot.lotId).toBeNull();
  });
});

describe("InventoryMovement.signedQuantity", () => {
  it("is positive for IN, negative for OUT", () => {
    const inMovement = InventoryMovement.positiveAdjustment(baseInput());
    const outMovement = InventoryMovement.negativeAdjustment(baseInput());
    expect(inMovement.signedQuantity().toString()).toBe("5.000000");
    expect(outMovement.signedQuantity().toString()).toBe("-5.000000");
  });
});

describe("calculateOnHandQuantity", () => {
  it("is zero for no movements", () => {
    expect(calculateOnHandQuantity([]).toString()).toBe("0.000000");
  });

  it("folds POSITIVE_ADJUSTMENT and NEGATIVE_ADJUSTMENT into a net on-hand quantity", () => {
    const gain = InventoryMovement.positiveAdjustment(baseInput({ quantity: Quantity.fromString("10") }));
    const loss = InventoryMovement.negativeAdjustment(baseInput({ quantity: Quantity.fromString("3") }));
    expect(calculateOnHandQuantity([gain, loss]).toString()).toBe("7.000000");
  });

  it("can fold to a negative result — this fold does not itself reject negative stock (policy-decided, undefined)", () => {
    const loss = InventoryMovement.negativeAdjustment(baseInput({ quantity: Quantity.fromString("10") }));
    expect(calculateOnHandQuantity([loss]).toString()).toBe("-10.000000");
  });
});

describe("InventoryAdjusted.from", () => {
  it("builds the event from a POSITIVE_ADJUSTMENT movement", () => {
    const movement = InventoryMovement.positiveAdjustment(baseInput());
    const event = InventoryAdjusted.from(movement);
    expect(event.type).toBe("InventoryAdjusted");
    expect(event.movementId).toBe(movement.id);
    expect(event.movementType).toBe("POSITIVE_ADJUSTMENT");
  });

  it("rejects a non-adjustment movement", () => {
    const waste = InventoryMovement.register({ ...baseInput(), movementType: "WASTE", direction: "OUT" });
    expect(() => InventoryAdjusted.from(waste)).toThrow(TypeError);
  });
});

describe("roleMayAdjustInventory", () => {
  const allowed: Role[] = ["OWNER", "GENERAL_ADMIN"];
  const denied: Role[] = ["BRANCH_MANAGER", "SUPERVISOR", "INVENTORY_OPERATOR", "CASHIER", "CUSTOMER"];

  it.each(allowed)("allows %s (unconditional 'Sí')", (role) => {
    expect(roleMayAdjustInventory(role)).toBe(true);
  });

  it.each(denied)("fails closed for %s (Condicional, Autorizar, or No — no policy resolves the condition)", (role) => {
    expect(roleMayAdjustInventory(role)).toBe(false);
  });
});

describe("roleMayRegisterWaste — a DIFFERENT permission-matrix row from Ajuste (B31)", () => {
  const allowed: Role[] = ["OWNER", "GENERAL_ADMIN", "BRANCH_MANAGER", "SUPERVISOR", "INVENTORY_OPERATOR"];
  const denied: Role[] = ["CASHIER", "CUSTOMER"];

  it.each(allowed)("allows %s (unconditional 'Sí' for Merma)", (role) => {
    expect(roleMayRegisterWaste(role)).toBe(true);
  });

  it.each(denied)("fails closed for %s", (role) => {
    expect(roleMayRegisterWaste(role)).toBe(false);
  });
});

describe("roleMayTransferInventory — a DIFFERENT permission-matrix row from both Ajuste and Merma (B31)", () => {
  const allowed: Role[] = ["OWNER", "GENERAL_ADMIN", "INVENTORY_OPERATOR"];
  const denied: Role[] = ["BRANCH_MANAGER", "SUPERVISOR", "CASHIER", "CUSTOMER"];

  it.each(allowed)("allows %s (unconditional 'Sí' for Traslado — INVENTORY_OPERATOR unlike Ajuste's 'Condicional')", (role) => {
    expect(roleMayTransferInventory(role)).toBe(true);
  });

  it.each(denied)("fails closed for %s", (role) => {
    expect(roleMayTransferInventory(role)).toBe(false);
  });
});

describe("Reserve/Consume/Release authorization — B31 ARCHITECTURAL DECISION: no permission-matrix row, fails closed for every role", () => {
  const everyRole: Role[] = ["OWNER", "GENERAL_ADMIN", "BRANCH_MANAGER", "SUPERVISOR", "INVENTORY_OPERATOR", "CASHIER", "CUSTOMER"];

  it.each(everyRole)("roleMayReserveInventory fails closed for %s", (role) => {
    expect(roleMayReserveInventory(role)).toBe(false);
  });

  it.each(everyRole)("roleMayConsumeInventoryReservation fails closed for %s", (role) => {
    expect(roleMayConsumeInventoryReservation(role)).toBe(false);
  });

  it.each(everyRole)("roleMayReleaseInventoryReservation fails closed for %s", (role) => {
    expect(roleMayReleaseInventoryReservation(role)).toBe(false);
  });
});
