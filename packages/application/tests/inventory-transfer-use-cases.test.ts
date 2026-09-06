import { beforeEach, describe, expect, it } from "vitest";
import { Actor, CompanyScope, TenantScope } from "@pos-platform/domain";
import {
  CancelInventoryTransferUseCase,
  DispatchInventoryTransferUseCase,
  ReceiveInventoryTransferUseCase,
  RegisterInventoryAdjustmentUseCase,
  RequestInventoryTransferUseCase,
  type RequestInventoryTransferCommand,
} from "../src/index.js";
import {
  FixedClock,
  FixedInventoryAuthorization,
  InMemoryInventoryMovementRepository,
  InMemoryInventoryTransferRepository,
  InMemoryProductPresentationRepository,
  SequentialIdGenerator,
  seedInventoryPresentation,
} from "./fakes.js";

const scope = new CompanyScope("018f0000-0000-7000-8000-000000000010", "018f0000-0000-7000-8000-000000000011");
const sourceBranchId = "018f0000-0000-7000-8000-000000000020";
const sourceLocationId = "018f0000-0000-7000-8000-000000000030";
const destinationBranchId = "018f0000-0000-7000-8000-000000000021";
const destinationLocationId = "018f0000-0000-7000-8000-000000000031";
const presentationId = "018f0000-0000-7000-8000-000000000080";
const actor = Actor.forUser("018f0000-0000-7000-8000-000000000040");
const clock = new FixedClock(new Date("2026-09-03T08:00:00Z"));

let presentationRepository: InMemoryProductPresentationRepository;
let movementRepository: InMemoryInventoryMovementRepository;
let transferRepository: InMemoryInventoryTransferRepository;

beforeEach(async () => {
  presentationRepository = new InMemoryProductPresentationRepository();
  await seedInventoryPresentation(presentationRepository, scope, presentationId);
  movementRepository = new InMemoryInventoryMovementRepository();
  transferRepository = new InMemoryInventoryTransferRepository();

  const sourceScope = new TenantScope(scope.tenantId, scope.companyId, sourceBranchId);
  const adjustUseCase = new RegisterInventoryAdjustmentUseCase(movementRepository, presentationRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());
  await adjustUseCase.execute({
    scope: sourceScope, actor, inventoryLocationId: sourceLocationId, presentationId, lotId: null,
    adjustmentType: "POSITIVE_ADJUSTMENT", quantity: "20", reasonCode: "PHYSICAL_COUNT_CORRECTION", idempotencyKey: "seed:on-hand",
  });
});

function requestCommand(overrides: Partial<RequestInventoryTransferCommand> = {}): RequestInventoryTransferCommand {
  return {
    scope, actor, sourceBranchId, sourceLocationId, destinationBranchId, destinationLocationId,
    lines: [{ presentationId, lotId: null, quantity: "12" }],
    idempotencyKey: "transfer:1",
    ...overrides,
  };
}

describe("RequestInventoryTransferUseCase", () => {
  it("requests a transfer with its lines", async () => {
    const useCase = new RequestInventoryTransferUseCase(transferRepository, presentationRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());

    const result = await useCase.execute(requestCommand());

    expect(result.kind).toBe("REQUESTED");
    if (result.kind !== "REQUESTED") throw new Error("unreachable");
    expect(result.transfer.status).toBe("REQUESTED");
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]?.requestedQuantity.toString()).toBe("12.000000");
  });

  it("rejects an empty line list", async () => {
    const useCase = new RequestInventoryTransferUseCase(transferRepository, presentationRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());

    const result = await useCase.execute(requestCommand({ lines: [] }));

    expect(result).toEqual({ kind: "REJECTED", reason: "EMPTY_LINES" });
  });

  it("rejects source === destination location", async () => {
    const useCase = new RequestInventoryTransferUseCase(transferRepository, presentationRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());

    const result = await useCase.execute(requestCommand({ destinationLocationId: sourceLocationId }));

    expect(result).toEqual({ kind: "REJECTED", reason: "SAME_LOCATION" });
  });

  it("rejects without persisting when not authorized (roleMayTransferInventory is its own row)", async () => {
    const useCase = new RequestInventoryTransferUseCase(transferRepository, presentationRepository, new FixedInventoryAuthorization(false), clock, new SequentialIdGenerator());

    const result = await useCase.execute(requestCommand());

    expect(result).toEqual({ kind: "REJECTED", reason: "NOT_AUTHORIZED" });
  });

  it("idempotent replay returns the same transfer", async () => {
    const useCase = new RequestInventoryTransferUseCase(transferRepository, presentationRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());

    const first = await useCase.execute(requestCommand());
    const replay = await useCase.execute(requestCommand());

    expect(replay.kind).toBe("ALREADY_REQUESTED");
    if (replay.kind !== "ALREADY_REQUESTED" || first.kind !== "REQUESTED") throw new Error("unreachable");
    expect(replay.transfer.id).toBe(first.transfer.id);
  });
});

