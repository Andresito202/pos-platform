import { describe, expect, it } from "vitest";
import { Actor, CompanyScope, ProductPresentation, Quantity } from "@pos-platform/domain";
import { DefineConversionUseCase, type DefineConversionCommand } from "../src/index.js";
import {
  FixedCatalogAuthorization,
  FixedClock,
  InMemoryProductPresentationRepository,
  InMemoryUnitConversionRepository,
  SequentialIdGenerator,
} from "./fakes.js";

const scope = new CompanyScope("018f0000-0000-7000-8000-000000000010", "018f0000-0000-7000-8000-000000000011");
const actor = Actor.forUser("018f0000-0000-7000-8000-000000000030");
const clock = new FixedClock(new Date("2026-09-02T08:00:00Z"));
const productId = "018f0000-0000-7000-8000-000000000500";

function presentation(id: string, overrides: Partial<Parameters<typeof ProductPresentation.create>[0]> = {}): ProductPresentation {
  return ProductPresentation.create({
    id,
    scope,
    productId,
    variantId: null,
    name: "presentación",
    internalSku: null,
    unitId: "018f0000-0000-7000-8000-000000000900",
    containedQuantity: Quantity.fromString("1"),
    variableQuantity: false,
    salesEnabled: true,
    purchasingEnabled: true,
    breakable: false,
    stockMode: "INDEPENDENT",
    ...overrides,
  });
}

function seed(presentationRepository: InMemoryProductPresentationRepository) {
  const source = presentation("018f0000-0000-7000-8000-000000000700", { name: "paca x12" });
  const target = presentation("018f0000-0000-7000-8000-000000000710", { name: "bolsa individual" });
  void presentationRepository.save(source, "seed-source");
  void presentationRepository.save(target, "seed-target");
  return { source, target };
}

function command(sourcePresentationId: string, targetPresentationId: string, overrides: Partial<DefineConversionCommand> = {}): DefineConversionCommand {
  return {
    scope,
    actor,
    sourcePresentationId,
    targetPresentationId,
    factor: "12",
    reversible: true,
    requiresAuthorization: false,
    wastePolicy: null,
    costPolicy: null,
    lotPolicy: null,
    idempotencyKey: "define-conversion:1",
    ...overrides,
  };
}

function newUseCase(presentationRepository: InMemoryProductPresentationRepository, conversionRepository: InMemoryUnitConversionRepository, allow = true) {
  return new DefineConversionUseCase(presentationRepository, conversionRepository, new FixedCatalogAuthorization(allow), clock, new SequentialIdGenerator());
}

