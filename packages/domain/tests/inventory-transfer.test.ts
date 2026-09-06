import { describe, expect, it } from "vitest";
import { Actor, CompanyScope, InventoryDomainError, InventoryTransfer, InventoryTransferLine, Quantity } from "../src/index.js";

const scope = new CompanyScope("018f0000-0000-7000-8000-000000000010", "018f0000-0000-7000-8000-000000000011");
const sourceBranchId = "018f0000-0000-7000-8000-000000000020";
const sourceLocationId = "018f0000-0000-7000-8000-000000000030";
const destinationBranchId = "018f0000-0000-7000-8000-000000000021";
const destinationLocationId = "018f0000-0000-7000-8000-000000000031";
const actor = Actor.forUser("018f0000-0000-7000-8000-000000000040");
const requestedAt = new Date("2026-09-03T08:00:00Z");

function requestInput(overrides: Partial<Parameters<typeof InventoryTransfer.request>[0]> = {}) {
  return {
    id: "018f0000-0000-7000-8000-000000000970",
    scope, sourceBranchId, sourceLocationId, destinationBranchId, destinationLocationId,
    requestedBy: actor, requestedAt,
    ...overrides,
  };
}

describe("InventoryTransfer.request", () => {
  it("starts REQUESTED, version 1", () => {
    const transfer = InventoryTransfer.request(requestInput());
    expect(transfer.status).toBe("REQUESTED");
    expect(transfer.version).toBe(1);
  });

  it("rejects source === destination location", () => {
    expect(() => InventoryTransfer.request(requestInput({ destinationLocationId: sourceLocationId }))).toThrow(InventoryDomainError);
  });
});

describe("InventoryTransfer lifecycle", () => {
  it("dispatch skips APPROVED when called directly from REQUESTED (approval is conditional, not mandatory)", () => {
    const transfer = InventoryTransfer.request(requestInput());
    const dispatched = transfer.dispatch(actor, requestedAt, 1);
    expect(dispatched.status).toBe("IN_TRANSIT");
    expect(dispatched.version).toBe(2);
  });

  it("dispatch also accepts APPROVED", () => {
    const transfer = InventoryTransfer.request(requestInput());
    const approved = transfer.approve(actor, requestedAt, 1);
    expect(approved.status).toBe("APPROVED");
    const dispatched = approved.dispatch(actor, requestedAt, 2);
    expect(dispatched.status).toBe("IN_TRANSIT");
  });

  it("receive with all lines fully received transitions to RECEIVED", () => {
    const transfer = InventoryTransfer.request(requestInput()).dispatch(actor, requestedAt, 1);
    const received = transfer.receive(actor, requestedAt, true, 2);
    expect(received.status).toBe("RECEIVED");
  });

  it("receive with a partial result transitions to PARTIALLY_RECEIVED", () => {
    const transfer = InventoryTransfer.request(requestInput()).dispatch(actor, requestedAt, 1);
    const received = transfer.receive(actor, requestedAt, false, 2);
    expect(received.status).toBe("PARTIALLY_RECEIVED");
  });

  it("rejects dispatch from an already IN_TRANSIT transfer", () => {
    const transfer = InventoryTransfer.request(requestInput()).dispatch(actor, requestedAt, 1);
    expect(() => transfer.dispatch(actor, requestedAt, 2)).toThrow(InventoryDomainError);
  });

  it("rejects receive from a transfer not yet IN_TRANSIT", () => {
    const transfer = InventoryTransfer.request(requestInput());
    expect(() => transfer.receive(actor, requestedAt, true, 1)).toThrow(InventoryDomainError);
  });

  it("cancel is allowed pre-dispatch (REQUESTED/APPROVED)", () => {
    const transfer = InventoryTransfer.request(requestInput());
    const cancelled = transfer.cancel("wrong destination", requestedAt, 1);
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cancellationReason).toBe("wrong destination");
  });

  it("cancel after dispatch is rejected — post-dispatch cancellation requires explicit compensation, not modeled in B32", () => {
    const transfer = InventoryTransfer.request(requestInput()).dispatch(actor, requestedAt, 1);
    expect(() => transfer.cancel("changed my mind", requestedAt, 2)).toThrow(InventoryDomainError);
  });

  it("cancel rejects an empty reason", () => {
    const transfer = InventoryTransfer.request(requestInput());
    expect(() => transfer.cancel("   ", requestedAt, 1)).toThrow(InventoryDomainError);
  });

  it("reject is allowed from REQUESTED", () => {
    const transfer = InventoryTransfer.request(requestInput());
    const rejected = transfer.reject(1);
    expect(rejected.status).toBe("REJECTED");
  });

  it("rejects a version conflict", () => {
    const transfer = InventoryTransfer.request(requestInput());
    expect(() => transfer.dispatch(actor, requestedAt, 99)).toThrow(InventoryDomainError);
  });
});

describe("InventoryTransferLine", () => {
  function lineInput(overrides: Partial<Parameters<typeof InventoryTransferLine.create>[0]> = {}) {
    return {
      id: "018f0000-0000-7000-8000-000000000980",
      transferId: "018f0000-0000-7000-8000-000000000970",
      presentationId: "018f0000-0000-7000-8000-000000000080",
      lotId: null,
      requestedQuantity: Quantity.fromString("12"),
      ...overrides,
    };
  }

  it("starts with zero dispatched/received", () => {
    const line = InventoryTransferLine.create(lineInput());
    expect(line.dispatchedQuantity.toString()).toBe("0.000000");
    expect(line.differenceQuantity().toString()).toBe("0.000000");
    expect(line.isFullyReceived()).toBe(true); // 0 dispatched, 0 received: no outstanding difference yet
  });

  it("dispatch sets dispatchedQuantity, capped at requestedQuantity", () => {
    const line = InventoryTransferLine.create(lineInput());
    const dispatched = line.dispatch(Quantity.fromString("12"));
    expect(dispatched.dispatchedQuantity.toString()).toBe("12.000000");
  });

  it("rejects dispatching more than requested", () => {
    const line = InventoryTransferLine.create(lineInput());
    expect(() => line.dispatch(Quantity.fromString("13"))).toThrow(InventoryDomainError);
  });

  it("receive computes a positive differenceQuantity for a partial receipt", () => {
    const line = InventoryTransferLine.create(lineInput()).dispatch(Quantity.fromString("12"));
    const received = line.receive(Quantity.fromString("10"));
    expect(received.differenceQuantity().toString()).toBe("2.000000");
    expect(received.isFullyReceived()).toBe(false);
  });

  it("receive of the full dispatched quantity has zero difference", () => {
    const line = InventoryTransferLine.create(lineInput()).dispatch(Quantity.fromString("12"));
    const received = line.receive(Quantity.fromString("12"));
    expect(received.isFullyReceived()).toBe(true);
  });

  it("rejects receiving more than dispatched", () => {
    const line = InventoryTransferLine.create(lineInput()).dispatch(Quantity.fromString("12"));
    expect(() => line.receive(Quantity.fromString("13"))).toThrow(InventoryDomainError);
  });
});
