import { describe, expect, it } from "vitest";
import { InventoryDomainError, InventoryReservation, Quantity, TenantScope } from "../src/index.js";

const scope = new TenantScope(
  "018f0000-0000-7000-8000-000000000010",
  "018f0000-0000-7000-8000-000000000011",
  "018f0000-0000-7000-8000-000000000012",
);
const locationId = "018f0000-0000-7000-8000-000000000070";
const presentationId = "018f0000-0000-7000-8000-000000000080";

function baseInput(overrides: Partial<Parameters<typeof InventoryReservation.create>[0]> = {}) {
  return {
    id: "018f0000-0000-7000-8000-000000000950",
    scope,
    inventoryLocationId: locationId,
    presentationId,
    lotId: null,
    referenceType: "SALE_SUSPENDED",
    referenceId: "018f0000-0000-7000-8000-000000000960",
    quantity: Quantity.fromString("10"),
    expiresAt: null,
    ...overrides,
  };
}

describe("InventoryReservation.create", () => {
  it("starts ACTIVE, version 1, zero consumed/released", () => {
    const reservation = InventoryReservation.create(baseInput());
    expect(reservation.status).toBe("ACTIVE");
    expect(reservation.version).toBe(1);
    expect(reservation.consumedQuantity.toString()).toBe("0.000000");
    expect(reservation.releasedQuantity.toString()).toBe("0.000000");
    expect(reservation.outstandingQuantity().toString()).toBe("10.000000");
  });

  it("rejects a non-positive quantity", () => {
    expect(() => InventoryReservation.create(baseInput({ quantity: Quantity.zero() }))).toThrow(InventoryDomainError);
  });
});

describe("InventoryReservation.consume", () => {
  it("partial consumption transitions to PARTIALLY_CONSUMED", () => {
    const reservation = InventoryReservation.create(baseInput());
    const consumed = reservation.consume(Quantity.fromString("4"), 1);
    expect(consumed.status).toBe("PARTIALLY_CONSUMED");
    expect(consumed.consumedQuantity.toString()).toBe("4.000000");
    expect(consumed.outstandingQuantity().toString()).toBe("6.000000");
    expect(consumed.version).toBe(2);
  });

  it("full consumption transitions to CONSUMED", () => {
    const reservation = InventoryReservation.create(baseInput());
    const consumed = reservation.consume(Quantity.fromString("10"), 1);
    expect(consumed.status).toBe("CONSUMED");
    expect(consumed.outstandingQuantity().toString()).toBe("0.000000");
  });

  it("multiple partial consumptions accumulate to CONSUMED", () => {
    const reservation = InventoryReservation.create(baseInput());
    const first = reservation.consume(Quantity.fromString("4"), 1);
    const second = first.consume(Quantity.fromString("6"), 2);
    expect(second.status).toBe("CONSUMED");
    expect(second.consumedQuantity.toString()).toBe("10.000000");
  });

  it("rejects consuming more than the outstanding quantity", () => {
    const reservation = InventoryReservation.create(baseInput());
    expect(() => reservation.consume(Quantity.fromString("11"), 1)).toThrow(InventoryDomainError);
  });

  it("rejects consuming an already CONSUMED reservation — no double consumption", () => {
    const reservation = InventoryReservation.create(baseInput()).consume(Quantity.fromString("10"), 1);
    expect(() => reservation.consume(Quantity.fromString("1"), 2)).toThrow(InventoryDomainError);
  });

  it("rejects consuming a RELEASED reservation", () => {
    const reservation = InventoryReservation.create(baseInput()).release(1);
    expect(() => reservation.consume(Quantity.fromString("1"), 2)).toThrow(InventoryDomainError);
  });

  it("rejects a version conflict", () => {
    const reservation = InventoryReservation.create(baseInput());
    expect(() => reservation.consume(Quantity.fromString("1"), 99)).toThrow(InventoryDomainError);
  });
});

describe("InventoryReservation.release", () => {
  it("releases the full remaining quantity of an ACTIVE reservation", () => {
    const reservation = InventoryReservation.create(baseInput());
    const released = reservation.release(1);
    expect(released.status).toBe("RELEASED");
    expect(released.releasedQuantity.toString()).toBe("10.000000");
    expect(released.outstandingQuantity().toString()).toBe("0.000000");
  });

  it("releases only the not-yet-consumed remainder of a PARTIALLY_CONSUMED reservation", () => {
    const reservation = InventoryReservation.create(baseInput()).consume(Quantity.fromString("4"), 1);
    const released = reservation.release(2);
    expect(released.status).toBe("RELEASED");
    expect(released.consumedQuantity.toString()).toBe("4.000000");
    expect(released.releasedQuantity.toString()).toBe("6.000000");
  });

  it("EXPIRED reservations remain releasable — expiry alone does not release capacity", () => {
    const reservation = InventoryReservation.create(baseInput()).expire(1);
    const released = reservation.release(2);
    expect(released.status).toBe("RELEASED");
    expect(released.releasedQuantity.toString()).toBe("10.000000");
  });

  it("rejects releasing an already RELEASED reservation", () => {
    const reservation = InventoryReservation.create(baseInput()).release(1);
    expect(() => reservation.release(2)).toThrow(InventoryDomainError);
  });
});

describe("InventoryReservation.expire", () => {
  it("marks EXPIRED without touching consumed/released quantities", () => {
    const reservation = InventoryReservation.create(baseInput());
    const expired = reservation.expire(1);
    expect(expired.status).toBe("EXPIRED");
    expect(expired.releasedQuantity.toString()).toBe("0.000000");
    // still outstanding — a separate release() is required to free capacity (UC-INVENTORY-002 regla 4).
    expect(expired.outstandingQuantity().toString()).toBe("10.000000");
  });

  it("rejects expiring an already EXPIRED reservation", () => {
    const reservation = InventoryReservation.create(baseInput()).expire(1);
    expect(() => reservation.expire(2)).toThrow(InventoryDomainError);
  });
});

describe("InventoryReservation.restore", () => {
  it("reconstructs a reservation without re-validating invariants", () => {
    const restored = InventoryReservation.restore({
      ...baseInput(),
      consumedQuantity: Quantity.fromString("3"),
      releasedQuantity: Quantity.zero(),
      status: "PARTIALLY_CONSUMED",
      version: 2,
    });
    expect(restored.status).toBe("PARTIALLY_CONSUMED");
    expect(restored.version).toBe(2);
    expect(restored.consumedQuantity.toString()).toBe("3.000000");
  });
});
