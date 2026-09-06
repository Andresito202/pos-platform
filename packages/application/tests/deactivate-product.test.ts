import { describe, expect, it } from "vitest";
import { Actor, CompanyScope, Product } from "@pos-platform/domain";
import { DeactivateProductUseCase, type DeactivateProductCommand } from "../src/index.js";
import { FixedCatalogAuthorization, FixedClock, InMemoryProductRepository } from "./fakes.js";

const scope = new CompanyScope("018f0000-0000-7000-8000-000000000010", "018f0000-0000-7000-8000-000000000011");
const actor = Actor.forUser("018f0000-0000-7000-8000-000000000030");
const clock = new FixedClock(new Date("2026-09-02T08:00:00Z"));

function seedProduct(repository: InMemoryProductRepository): Product {
  const product = Product.create({
    id: "018f0000-0000-7000-8000-000000000500",
    scope,
    internalCode: "SKU-1",
    name: "Arroz 500g",
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
  });
  void repository.save(product, "seed");
  return product;
}

function command(productId: string, overrides: Partial<DeactivateProductCommand> = {}): DeactivateProductCommand {
  return { scope, actor, productId, expectedVersion: 1, idempotencyKey: "deactivate-product:1", ...overrides };
}

describe("DeactivateProductUseCase", () => {
  it("deactivates the product, keeps its identity, and returns the domain event", async () => {
    const repository = new InMemoryProductRepository();
    const product = seedProduct(repository);
    const useCase = new DeactivateProductUseCase(repository, new FixedCatalogAuthorization(true), clock);

    const result = await useCase.execute(command(product.id));

    expect(result.kind).toBe("DEACTIVATED");
    if (result.kind !== "DEACTIVATED") throw new Error("unreachable");
    expect(result.product.status).toBe("INACTIVE");
    expect(result.product.id).toBe(product.id);
    expect(result.event.type).toBe("ProductDeactivated");
  });

  it("rejects without touching the repository when unauthorized", async () => {
    const repository = new InMemoryProductRepository();
    const product = seedProduct(repository);
    const useCase = new DeactivateProductUseCase(repository, new FixedCatalogAuthorization(false), clock);

    const result = await useCase.execute(command(product.id));

    expect(result).toEqual({ kind: "REJECTED", reason: "NOT_AUTHORIZED" });
    expect(repository.savedDeactivations).toHaveLength(0);
  });

  it("rejects a stale expectedVersion", async () => {
    const repository = new InMemoryProductRepository();
    const product = seedProduct(repository);
    const useCase = new DeactivateProductUseCase(repository, new FixedCatalogAuthorization(true), clock);

    const result = await useCase.execute(command(product.id, { expectedVersion: 99 }));

    expect(result).toEqual({ kind: "REJECTED", reason: "VERSION_CONFLICT" });
  });

  it("rejects deactivating an already-INACTIVE product outside of idempotent replay", async () => {
    const repository = new InMemoryProductRepository();
    const product = seedProduct(repository);
    const useCase = new DeactivateProductUseCase(repository, new FixedCatalogAuthorization(true), clock);

    await useCase.execute(command(product.id));
    const second = await useCase.execute(command(product.id, { idempotencyKey: "deactivate-product:2", expectedVersion: 2 }));

    expect(second).toEqual({ kind: "REJECTED", reason: "ALREADY_INACTIVE" });
  });

  it("idempotent replay: the SAME idempotencyKey returns the same result", async () => {
    const repository = new InMemoryProductRepository();
    const product = seedProduct(repository);
    const useCase = new DeactivateProductUseCase(repository, new FixedCatalogAuthorization(true), clock);

    const first = await useCase.execute(command(product.id));
    const replay = await useCase.execute(command(product.id));

    expect(replay.kind).toBe("ALREADY_APPLIED");
    if (replay.kind !== "ALREADY_APPLIED" || first.kind !== "DEACTIVATED") throw new Error("unreachable");
    expect(replay.product.id).toBe(first.product.id);
    expect(repository.savedDeactivations).toHaveLength(1);
  });
});
