import { beforeEach, describe, expect, it } from "vitest";
import { Actor, TenantScope } from "@pos-platform/domain";
import { RegisterInventoryAdjustmentUseCase, RegisterInventoryWasteUseCase, type RegisterInventoryWasteCommand } from "../src/index.js";
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

function command(overrides: Partial<RegisterInventoryWasteCommand> = {}): RegisterInventoryWasteCommand {
  return {
    scope, actor, inventoryLocationId: locationId, presentationId, lotId: null,
    quantity: "3", reasonCode: "DAMAGED", idempotencyKey: "waste:1",
    ...overrides,
  };
}

let presentationRepository: InMemoryProductPresentationRepository;
beforeEach(async () => {
  presentationRepository = new InMemoryProductPresentationRepository();
  await seedInventoryPresentation(presentationRepository, scope, presentationId);
});

async function seedOnHand(movementRepository: InMemoryInventoryMovementRepository, quantity: string): Promise<void> {
  const adjustUseCase = new RegisterInventoryAdjustmentUseCase(movementRepository, presentationRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());
  await adjustUseCase.execute({
    scope, actor, inventoryLocationId: locationId, presentationId, lotId: null,
    adjustmentType: "POSITIVE_ADJUSTMENT", quantity, reasonCode: "PHYSICAL_COUNT_CORRECTION", idempotencyKey: "seed:on-hand",
  });
}

describe("RegisterInventoryWasteUseCase", () => {
  it("registers a WASTE movement against existing stock, reducing on-hand quantity", async () => {
    const repository = new InMemoryInventoryMovementRepository();
    await seedOnHand(repository, "10");
    const useCase = new RegisterInventoryWasteUseCase(repository, presentationRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command());

    expect(result.kind).toBe("REGISTERED");
    if (result.kind !== "REGISTERED") throw new Error("unreachable");
    expect(result.movement.movementType).toBe("WASTE");
    expect(result.movement.direction).toBe("OUT");
    expect(result.onHandQuantity.toString()).toBe("7.000000");
    expect(result.event.type).toBe("InventoryLossRecorded");
  });

  it("rejects a WASTE that would drive on-hand negative", async () => {
    const repository = new InMemoryInventoryMovementRepository();
    const useCase = new RegisterInventoryWasteUseCase(repository, presentationRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command());

    expect(result).toEqual({ kind: "REJECTED", reason: "INSUFFICIENT_STOCK" });
    expect(repository.saved).toHaveLength(0);
  });

  it("rejects without touching the repository when not authorized (roleMayRegisterWaste is its own row)", async () => {
    const repository = new InMemoryInventoryMovementRepository();
    const useCase = new RegisterInventoryWasteUseCase(repository, presentationRepository, new FixedInventoryAuthorization(false), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command());

    expect(result).toEqual({ kind: "REJECTED", reason: "NOT_AUTHORIZED" });
  });

  it("idempotent replay returns the same movement without duplicating it", async () => {
    const repository = new InMemoryInventoryMovementRepository();
    await seedOnHand(repository, "10");
    const useCase = new RegisterInventoryWasteUseCase(repository, presentationRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());

    const first = await useCase.execute(command());
    const replay = await useCase.execute(command());

    expect(replay.kind).toBe("ALREADY_REGISTERED");
    if (replay.kind !== "ALREADY_REGISTERED" || first.kind !== "REGISTERED") throw new Error("unreachable");
    expect(replay.movement.id).toBe(first.movement.id);
  });

  it("rejects a nonexistent presentation", async () => {
    const repository = new InMemoryInventoryMovementRepository();
    const useCase = new RegisterInventoryWasteUseCase(repository, presentationRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command({ presentationId: "018f0000-0000-7000-8000-000000009999" }));

    expect(result).toEqual({ kind: "REJECTED", reason: "PRESENTATION_NOT_FOUND" });
  });

  it("rejects an invalid quantity", async () => {
    const repository = new InMemoryInventoryMovementRepository();
    const useCase = new RegisterInventoryWasteUseCase(repository, presentationRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command({ quantity: "0" }));

    expect(result).toEqual({ kind: "REJECTED", reason: "INVALID_QUANTITY" });
  });
});
