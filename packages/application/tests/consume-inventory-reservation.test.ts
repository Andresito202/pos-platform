import { beforeEach, describe, expect, it } from "vitest";
import { Actor, TenantScope } from "@pos-platform/domain";
import {
  ConsumeInventoryReservationUseCase,
  RegisterInventoryAdjustmentUseCase,
  ReserveInventoryUseCase,
  type ConsumeInventoryReservationCommand,
} from "../src/index.js";
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

let presentationRepository: InMemoryProductPresentationRepository;
let movementRepository: InMemoryInventoryMovementRepository;
let reservationRepository: InMemoryInventoryReservationRepository;
let reservationId: string;

beforeEach(async () => {
  presentationRepository = new InMemoryProductPresentationRepository();
  await seedInventoryPresentation(presentationRepository, scope, presentationId);
  movementRepository = new InMemoryInventoryMovementRepository();
  reservationRepository = new InMemoryInventoryReservationRepository();

  const adjustUseCase = new RegisterInventoryAdjustmentUseCase(movementRepository, presentationRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());
  await adjustUseCase.execute({
    scope, actor, inventoryLocationId: locationId, presentationId, lotId: null,
    adjustmentType: "POSITIVE_ADJUSTMENT", quantity: "10", reasonCode: "PHYSICAL_COUNT_CORRECTION", idempotencyKey: "seed:on-hand",
  });

  const reserveUseCase = new ReserveInventoryUseCase(movementRepository, reservationRepository, presentationRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());
  const reserved = await reserveUseCase.execute({
    scope, actor, inventoryLocationId: locationId, presentationId, lotId: null,
    referenceType: "SALE_SUSPENDED", referenceId: "018f0000-0000-7000-8000-000000000960",
    quantity: "6", expiresAt: null, idempotencyKey: "reserve:1",
  });
  if (reserved.kind !== "RESERVED") throw new Error("unreachable");
  reservationId = reserved.reservation.id;
});

function command(overrides: Partial<ConsumeInventoryReservationCommand> = {}): ConsumeInventoryReservationCommand {
  return { scope, actor, reservationId, quantity: "4", expectedVersion: 1, idempotencyKey: "consume:1", ...overrides };
}

describe("ConsumeInventoryReservationUseCase", () => {
  it("consumes a reservation, produces a RESERVATION_CONSUMPTION movement, and reduces on-hand", async () => {
    const useCase = new ConsumeInventoryReservationUseCase(movementRepository, reservationRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command());

    expect(result.kind).toBe("CONSUMED");
    if (result.kind !== "CONSUMED") throw new Error("unreachable");
    expect(result.reservation.status).toBe("PARTIALLY_CONSUMED");
    expect(result.movement.movementType).toBe("RESERVATION_CONSUMPTION");
    expect(result.movement.direction).toBe("OUT");
    expect(result.movement.referenceType).toBe("INVENTORY_RESERVATION");
    expect(result.movement.referenceId).toBe(reservationId);
    expect(result.event.type).toBe("InventoryDeducted");
    // +1 on top of the seeded on-hand adjustment from beforeEach.
    expect(movementRepository.saved).toHaveLength(2);
  });

  it("full consumption transitions the reservation to CONSUMED", async () => {
    const useCase = new ConsumeInventoryReservationUseCase(movementRepository, reservationRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command({ quantity: "6" }));

    expect(result.kind).toBe("CONSUMED");
    if (result.kind !== "CONSUMED") throw new Error("unreachable");
    expect(result.reservation.status).toBe("CONSUMED");
  });

  it("rejects consuming more than the reservation holds", async () => {
    const useCase = new ConsumeInventoryReservationUseCase(movementRepository, reservationRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command({ quantity: "7" }));

    expect(result).toEqual({ kind: "REJECTED", reason: "EXCEEDS_RESERVATION" });
    expect(movementRepository.saved).toHaveLength(1); // only the seeded on-hand adjustment, no consumption movement
  });

  it("rejects a version conflict", async () => {
    const useCase = new ConsumeInventoryReservationUseCase(movementRepository, reservationRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command({ expectedVersion: 99 }));

    expect(result).toEqual({ kind: "REJECTED", reason: "VERSION_CONFLICT" });
  });

  it("rejects consuming a nonexistent reservation", async () => {
    const useCase = new ConsumeInventoryReservationUseCase(movementRepository, reservationRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command({ reservationId: "018f0000-0000-7000-8000-000000009999" }));

    expect(result).toEqual({ kind: "REJECTED", reason: "RESERVATION_NOT_FOUND" });
  });

  it("idempotent replay returns the same reservation without a second movement", async () => {
    const useCase = new ConsumeInventoryReservationUseCase(movementRepository, reservationRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());

    const first = await useCase.execute(command());
    const replay = await useCase.execute(command());

    expect(replay.kind).toBe("ALREADY_CONSUMED");
    if (replay.kind !== "ALREADY_CONSUMED" || first.kind !== "CONSUMED") throw new Error("unreachable");
    expect(replay.reservation.id).toBe(first.reservation.id);
    expect(movementRepository.saved).toHaveLength(2); // seed + one consumption movement, no second one from the replay
  });
});

/**
 * B32 note (not a test): true concurrent-race proof (`Promise.all`,
 * exactly-one-winner) requires a real adapter with a real transactional
 * write guard — the in-memory fakes used here have no I/O latency, so
 * two `execute()` calls inside `Promise.all` do not genuinely
 * interleave; asserting a race outcome against them would be a fabricated
 * pass, not real evidence. That proof belongs to B33 (persistence),
 * mirroring how B29 proved it for Catalog against a real SQLite file and
 * a real PostgreSQL container.
 */
