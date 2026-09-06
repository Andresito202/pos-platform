import { describe, expect, it } from "vitest";
import {
  InventoryMovement,
  InventoryReservation,
  Quantity,
  StockBalance,
  TenantScope,
} from "../src/index.js";

const scope = new TenantScope(
  "018f0000-0000-7000-8000-000000000010",
  "018f0000-0000-7000-8000-000000000011",
  "018f0000-0000-7000-8000-000000000012",
);
const locationId = "018f0000-0000-7000-8000-000000000070";
const presentationId = "018f0000-0000-7000-8000-000000000080";
const occurredAt = new Date("2026-09-03T08:00:00Z");

let movementCounter = 0;
function movement(quantity: string, type: "POSITIVE_ADJUSTMENT" | "NEGATIVE_ADJUSTMENT") {
  movementCounter += 1;
  const build = type === "POSITIVE_ADJUSTMENT" ? InventoryMovement.positiveAdjustment : InventoryMovement.negativeAdjustment;
  return build({
    id: `018f0000-0000-7000-8000-${movementCounter.toString().padStart(12, "0")}`,
    scope, inventoryLocationId: locationId, presentationId, lotId: null,
    quantity: Quantity.fromString(quantity), reasonCode: "PHYSICAL_COUNT_CORRECTION", occurredAt,
  });
}

let reservationCounter = 0;
function reservation(quantity: string, status: "ACTIVE" | "PARTIALLY_CONSUMED" | "CONSUMED" | "RELEASED" | "EXPIRED" = "ACTIVE") {
  reservationCounter += 1;
  const created = InventoryReservation.create({
    id: `018f0000-0000-7000-8000-0000009${reservationCounter.toString().padStart(5, "0")}`,
    scope, inventoryLocationId: locationId, presentationId, lotId: null,
    referenceType: "SALE_SUSPENDED", referenceId: "018f0000-0000-7000-8000-000000000960",
    quantity: Quantity.fromString(quantity), expiresAt: null,
  });
  if (status === "ACTIVE") return created;
  if (status === "RELEASED") return created.release(1);
  if (status === "EXPIRED") return created.expire(1);
  if (status === "PARTIALLY_CONSUMED") return created.consume(Quantity.fromString("1"), 1);
  return created.consume(Quantity.fromString(quantity), 1);
}

describe("StockBalance.compute", () => {
  it("onHand folds posted movements exactly like calculateOnHandQuantity", () => {
    const balance = StockBalance.compute([movement("10", "POSITIVE_ADJUSTMENT"), movement("3", "NEGATIVE_ADJUSTMENT")], []);
    expect(balance.onHandQuantity.toString()).toBe("7.000000");
  });

  it("reserved sums outstandingQuantity() across every reservation regardless of status — the math zeroes out RELEASED/CONSUMED on its own", () => {
    const active = reservation("4", "ACTIVE");
    const partiallyConsumed = reservation("6", "PARTIALLY_CONSUMED"); // outstanding = 6 - 1 = 5
    const released = reservation("2", "RELEASED");
    const expired = reservation("3", "EXPIRED"); // still outstanding — not released yet

    const balance = StockBalance.compute([], [active, partiallyConsumed, released, expired]);
    expect(balance.reservedQuantity.toString()).toBe("12.000000"); // 4 + 5 + 3
  });

  it("EXPIRED still counts as reserved until an explicit release", () => {
    const expired = reservation("5", "EXPIRED");
    const balance = StockBalance.compute([], [expired]);
    expect(balance.reservedQuantity.toString()).toBe("5.000000");
  });

  it("RELEASED and fully CONSUMED no longer count toward reserved", () => {
    const released = reservation("5", "RELEASED");
    const consumed = reservation("5", "CONSUMED");
    const balance = StockBalance.compute([], [released, consumed]);
    expect(balance.reservedQuantity.toString()).toBe("0.000000");
  });

  it("availableQuantity is onHand minus reserved", () => {
    const balance = StockBalance.compute([movement("10", "POSITIVE_ADJUSTMENT")], [reservation("4", "ACTIVE")]);
    expect(balance.availableQuantity().toString()).toBe("6.000000");
  });
});
