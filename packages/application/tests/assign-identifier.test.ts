import { describe, expect, it } from "vitest";
import { Actor, CompanyScope, ProductPresentation, Quantity } from "@pos-platform/domain";
import { AssignIdentifierUseCase, type AssignIdentifierCommand } from "../src/index.js";
import {
  FixedCatalogAuthorization,
  FixedClock,
  FixedIdentifierNormalizationPolicy,
  InMemoryProductIdentifierRepository,
  InMemoryProductPresentationRepository,
  SequentialIdGenerator,
} from "./fakes.js";

const scope = new CompanyScope("018f0000-0000-7000-8000-000000000010", "018f0000-0000-7000-8000-000000000011");
const actor = Actor.forUser("018f0000-0000-7000-8000-000000000030");
const clock = new FixedClock(new Date("2026-09-02T08:00:00Z"));

function seedPresentation(repository: InMemoryProductPresentationRepository): ProductPresentation {
  const presentation = ProductPresentation.create({
    id: "018f0000-0000-7000-8000-000000000700",
    scope,
    productId: "018f0000-0000-7000-8000-000000000500",
    variantId: null,
    name: "botella 400ml",
    internalSku: "GAS-400",
    unitId: "018f0000-0000-7000-8000-000000000900",
    containedQuantity: Quantity.fromString("1"),
    variableQuantity: false,
    salesEnabled: true,
    purchasingEnabled: true,
    breakable: false,
    stockMode: "INDEPENDENT",
  });
  void repository.save(presentation, "seed");
  return presentation;
}

function command(presentationId: string, overrides: Partial<AssignIdentifierCommand> = {}): AssignIdentifierCommand {
  return { scope, actor, presentationId, identifierType: "EAN_13", rawValue: "7701234567890", idempotencyKey: "assign-identifier:1", ...overrides };
}

function newUseCase(
  presentationRepository: InMemoryProductPresentationRepository,
  identifierRepository: InMemoryProductIdentifierRepository,
  allow = true,
) {
  return new AssignIdentifierUseCase(
    presentationRepository, identifierRepository, new FixedCatalogAuthorization(allow),
    new FixedIdentifierNormalizationPolicy(), clock, new SequentialIdGenerator(),
  );
}

describe("AssignIdentifierUseCase", () => {
  it("assigns an identifier, derives productId/variantId from the presentation, and returns the domain event", async () => {
    const presentationRepository = new InMemoryProductPresentationRepository();
    const identifierRepository = new InMemoryProductIdentifierRepository();
    const presentation = seedPresentation(presentationRepository);
    const useCase = newUseCase(presentationRepository, identifierRepository);

    const result = await useCase.execute(command(presentation.id));

    expect(result.kind).toBe("ASSIGNED");
    if (result.kind !== "ASSIGNED") throw new Error("unreachable");
    expect(result.identifier.presentationId).toBe(presentation.id);
    expect(result.identifier.productId).toBe(presentation.productId);
    expect(result.event.type).toBe("ProductIdentifierAssigned");
  });

  it("rejects without touching the repository when unauthorized", async () => {
    const presentationRepository = new InMemoryProductPresentationRepository();
    const identifierRepository = new InMemoryProductIdentifierRepository();
    const presentation = seedPresentation(presentationRepository);
    const useCase = newUseCase(presentationRepository, identifierRepository, false);

    const result = await useCase.execute(command(presentation.id));

    expect(result).toEqual({ kind: "REJECTED", reason: "NOT_AUTHORIZED" });
    expect(identifierRepository.saved).toHaveLength(0);
  });

  it("rejects a presentation that does not exist in scope", async () => {
    const presentationRepository = new InMemoryProductPresentationRepository();
    const identifierRepository = new InMemoryProductIdentifierRepository();
    const useCase = newUseCase(presentationRepository, identifierRepository);

    const result = await useCase.execute(command("018f0000-0000-7000-8000-000000009999"));

    expect(result).toEqual({ kind: "REJECTED", reason: "PRESENTATION_NOT_FOUND" });
  });

  it("rejects an empty raw value", async () => {
    const presentationRepository = new InMemoryProductPresentationRepository();
    const identifierRepository = new InMemoryProductIdentifierRepository();
    const presentation = seedPresentation(presentationRepository);
    const useCase = newUseCase(presentationRepository, identifierRepository);

    const result = await useCase.execute(command(presentation.id, { rawValue: "   " }));

    expect(result).toEqual({ kind: "REJECTED", reason: "EMPTY_VALUE" });
  });

  it("DUPLICATE DETECTION: rejects the same (type, normalized value) already assigned within the company (UC-CAT-003 rule 1)", async () => {
    const presentationRepository = new InMemoryProductPresentationRepository();
    const identifierRepository = new InMemoryProductIdentifierRepository();
    const presentation = seedPresentation(presentationRepository);
    const useCase = newUseCase(presentationRepository, identifierRepository);

    const first = await useCase.execute(command(presentation.id));
    expect(first.kind).toBe("ASSIGNED");

    const second = await useCase.execute(command(presentation.id, { idempotencyKey: "assign-identifier:2" }));

    expect(second).toEqual({ kind: "REJECTED", reason: "IDENTIFIER_ALREADY_EXISTS" });
    expect(identifierRepository.saved).toHaveLength(1);
  });

  it("idempotent replay: the SAME idempotencyKey returns the same identifier without duplicating it", async () => {
    const presentationRepository = new InMemoryProductPresentationRepository();
    const identifierRepository = new InMemoryProductIdentifierRepository();
    const presentation = seedPresentation(presentationRepository);
    const useCase = newUseCase(presentationRepository, identifierRepository);

    const first = await useCase.execute(command(presentation.id));
    const replay = await useCase.execute(command(presentation.id));

    expect(replay.kind).toBe("ALREADY_ASSIGNED");
    if (replay.kind !== "ALREADY_ASSIGNED" || first.kind !== "ASSIGNED") throw new Error("unreachable");
    expect(replay.identifier.id).toBe(first.identifier.id);
    expect(identifierRepository.saved).toHaveLength(1);
  });
});
