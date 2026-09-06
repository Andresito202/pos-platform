import { beforeEach, describe, expect, it } from "vitest";
import { Actor, TenantScope } from "@pos-platform/domain";
import { RegisterInventoryAdjustmentUseCase, ReserveInventoryUseCase, type ReserveInventoryCommand } from "../src/index.js";
import {
  FixedClock,
  FixedInventoryAuthorization,
  InMemoryInventoryMovementRepository,
  InMemoryInventoryReservationRepository,
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

function command(overrides: Partial<ReserveInventoryCommand> = {}): ReserveInventoryCommand {
  return {
    scope, actor, inventoryLocationId: locationId, presentationId, lotId: null,
    referenceType: "SALE_SUSPENDED", referenceId: "018f0000-0000-7000-8000-000000000960",
    quantity: "4", expiresAt: null, idempotencyKey: "reserve:1",
    ...overrides,
  };
}

let presentationRepository: InMemoryProductPresentationRepository;
let movementRepository: InMemoryInventoryMovementRepository;
beforeEach(async () => {
  presentationRepository = new InMemoryProductPresentationRepository();
  await seedInventoryPresentation(presentationRepository, scope, presentationId);
  movementRepository = new InMemoryInventoryMovementRepository();
  const adjustUseCase = new RegisterInventoryAdjustmentUseCase(movementRepository, presentationRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());
  await adjustUseCase.execute({
    scope, actor, inventoryLocationId: locationId, presentationId, lotId: null,
    adjustmentType: "POSITIVE_ADJUSTMENT", quantity: "10", reasonCode: "PHYSICAL_COUNT_CORRECTION", idempotencyKey: "seed:on-hand",
  });
});

describe("ReserveInventoryUseCase", () => {
  it("reserves against available on-hand when authorized", async () => {
    const reservationRepository = new InMemoryInventoryReservationRepository();
    const useCase = new ReserveInventoryUseCase(movementRepository, reservationRepository, presentationRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command());

    expect(result.kind).toBe("RESERVED");
    if (result.kind !== "RESERVED") throw new Error("unreachable");
    expect(result.reservation.status).toBe("ACTIVE");
    expect(result.reservation.quantity.toString()).toBe("4.000000");
    expect(result.event.type).toBe("InventoryReserved");
  });

  it("fails closed: B31 ARCHITECTURAL DECISION means no role is authorized yet (no calling process exists)", async () => {
    const reservationRepository = new InMemoryInventoryReservationRepository();
    // FixedInventoryAuthorization(false) exercises the DENY path — the real RoleBasedInventoryAuthorization
    // (tested separately) proves canReserveInventory fails closed for every role.
    const useCase = new ReserveInventoryUseCase(movementRepository, reservationRepository, presentationRepository, new FixedInventoryAuthorization(false), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command());

    expect(result).toEqual({ kind: "REJECTED", reason: "NOT_AUTHORIZED" });
  });

  it("rejects a reservation exceeding available quantity", async () => {
    const reservationRepository = new InMemoryInventoryReservationRepository();
    const useCase = new ReserveInventoryUseCase(movementRepository, reservationRepository, presentationRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command({ quantity: "11" }));

    expect(result).toEqual({ kind: "REJECTED", reason: "INSUFFICIENT_AVAILABLE" });
  });

  it("a second reservation cannot double-commit already-reserved capacity", async () => {
    const reservationRepository = new InMemoryInventoryReservationRepository();
    const useCase = new ReserveInventoryUseCase(movementRepository, reservationRepository, presentationRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());
    await useCase.execute(command({ quantity: "7", idempotencyKey: "reserve:1" }));

    const second = await useCase.execute(command({ quantity: "4", idempotencyKey: "reserve:2" }));

    expect(second).toEqual({ kind: "REJECTED", reason: "INSUFFICIENT_AVAILABLE" }); // 10 on-hand - 7 reserved = 3 available < 4
  });

  it("idempotent replay returns the same reservation without duplicating it", async () => {
    const reservationRepository = new InMemoryInventoryReservationRepository();
    const useCase = new ReserveInventoryUseCase(movementRepository, reservationRepository, presentationRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());

    const first = await useCase.execute(command());
    const replay = await useCase.execute(command());

    expect(replay.kind).toBe("ALREADY_RESERVED");
    if (replay.kind !== "ALREADY_RESERVED" || first.kind !== "RESERVED") throw new Error("unreachable");
    expect(replay.reservation.id).toBe(first.reservation.id);
    expect(reservationRepository.saved).toHaveLength(1);
  });

  it("rejects a nonexistent presentation", async () => {
    const reservationRepository = new InMemoryInventoryReservationRepository();
    const useCase = new ReserveInventoryUseCase(movementRepository, reservationRepository, presentationRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command({ presentationId: "018f0000-0000-7000-8000-000000009999" }));

    expect(result).toEqual({ kind: "REJECTED", reason: "PRESENTATION_NOT_FOUND" });
  });
});
