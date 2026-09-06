import { beforeEach, describe, expect, it } from "vitest";
import { Actor, TenantScope } from "@pos-platform/domain";
import { RegisterInventoryAdjustmentUseCase, type RegisterInventoryAdjustmentCommand } from "../src/index.js";
import {
  FixedClock,
  FixedInventoryAuthorization,
  InMemoryInventoryMovementRepository,
  InMemoryProductPresentationRepository,
  SequentialIdGenerator,
  seedInventoryPresentation,
} from "./fakes.js";

const scope = new TenantScope(
  "018f0000-0000-7000-8000-000000000010",
  "018f0000-0000-7000-8000-000000000011",
  "018f0000-0000-7000-8000-000000000012",
);
const locationId = "018f0000-0000-7000-8000-000000000070";
const presentationId = "018f0000-0000-7000-8000-000000000080";
const actor = Actor.forUser("018f0000-0000-7000-8000-000000000040");
const clock = new FixedClock(new Date("2026-09-03T08:00:00Z"));

function command(overrides: Partial<RegisterInventoryAdjustmentCommand> = {}): RegisterInventoryAdjustmentCommand {
  return {
    scope,
    actor,
    inventoryLocationId: locationId,
    presentationId,
    lotId: null,
    adjustmentType: "POSITIVE_ADJUSTMENT",
    quantity: "10",
    reasonCode: "PHYSICAL_COUNT_CORRECTION",
    idempotencyKey: "adjustment:1",
    ...overrides,
  };
}

let presentationRepository: InMemoryProductPresentationRepository;
beforeEach(async () => {
  presentationRepository = new InMemoryProductPresentationRepository();
  await seedInventoryPresentation(presentationRepository, scope, presentationId);
  await seedInventoryPresentation(presentationRepository, scope, "018f0000-0000-7000-8000-0000000000aa", "018f0000-0000-7000-8000-000000000901");
});