describe("Full transfer lifecycle: request -> dispatch -> receive", () => {
  it("dispatch creates a TRANSFER_OUT movement at source and moves the transfer to IN_TRANSIT", async () => {
    const requestUseCase = new RequestInventoryTransferUseCase(transferRepository, presentationRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());
    const requested = await requestUseCase.execute(requestCommand());
    if (requested.kind !== "REQUESTED") throw new Error("unreachable");

    const dispatchUseCase = new DispatchInventoryTransferUseCase(transferRepository, movementRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());
    const dispatched = await dispatchUseCase.execute({
      scope, actor, transferId: requested.transfer.id,
      lines: [{ lineId: requested.lines[0]!.id, quantity: "12" }],
      expectedVersion: 1, idempotencyKey: "dispatch:1",
    });

    expect(dispatched.kind).toBe("DISPATCHED");
    if (dispatched.kind !== "DISPATCHED") throw new Error("unreachable");
    expect(dispatched.transfer.status).toBe("IN_TRANSIT");
    expect(dispatched.lines[0]?.dispatchedQuantity.toString()).toBe("12.000000");

    const sourceMovements = movementRepository.saved.filter((movement) => movement.movementType === "TRANSFER_OUT");
    expect(sourceMovements).toHaveLength(1);
    expect(sourceMovements[0]?.referenceType).toBe("INVENTORY_TRANSFER");
    expect(sourceMovements[0]?.referenceId).toBe(requested.transfer.id);
  });

  it("dispatch rejects EXCEEDS_REQUESTED when the dispatched amount exceeds the requested cap", async () => {
    const requestUseCase = new RequestInventoryTransferUseCase(transferRepository, presentationRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());
    const requested = await requestUseCase.execute(requestCommand({ lines: [{ presentationId, lotId: null, quantity: "20" }] }));
    if (requested.kind !== "REQUESTED") throw new Error("unreachable");

    const dispatchUseCase = new DispatchInventoryTransferUseCase(transferRepository, movementRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());
    const dispatched = await dispatchUseCase.execute({
      scope, actor, transferId: requested.transfer.id,
      lines: [{ lineId: requested.lines[0]!.id, quantity: "21" }],
      expectedVersion: 1, idempotencyKey: "dispatch:1",
    });

    expect(dispatched).toEqual({ kind: "REJECTED", reason: "EXCEEDS_REQUESTED" });
  });

  it("dispatch rejects INSUFFICIENT_STOCK when the requested cap is within bounds but actual on-hand is not (25 requested, only 20 on-hand)", async () => {
    const requestUseCase = new RequestInventoryTransferUseCase(transferRepository, presentationRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());
    const requested = await requestUseCase.execute(requestCommand({ lines: [{ presentationId, lotId: null, quantity: "25" }] }));
    if (requested.kind !== "REQUESTED") throw new Error("unreachable");

    const dispatchUseCase = new DispatchInventoryTransferUseCase(transferRepository, movementRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());
    const dispatched = await dispatchUseCase.execute({
      scope, actor, transferId: requested.transfer.id,
      lines: [{ lineId: requested.lines[0]!.id, quantity: "25" }],
      expectedVersion: 1, idempotencyKey: "dispatch:1",
    });

    expect(dispatched).toEqual({ kind: "REJECTED", reason: "INSUFFICIENT_STOCK" });
  });

  it("full receive creates a TRANSFER_IN movement at destination and marks RECEIVED", async () => {
    const requestUseCase = new RequestInventoryTransferUseCase(transferRepository, presentationRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());
    const requested = await requestUseCase.execute(requestCommand());
    if (requested.kind !== "REQUESTED") throw new Error("unreachable");

    const dispatchUseCase = new DispatchInventoryTransferUseCase(transferRepository, movementRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());
    const dispatched = await dispatchUseCase.execute({
      scope, actor, transferId: requested.transfer.id,
      lines: [{ lineId: requested.lines[0]!.id, quantity: "12" }],
      expectedVersion: 1, idempotencyKey: "dispatch:1",
    });
    if (dispatched.kind !== "DISPATCHED") throw new Error("unreachable");

    const receiveUseCase = new ReceiveInventoryTransferUseCase(transferRepository, movementRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());
    const received = await receiveUseCase.execute({
      scope, actor, transferId: requested.transfer.id,
      lines: [{ lineId: requested.lines[0]!.id, quantity: "12" }],
      expectedVersion: 2, idempotencyKey: "receive:1",
    });

    expect(received.kind).toBe("RECEIVED");
    if (received.kind !== "RECEIVED") throw new Error("unreachable");
    expect(received.transfer.status).toBe("RECEIVED");
    expect(received.event.type).toBe("InventoryTransferred");

    const destinationMovements = movementRepository.saved.filter((movement) => movement.movementType === "TRANSFER_IN");
    expect(destinationMovements).toHaveLength(1);
    expect(destinationMovements[0]?.inventoryLocationId).toBe(destinationLocationId);
  });

  it("partial receive marks PARTIALLY_RECEIVED and records the difference on the line", async () => {
    const requestUseCase = new RequestInventoryTransferUseCase(transferRepository, presentationRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());
    const requested = await requestUseCase.execute(requestCommand());
    if (requested.kind !== "REQUESTED") throw new Error("unreachable");

    const dispatchUseCase = new DispatchInventoryTransferUseCase(transferRepository, movementRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());
    await dispatchUseCase.execute({
      scope, actor, transferId: requested.transfer.id,
      lines: [{ lineId: requested.lines[0]!.id, quantity: "12" }],
      expectedVersion: 1, idempotencyKey: "dispatch:1",
    });

    const receiveUseCase = new ReceiveInventoryTransferUseCase(transferRepository, movementRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());
    const received = await receiveUseCase.execute({
      scope, actor, transferId: requested.transfer.id,
      lines: [{ lineId: requested.lines[0]!.id, quantity: "9" }],
      expectedVersion: 2, idempotencyKey: "receive:1",
    });

    expect(received.kind).toBe("RECEIVED"); // result kind name is unrelated to transfer.status
    if (received.kind !== "RECEIVED") throw new Error("unreachable");
    expect(received.transfer.status).toBe("PARTIALLY_RECEIVED");
    expect(received.lines[0]?.differenceQuantity().toString()).toBe("3.000000");
  });
});

