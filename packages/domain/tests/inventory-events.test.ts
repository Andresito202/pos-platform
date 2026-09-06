import { describe, expect, it } from "vitest";
import {
  Actor,
  CompanyScope,
  InventoryDeducted,
  InventoryLossRecorded,
  InventoryMovement,
  InventoryReservation,
  InventoryReservationReleased,
  InventoryReserved,
  InventoryTransfer,
  InventoryTransferred,
  Quantity,
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

describe("InventoryLossRecorded.from", () => {
  it("builds the event from a WASTE movement with a reason code", () => {
    const movement = InventoryMovement.register({
      id: "018f0000-0000-7000-8000-000000000900", scope, inventoryLocationId: locationId, presentationId, lotId: null,
      movementType: "WASTE", direction: "OUT", quantity: Quantity.fromString("2"), reasonCode: "DAMAGED", occurredAt,
    });
    const event = InventoryLossRecorded.from(movement);
    expect(event.type).toBe("InventoryLossRecorded");
    expect(event.reasonCode).toBe("DAMAGED");
  });

  it("rejects a non-WASTE movement", () => {
    const movement = InventoryMovement.positiveAdjustment({
      id: "018f0000-0000-7000-8000-000000000901", scope, inventoryLocationId: locationId, presentationId, lotId: null,
      quantity: Quantity.fromString("2"), reasonCode: "PHYSICAL_COUNT_CORRECTION", occurredAt,
    });
    expect(() => InventoryLossRecorded.from(movement)).toThrow(TypeError);
  });
});

describe("InventoryReserved.from / InventoryReservationReleased.from / InventoryDeducted.from", () => {
  function reservation() {
    return InventoryReservation.create({
      id: "018f0000-0000-7000-8000-000000000950", scope, inventoryLocationId: locationId, presentationId, lotId: null,
      referenceType: "SALE_SUSPENDED", referenceId: "018f0000-0000-7000-8000-000000000960",
      quantity: Quantity.fromString("10"), expiresAt: null,
    });
  }

  it("InventoryReserved.from builds from any reservation", () => {
    const event = InventoryReserved.from(reservation());
    expect(event.type).toBe("InventoryReserved");
  });

  it("InventoryReservationReleased.from requires a RELEASED reservation", () => {
    const released = reservation().release(1);
    const event = InventoryReservationReleased.from(released);
    expect(event.type).toBe("InventoryReservationReleased");
    expect(event.releasedQuantity).toBe("10.000000");
    expect(() => InventoryReservationReleased.from(reservation())).toThrow(TypeError);
  });

  it("InventoryDeducted.from requires a (partially) consumed reservation", () => {
    const consumed = reservation().consume(Quantity.fromString("4"), 1);
    const event = InventoryDeducted.from(consumed, "4.000000");
    expect(event.type).toBe("InventoryDeducted");
    expect(() => InventoryDeducted.from(reservation(), "4")).toThrow(TypeError);
  });
});

describe("InventoryTransferred.from", () => {
  const scopeCompany = new CompanyScope(scope.tenantId, scope.companyId);
  const actor = Actor.forUser("018f0000-0000-7000-8000-000000000040");

  function transfer() {
    return InventoryTransfer.request({
      id: "018f0000-0000-7000-8000-000000000970", scope: scopeCompany,
      sourceBranchId: "018f0000-0000-7000-8000-000000000020", sourceLocationId: "018f0000-0000-7000-8000-000000000030",
      destinationBranchId: "018f0000-0000-7000-8000-000000000021", destinationLocationId: "018f0000-0000-7000-8000-000000000031",
      requestedBy: actor, requestedAt: occurredAt,
    });
  }

  it("requires a (partially) received transfer", () => {
    const received = transfer().dispatch(actor, occurredAt, 1).receive(actor, occurredAt, true, 2);
    const event = InventoryTransferred.from(received);
    expect(event.type).toBe("InventoryTransferred");
    expect(() => InventoryTransferred.from(transfer())).toThrow(TypeError);
  });
});