describe("RegisterInventoryAdjustmentUseCase", () => {
  it("registers a POSITIVE_ADJUSTMENT, persists it, and returns the recomputed on-hand quantity", async () => {
    const repository = new InMemoryInventoryMovementRepository();
    const useCase = new RegisterInventoryAdjustmentUseCase(repository, presentationRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command());

    expect(result.kind).toBe("REGISTERED");
    if (result.kind !== "REGISTERED") throw new Error("unreachable");
    expect(result.movement.movementType).toBe("POSITIVE_ADJUSTMENT");
    expect(result.movement.direction).toBe("IN");
    expect(result.onHandQuantity.toString()).toBe("10.000000");
    expect(result.event.type).toBe("InventoryAdjusted");
    expect(repository.saved).toHaveLength(1);
  });

  it("registers a NEGATIVE_ADJUSTMENT with direction OUT against existing stock, reducing on-hand quantity", async () => {
    const repository = new InMemoryInventoryMovementRepository();
    const useCase = new RegisterInventoryAdjustmentUseCase(repository, presentationRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());
    await useCase.execute(command({ quantity: "10", idempotencyKey: "adjustment:seed" }));

    const result = await useCase.execute(command({ adjustmentType: "NEGATIVE_ADJUSTMENT", quantity: "4", idempotencyKey: "adjustment:1" }));

    expect(result.kind).toBe("REGISTERED");
    if (result.kind !== "REGISTERED") throw new Error("unreachable");
    expect(result.movement.direction).toBe("OUT");
    expect(result.onHandQuantity.toString()).toBe("6.000000");
  });

  it("B32 MAJOR fix: rejects a NEGATIVE_ADJUSTMENT that would drive on-hand negative, without persisting", async () => {
    const repository = new InMemoryInventoryMovementRepository();
    const useCase = new RegisterInventoryAdjustmentUseCase(repository, presentationRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command({ adjustmentType: "NEGATIVE_ADJUSTMENT", quantity: "4" }));

    expect(result).toEqual({ kind: "REJECTED", reason: "INSUFFICIENT_STOCK" });
    expect(repository.saved).toHaveLength(0);
  });

  it("allows a NEGATIVE_ADJUSTMENT that brings on-hand to exactly zero", async () => {
    const repository = new InMemoryInventoryMovementRepository();
    const useCase = new RegisterInventoryAdjustmentUseCase(repository, presentationRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());
    await useCase.execute(command({ quantity: "5", idempotencyKey: "adjustment:seed" }));

    const result = await useCase.execute(command({ adjustmentType: "NEGATIVE_ADJUSTMENT", quantity: "5", idempotencyKey: "adjustment:1" }));

    expect(result.kind).toBe("REGISTERED");
    if (result.kind !== "REGISTERED") throw new Error("unreachable");
    expect(result.onHandQuantity.toString()).toBe("0.000000");
  });

  it("accumulates on-hand quantity across successive adjustments for the same location/presentation/lot", async () => {
    const repository = new InMemoryInventoryMovementRepository();
    const useCase = new RegisterInventoryAdjustmentUseCase(repository, presentationRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());

    await useCase.execute(command({ quantity: "10", idempotencyKey: "adjustment:1" }));
    const second = await useCase.execute(
      command({ adjustmentType: "NEGATIVE_ADJUSTMENT", quantity: "3", idempotencyKey: "adjustment:2" }),
    );

    expect(second.kind).toBe("REGISTERED");
    if (second.kind !== "REGISTERED") throw new Error("unreachable");
    expect(second.onHandQuantity.toString()).toBe("7.000000");
  });

  it("does not fold movements from a different presentation into the on-hand projection", async () => {
    const repository = new InMemoryInventoryMovementRepository();
    const useCase = new RegisterInventoryAdjustmentUseCase(repository, presentationRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());

    await useCase.execute(command({ presentationId: "018f0000-0000-7000-8000-0000000000aa", quantity: "999", idempotencyKey: "adjustment:1" }));
    const result = await useCase.execute(command({ presentationId, quantity: "5", idempotencyKey: "adjustment:2" }));

    expect(result.kind).toBe("REGISTERED");
    if (result.kind !== "REGISTERED") throw new Error("unreachable");
    expect(result.onHandQuantity.toString()).toBe("5.000000");
  });

  it("rejects without touching the repository when the actor is not authorized", async () => {
    const repository = new InMemoryInventoryMovementRepository();
    const useCase = new RegisterInventoryAdjustmentUseCase(repository, presentationRepository, new FixedInventoryAuthorization(false), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command());

    expect(result).toEqual({ kind: "REJECTED", reason: "NOT_AUTHORIZED" });
    expect(repository.saved).toHaveLength(0);
  });

  it("idempotent replay: retrying with the SAME idempotency key returns the same movement without duplicating it", async () => {
    const repository = new InMemoryInventoryMovementRepository();
    const useCase = new RegisterInventoryAdjustmentUseCase(repository, presentationRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());

    const first = await useCase.execute(command());
    expect(first.kind).toBe("REGISTERED");

    const replay = await useCase.execute(command());

    expect(replay.kind).toBe("ALREADY_REGISTERED");
    if (replay.kind !== "ALREADY_REGISTERED" || first.kind !== "REGISTERED") throw new Error("unreachable");
    expect(replay.movement.id).toBe(first.movement.id);
    expect(repository.saved).toHaveLength(1);
  });

  it("rejects a malformed quantity", async () => {
    const repository = new InMemoryInventoryMovementRepository();
    const useCase = new RegisterInventoryAdjustmentUseCase(repository, presentationRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command({ quantity: "not-a-number" }));

    expect(result).toEqual({ kind: "REJECTED", reason: "INVALID_QUANTITY" });
    expect(repository.saved).toHaveLength(0);
  });

  it("rejects a zero quantity", async () => {
    const repository = new InMemoryInventoryMovementRepository();
    const useCase = new RegisterInventoryAdjustmentUseCase(repository, presentationRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command({ quantity: "0" }));

    expect(result).toEqual({ kind: "REJECTED", reason: "INVALID_QUANTITY" });
    expect(repository.saved).toHaveLength(0);
  });

  it("rejects an empty reason code without persisting", async () => {
    const repository = new InMemoryInventoryMovementRepository();
    const useCase = new RegisterInventoryAdjustmentUseCase(repository, presentationRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command({ reasonCode: "   " }));

    expect(result).toEqual({ kind: "REJECTED", reason: "EMPTY_REASON_CODE" });
    expect(repository.saved).toHaveLength(0);
  });

  it("B32: rejects a nonexistent presentation, without persisting", async () => {
    const repository = new InMemoryInventoryMovementRepository();
    const useCase = new RegisterInventoryAdjustmentUseCase(repository, presentationRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command({ presentationId: "018f0000-0000-7000-8000-000000009999" }));

    expect(result).toEqual({ kind: "REJECTED", reason: "PRESENTATION_NOT_FOUND" });
    expect(repository.saved).toHaveLength(0);
  });

  it("propagates a repository failure instead of swallowing it", async () => {
    const repository = new InMemoryInventoryMovementRepository();
    repository.save = async () => { throw new Error("repository unavailable"); };
    const useCase = new RegisterInventoryAdjustmentUseCase(repository, presentationRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());

    await expect(useCase.execute(command())).rejects.toThrow("repository unavailable");
  });
});