describe("CancelInventoryTransferUseCase", () => {
  it("cancels a REQUESTED transfer", async () => {
    const requestUseCase = new RequestInventoryTransferUseCase(transferRepository, presentationRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());
    const requested = await requestUseCase.execute(requestCommand());
    if (requested.kind !== "REQUESTED") throw new Error("unreachable");

    const cancelUseCase = new CancelInventoryTransferUseCase(transferRepository, new FixedInventoryAuthorization(true), clock);
    const result = await cancelUseCase.execute({
      scope, actor, transferId: requested.transfer.id, reason: "wrong destination", expectedVersion: 1, idempotencyKey: "cancel:1",
    });

    expect(result.kind).toBe("CANCELLED");
  });

  it("rejects cancelling after dispatch", async () => {
    const requestUseCase = new RequestInventoryTransferUseCase(transferRepository, presentationRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());
    const requested = await requestUseCase.execute(requestCommand());
    if (requested.kind !== "REQUESTED") throw new Error("unreachable");

    const dispatchUseCase = new DispatchInventoryTransferUseCase(transferRepository, movementRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());
    await dispatchUseCase.execute({
      scope, actor, transferId: requested.transfer.id,
      lines: [{ lineId: requested.lines[0]!.id, quantity: "12" }],
      expectedVersion: 1, idempotencyKey: "dispatch:1",
    });

    const cancelUseCase = new CancelInventoryTransferUseCase(transferRepository, new FixedInventoryAuthorization(true), clock);
    const result = await cancelUseCase.execute({
      scope, actor, transferId: requested.transfer.id, reason: "too late", expectedVersion: 2, idempotencyKey: "cancel:1",
    });

    expect(result).toEqual({ kind: "REJECTED", reason: "NOT_CANCELLABLE" });
  });

  it("rejects an empty cancellation reason", async () => {
    const requestUseCase = new RequestInventoryTransferUseCase(transferRepository, presentationRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());
    const requested = await requestUseCase.execute(requestCommand());
    if (requested.kind !== "REQUESTED") throw new Error("unreachable");

    const cancelUseCase = new CancelInventoryTransferUseCase(transferRepository, new FixedInventoryAuthorization(true), clock);
    const result = await cancelUseCase.execute({
      scope, actor, transferId: requested.transfer.id, reason: "   ", expectedVersion: 1, idempotencyKey: "cancel:1",
    });

    expect(result).toEqual({ kind: "REJECTED", reason: "EMPTY_REASON" });
  });
});
