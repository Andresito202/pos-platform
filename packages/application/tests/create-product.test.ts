import { describe, expect, it } from "vitest";
import { Actor, CompanyScope } from "@pos-platform/domain";
import { CreateProductUseCase, type CreateProductCommand } from "../src/index.js";
import { FixedCatalogAuthorization, FixedClock, InMemoryProductRepository, SequentialIdGenerator } from "./fakes.js";

const companyScope = new CompanyScope("018f0000-0000-7000-8000-000000000010", "018f0000-0000-7000-8000-000000000011");
const otherCompanyScope = new CompanyScope("018f0000-0000-7000-8000-000000000010", "018f0000-0000-7000-8000-0000000000cc");
const actor = Actor.device("018f0000-0000-7000-8000-000000000030");
const clock = new FixedClock(new Date("2026-09-02T08:00:00Z"));

function command(overrides: Partial<CreateProductCommand> = {}): CreateProductCommand {
  return {
    scope: companyScope,
    actor,
    internalCode: "SKU-0001",
    name: "Coca-Cola 350ml",
    description: null,
    categoryId: "018f0000-0000-7000-8000-000000000050",
    brandId: null,
    productType: "STANDARD",
    stockControlled: true,
    lotControlled: false,
    expirationControlled: false,
    serialControlled: false,
    taxCategoryId: null,
    baseUnitId: "018f0000-0000-7000-8000-000000000060",
    variantPolicy: "NO_VARIANTS",
    idempotencyKey: "create-product:1",
    ...overrides,
  };
}

describe("CreateProductUseCase", () => {
  it("creates a product, persists it, and returns the domain event when authorized and no conflict", async () => {
    const repository = new InMemoryProductRepository();
    const useCase = new CreateProductUseCase(repository, new FixedCatalogAuthorization(true), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command());

    expect(result.kind).toBe("CREATED");
    if (result.kind !== "CREATED") throw new Error("unreachable");
    expect(result.product.name).toBe("Coca-Cola 350ml");
    expect(result.product.status).toBe("ACTIVE");
    expect(result.event.type).toBe("ProductCreated");
    expect(result.event.companyId).toBe(companyScope.companyId);
    expect(repository.saved).toHaveLength(1);
  });

  it("rejects without touching the repository when the actor is not authorized", async () => {
    const repository = new InMemoryProductRepository();
    const useCase = new CreateProductUseCase(repository, new FixedCatalogAuthorization(false), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command());

    expect(result).toEqual({ kind: "REJECTED", reason: "NOT_AUTHORIZED" });
    expect(repository.saved).toHaveLength(0);
  });

  it("idempotent replay: retrying with the SAME idempotency key returns the same product without duplicating it", async () => {
    const repository = new InMemoryProductRepository();
    const useCase = new CreateProductUseCase(repository, new FixedCatalogAuthorization(true), clock, new SequentialIdGenerator());

    const first = await useCase.execute(command());
    expect(first.kind).toBe("CREATED");

    const replay = await useCase.execute(command());

    expect(replay.kind).toBe("ALREADY_CREATED");
    if (replay.kind !== "ALREADY_CREATED" || first.kind !== "CREATED") throw new Error("unreachable");
    expect(replay.product.id).toBe(first.product.id);
    expect(repository.saved).toHaveLength(1);
  });

  it("rejects an empty product name without persisting", async () => {
    const repository = new InMemoryProductRepository();
    const useCase = new CreateProductUseCase(repository, new FixedCatalogAuthorization(true), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command({ name: "   " }));

    expect(result).toEqual({ kind: "REJECTED", reason: "EMPTY_NAME" });
    expect(repository.saved).toHaveLength(0);
  });

  it("rejects expiration control requested without lot control", async () => {
    const repository = new InMemoryProductRepository();
    const useCase = new CreateProductUseCase(repository, new FixedCatalogAuthorization(true), clock, new SequentialIdGenerator());

    const result = await useCase.execute(command({ expirationControlled: true, lotControlled: false }));

    expect(result).toEqual({ kind: "REJECTED", reason: "EXPIRATION_REQUIRES_LOT_CONTROL" });
    expect(repository.saved).toHaveLength(0);
  });

  it("rejects an internal code that already exists in scope, even under a different idempotency key", async () => {
    const repository = new InMemoryProductRepository();
    const useCase = new CreateProductUseCase(repository, new FixedCatalogAuthorization(true), clock, new SequentialIdGenerator());

    const first = await useCase.execute(command());
    expect(first.kind).toBe("CREATED");

    const result = await useCase.execute(command({ idempotencyKey: "create-product:2", name: "Coca-Cola 600ml" }));

    expect(result).toEqual({ kind: "REJECTED", reason: "INTERNAL_CODE_EXISTS" });
    expect(repository.saved).toHaveLength(1);
  });

  it("does not treat a null internal code as a conflict — code uniqueness only applies when a code is supplied", async () => {
    const repository = new InMemoryProductRepository();
    const useCase = new CreateProductUseCase(repository, new FixedCatalogAuthorization(true), clock, new SequentialIdGenerator());

    const first = await useCase.execute(command({ internalCode: null, idempotencyKey: "create-product:1" }));
    const second = await useCase.execute(command({ internalCode: null, idempotencyKey: "create-product:2" }));

    expect(first.kind).toBe("CREATED");
    expect(second.kind).toBe("CREATED");
    expect(repository.saved).toHaveLength(2);
  });

  it("COMPANY ISOLATION: the same internal code is not taken across different companies", async () => {
    const repository = new InMemoryProductRepository();
    const useCase = new CreateProductUseCase(repository, new FixedCatalogAuthorization(true), clock, new SequentialIdGenerator());

    const first = await useCase.execute(command());
    const second = await useCase.execute(command({ scope: otherCompanyScope, idempotencyKey: "create-product:2" }));

    expect(first.kind).toBe("CREATED");
    expect(second.kind).toBe("CREATED");
    expect(repository.saved).toHaveLength(2);
  });

  it("propagates a repository failure instead of swallowing it", async () => {
    const repository = new InMemoryProductRepository();
    repository.save = async () => { throw new Error("repository unavailable"); };
    const useCase = new CreateProductUseCase(repository, new FixedCatalogAuthorization(true), clock, new SequentialIdGenerator());

    await expect(useCase.execute(command())).rejects.toThrow("repository unavailable");
  });
});
