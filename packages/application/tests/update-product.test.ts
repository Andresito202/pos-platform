import { describe, expect, it } from "vitest";
import { Actor, CompanyScope, Product } from "@pos-platform/domain";
import { UpdateProductUseCase, type UpdateProductCommand } from "../src/index.js";
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

function command(productId: string, overrides: Partial<UpdateProductCommand> = {}): UpdateProductCommand {
  return {
    scope,
    actor,
    productId,
    name: "Arroz Roa 500g",
    description: "actualizado",
    categoryId: "018f0000-0000-7000-8000-000000000050",
    brandId: null,
    expectedVersion: 1,
    idempotencyKey: "update-product:1",
    ...overrides,
  };
}

describe("UpdateProductUseCase", () => {
  it("updates the product and returns the domain event when authorized", async () => {
    const repository = new InMemoryProductRepository();
    const product = seedProduct(repository);
    const useCase = new UpdateProductUseCase(repository, new FixedCatalogAuthorization(true), clock);

    const result = await useCase.execute(command(product.id));

    expect(result.kind).toBe("UPDATED");
    if (result.kind !== "UPDATED") throw new Error("unreachable");
    expect(result.product.name).toBe("Arroz Roa 500g");
    expect(result.product.version).toBe(2);
    expect(result.event.type).toBe("ProductUpdated");
    expect(repository.savedUpdates).toHaveLength(1);
  });

  it("rejects without touching the repository when unauthorized", async () => {
    const repository = new InMemoryProductRepository();
    const product = seedProduct(repository);
    const useCase = new UpdateProductUseCase(repository, new FixedCatalogAuthorization(false), clock);

    const result = await useCase.execute(command(product.id));

    expect(result).toEqual({ kind: "REJECTED", reason: "NOT_AUTHORIZED" });
    expect(repository.savedUpdates).toHaveLength(0);
  });

  it("rejects a product that does not exist in scope", async () => {
    const repository = new InMemoryProductRepository();
    const useCase = new UpdateProductUseCase(repository, new FixedCatalogAuthorization(true), clock);

    const result = await useCase.execute(command("018f0000-0000-7000-8000-000000009999"));

    expect(result).toEqual({ kind: "REJECTED", reason: "NOT_FOUND" });
  });

  it("rejects an empty name without persisting", async () => {
    const repository = new InMemoryProductRepository();
    const product = seedProduct(repository);
    const useCase = new UpdateProductUseCase(repository, new FixedCatalogAuthorization(true), clock);

    const result = await useCase.execute(command(product.id, { name: "   " }));

    expect(result).toEqual({ kind: "REJECTED", reason: "EMPTY_NAME" });
    expect(repository.savedUpdates).toHaveLength(0);
  });

  it("rejects a stale expectedVersion on a genuinely new request", async () => {
    const repository = new InMemoryProductRepository();
    const product = seedProduct(repository);
    const useCase = new UpdateProductUseCase(repository, new FixedCatalogAuthorization(true), clock);

    const result = await useCase.execute(command(product.id, { expectedVersion: 99 }));

    expect(result).toEqual({ kind: "REJECTED", reason: "VERSION_CONFLICT" });
  });

  it("idempotent replay: retrying the SAME idempotencyKey returns the same result without re-checking version, even if it is now stale", async () => {
    const repository = new InMemoryProductRepository();
    const product = seedProduct(repository);
    const useCase = new UpdateProductUseCase(repository, new FixedCatalogAuthorization(true), clock);

    const first = await useCase.execute(command(product.id));
    expect(first.kind).toBe("UPDATED");

    // A second, real update bumps the version to 3 — the ORIGINAL key must still replay cleanly.
    await useCase.execute(command(product.id, { idempotencyKey: "update-product:2", expectedVersion: 2, name: "third name" }));

    const replay = await useCase.execute(command(product.id));
    expect(replay.kind).toBe("ALREADY_APPLIED");
    if (replay.kind !== "ALREADY_APPLIED" || first.kind !== "UPDATED") throw new Error("unreachable");
    expect(replay.product.id).toBe(first.product.id);
    expect(repository.savedUpdates).toHaveLength(2);
  });
});