describe("DefineConversionUseCase", () => {
  it("defines a conversion between two presentations of the same product and returns the domain event", async () => {
    const presentationRepository = new InMemoryProductPresentationRepository();
    const conversionRepository = new InMemoryUnitConversionRepository();
    const { source, target } = seed(presentationRepository);
    const useCase = newUseCase(presentationRepository, conversionRepository);

    const result = await useCase.execute(command(source.id, target.id));

    expect(result.kind).toBe("DEFINED");
    if (result.kind !== "DEFINED") throw new Error("unreachable");
    expect(result.conversion.sourcePresentationId).toBe(source.id);
    expect(result.conversion.targetPresentationId).toBe(target.id);
    expect(result.event.type).toBe("ProductPresentationConversionDefined");
  });

  it("rejects without touching the repository when unauthorized", async () => {
    const presentationRepository = new InMemoryProductPresentationRepository();
    const conversionRepository = new InMemoryUnitConversionRepository();
    const { source, target } = seed(presentationRepository);
    const useCase = newUseCase(presentationRepository, conversionRepository, false);

    const result = await useCase.execute(command(source.id, target.id));

    expect(result).toEqual({ kind: "REJECTED", reason: "NOT_AUTHORIZED" });
    expect(conversionRepository.saved).toHaveLength(0);
  });

  it("rejects a non-existent source presentation", async () => {
    const presentationRepository = new InMemoryProductPresentationRepository();
    const conversionRepository = new InMemoryUnitConversionRepository();
    const { target } = seed(presentationRepository);
    const useCase = newUseCase(presentationRepository, conversionRepository);

    const result = await useCase.execute(command("018f0000-0000-7000-8000-000000009999", target.id));

    expect(result).toEqual({ kind: "REJECTED", reason: "SOURCE_NOT_FOUND" });
  });

  it("rejects a non-existent target presentation", async () => {
    const presentationRepository = new InMemoryProductPresentationRepository();
    const conversionRepository = new InMemoryUnitConversionRepository();
    const { source } = seed(presentationRepository);
    const useCase = newUseCase(presentationRepository, conversionRepository);

    const result = await useCase.execute(command(source.id, "018f0000-0000-7000-8000-000000009999"));

    expect(result).toEqual({ kind: "REJECTED", reason: "TARGET_NOT_FOUND" });
  });

  it("rejects source === target", async () => {
    const presentationRepository = new InMemoryProductPresentationRepository();
    const conversionRepository = new InMemoryUnitConversionRepository();
    const { source } = seed(presentationRepository);
    const useCase = newUseCase(presentationRepository, conversionRepository);

    const result = await useCase.execute(command(source.id, source.id));

    expect(result).toEqual({ kind: "REJECTED", reason: "SAME_PRESENTATION" });
  });

  it("rejects two presentations of DIFFERENT products (DEC-004 'Invariante de conversión')", async () => {
    const presentationRepository = new InMemoryProductPresentationRepository();
    const conversionRepository = new InMemoryUnitConversionRepository();
    const source = presentation("018f0000-0000-7000-8000-000000000700");
    const targetOfOtherProduct = presentation("018f0000-0000-7000-8000-000000000710", { productId: "018f0000-0000-7000-8000-000000000501" });
    void presentationRepository.save(source, "seed-source");
    void presentationRepository.save(targetOfOtherProduct, "seed-target");
    const useCase = newUseCase(presentationRepository, conversionRepository);

    const result = await useCase.execute(command(source.id, targetOfOtherProduct.id));

    expect(result).toEqual({ kind: "REJECTED", reason: "PRODUCT_MISMATCH" });
  });

  it("rejects two presentations of DIFFERENT variants of the same product", async () => {
    const presentationRepository = new InMemoryProductPresentationRepository();
    const conversionRepository = new InMemoryUnitConversionRepository();
    const source = presentation("018f0000-0000-7000-8000-000000000700", { variantId: "018f0000-0000-7000-8000-000000000600" });
    const target = presentation("018f0000-0000-7000-8000-000000000710", { variantId: "018f0000-0000-7000-8000-000000000601" });
    void presentationRepository.save(source, "seed-source");
    void presentationRepository.save(target, "seed-target");
    const useCase = newUseCase(presentationRepository, conversionRepository);

    const result = await useCase.execute(command(source.id, target.id));

    expect(result).toEqual({ kind: "REJECTED", reason: "VARIANT_MISMATCH" });
  });

  it("rejects a non-positive factor", async () => {
    const presentationRepository = new InMemoryProductPresentationRepository();
    const conversionRepository = new InMemoryUnitConversionRepository();
    const { source, target } = seed(presentationRepository);
    const useCase = newUseCase(presentationRepository, conversionRepository);

    const result = await useCase.execute(command(source.id, target.id, { factor: "0" }));

    expect(result).toEqual({ kind: "REJECTED", reason: "INVALID_FACTOR" });
  });

  it("idempotent replay: the SAME idempotencyKey returns the same conversion without duplicating it", async () => {
    const presentationRepository = new InMemoryProductPresentationRepository();
    const conversionRepository = new InMemoryUnitConversionRepository();
    const { source, target } = seed(presentationRepository);
    const useCase = newUseCase(presentationRepository, conversionRepository);

    const first = await useCase.execute(command(source.id, target.id));
    const replay = await useCase.execute(command(source.id, target.id));

    expect(replay.kind).toBe("ALREADY_DEFINED");
    if (replay.kind !== "ALREADY_DEFINED" || first.kind !== "DEFINED") throw new Error("unreachable");
    expect(replay.conversion.id).toBe(first.conversion.id);
    expect(conversionRepository.saved).toHaveLength(1);
  });
});
