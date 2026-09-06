import { beforeEach, describe, expect, it } from "vitest";
import { Actor, TenantScope } from "@pos-platform/domain";
import {
  RegisterInventoryAdjustmentUseCase,
  ReleaseInventoryReservationUseCase,
  ReserveInventoryUseCase,
  type ReleaseInventoryReservationCommand,
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

function command(overrides: Partial<ReleaseInventoryReservationCommand> = {}): ReleaseInventoryReservationCommand {
  return { scope, actor, reservationId, expectedVersion: 1, idempotencyKey: "release:1", ...overrides };
}

describe("ReleaseInventoryReservationUseCase", () => {
  it("releases a reservation, freeing capacity back into StockBalance's available", async () => {
    const useCase = new ReleaseInventoryReservationUseCase(reservationRepository, new FixedInventoryAuthorization(true));

    const result = await useCase.execute(command());

    expect(result.kind).toBe("RELEASED");
    if (result.kind !== "RELEASED") throw new Error("unreachable");
    expect(result.reservation.status).toBe("RELEASED");
    expect(result.reservation.releasedQuantity.toString()).toBe("6.000000");
    expect(result.event.type).toBe("InventoryReservationReleased");
  });

  it("released capacity is visible to a subsequent reservation via StockBalance", async () => {
    const releaseUseCase = new ReleaseInventoryReservationUseCase(reservationRepository, new FixedInventoryAuthorization(true));
    await releaseUseCase.execute(command());

    const reserveUseCase = new ReserveInventoryUseCase(movementRepository, reservationRepository, presentationRepository, new FixedInventoryAuthorization(true), clock, new SequentialIdGenerator());
    const result = await reserveUseCase.execute({
      scope, actor, inventoryLocationId: locationId, presentationId, lotId: null,
      referenceType: "SALE_SUSPENDED", referenceId: "018f0000-0000-7000-8000-000000000961",
      quantity: "10", expiresAt: null, idempotencyKey: "reserve:2",
    });

    expect(result.kind).toBe("RESERVED"); // full 10 on-hand available again, the released 6 no longer counted
  });

  it("rejects releasing an already RELEASED reservation outside replay", async () => {
    const useCase = new ReleaseInventoryReservationUseCase(reservationRepository, new FixedInventoryAuthorization(true));
    await useCase.execute(command());

    const result = await useCase.execute(command({ expectedVersion: 2, idempotencyKey: "release:2" }));

    expect(result).toEqual({ kind: "REJECTED", reason: "NOT_RELEASABLE" });
  });

  it("rejects a version conflict", async () => {
    const useCase = new ReleaseInventoryReservationUseCase(reservationRepository, new FixedInventoryAuthorization(true));

    const result = await useCase.execute(command({ expectedVersion: 99 }));

    expect(result).toEqual({ kind: "REJECTED", reason: "VERSION_CONFLICT" });
  });

  it("idempotent replay returns the same reservation", async () => {
    const useCase = new ReleaseInventoryReservationUseCase(reservationRepository, new FixedInventoryAuthorization(true));

    const first = await useCase.execute(command());
    const replay = await useCase.execute(command());

    expect(replay.kind).toBe("ALREADY_RELEASED");
    if (replay.kind !== "ALREADY_RELEASED" || first.kind !== "RELEASED") throw new Error("unreachable");
    expect(replay.reservation.id).toBe(first.reservation.id);
  });

  it("rejects without persisting when not authorized", async () => {
    const useCase = new ReleaseInventoryReservationUseCase(reservationRepository, new FixedInventoryAuthorization(false));

    const result = await useCase.execute(command());

    expect(result).toEqual({ kind: "REJECTED", reason: "NOT_AUTHORIZED" });
  });
});
