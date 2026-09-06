import { describe, expect, it } from "vitest";
import { Actor, CompanyScope, Product, type VariantPolicy } from "@pos-platform/domain";
import { CreateVariantUseCase, type CreateVariantCommand } from "../src/index.js";
import {
  FixedCatalogAuthorization,
  FixedClock,
  FixedVariantCanonicalKeyPolicy,
  InMemoryProductRepository,
  InMemoryProductVariantRepository,
  SequentialIdGenerator,
} from "./fakes.js";

const scope = new CompanyScope("018f0000-0000-7000-8000-000000000010", "018f0000-0000-7000-8000-000000000011");
const actor = Actor.forUser("018f0000-0000-7000-8000-000000000030");
const clock = new FixedClock(new Date("2026-09-02T08:00:00Z"));

function seedProduct(repository: InMemoryProductRepository, variantPolicy: VariantPolicy = "OPTIONAL_VARIANTS", status: "ACTIVE" | "INACTIVE" = "ACTIVE"): Product {
  let product = Product.create({
    id: "018f0000-0000-7000-8000-000000000500",
    scope,
    internalCode: "SKU-1",
    name: "Camiseta deportiva",
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
    variantPolicy,
  });
  if (status === "INACTIVE") product = product.deactivate(1);
  void repository.save(product, "seed");
  return product;
}

function command(productId: string, overrides: Partial<CreateVariantCommand> = {}): CreateVariantCommand {
  return { scope, actor, productId, attributes: { color: "azul", talla: "M" }, idempotencyKey: "create-variant:1", ...overrides };
}

function newUseCase(productRepository: InMemoryProductRepository, variantRepository: InMemoryProductVariantRepository, allow = true) {
  return new CreateVariantUseCase(
    productRepository, variantRepository, new FixedCatalogAuthorization(allow),
    new FixedVariantCanonicalKeyPolicy(), clock, new SequentialIdGenerator(),
  );
}

describe("CreateVariantUseCase", () => {
  it("creates a variant and returns the domain event when authorized and the product allows variants", async () => {
    const productRepository = new InMemoryProductRepository();
    const variantRepository = new InMemoryProductVariantRepository();
    const product = seedProduct(productRepository);
    const useCase = newUseCase(productRepository, variantRepository);

    const result = await useCase.execute(command(product.id));

    expect(result.kind).toBe("CREATED");
    if (result.kind !== "CREATED") throw new Error("unreachable");
    expect(result.variant.productId).toBe(product.id);
    expect(result.variant.canonicalKey).toBe("color=azul|talla=M");
    expect(result.event.type).toBe("ProductVariantCreated");
  });

  it("rejects without touching the repository when unauthorized", async () => {
    const productRepository = new InMemoryProductRepository();
    const variantRepository = new InMemoryProductVariantRepository();
    const product = seedProduct(productRepository);
    const useCase = newUseCase(productRepository, variantRepository, false);

    const result = await useCase.execute(command(product.id));

    expect(result).toEqual({ kind: "REJECTED", reason: "NOT_AUTHORIZED" });
    expect(variantRepository.saved).toHaveLength(0);
  });

  it("rejects a product that does not exist in scope", async () => {
    const productRepository = new InMemoryProductRepository();
    const variantRepository = new InMemoryProductVariantRepository();
    const useCase = newUseCase(productRepository, variantRepository);

    const result = await useCase.execute(command("018f0000-0000-7000-8000-000000009999"));

    expect(result).toEqual({ kind: "REJECTED", reason: "PRODUCT_NOT_FOUND" });
  });

  it("rejects an INACTIVE product (UC-CAT-004 exception 'producto inactivo')", async () => {
    const productRepository = new InMemoryProductRepository();
    const variantRepository = new InMemoryProductVariantRepository();
    const product = seedProduct(productRepository, "OPTIONAL_VARIANTS", "INACTIVE");
    const useCase = newUseCase(productRepository, variantRepository);

    const result = await useCase.execute(command(product.id));

    expect(result).toEqual({ kind: "REJECTED", reason: "PRODUCT_INACTIVE" });
  });

  it("rejects a variant when the product's variantPolicy is NO_VARIANTS (DEC-004, closed)", async () => {
    const productRepository = new InMemoryProductRepository();
    const variantRepository = new InMemoryProductVariantRepository();
    const product = seedProduct(productRepository, "NO_VARIANTS");
    const useCase = newUseCase(productRepository, variantRepository);

    const result = await useCase.execute(command(product.id));

    expect(result).toEqual({ kind: "REJECTED", reason: "VARIANT_NOT_ALLOWED" });
  });

  it("rejects an empty attribute set", async () => {
    const productRepository = new InMemoryProductRepository();
    const variantRepository = new InMemoryProductVariantRepository();
    const product = seedProduct(productRepository);
    const useCase = newUseCase(productRepository, variantRepository);

    const result = await useCase.execute(command(product.id, { attributes: {} }));

    expect(result).toEqual({ kind: "REJECTED", reason: "EMPTY_ATTRIBUTES" });
  });

  it("DUPLICATE DETECTION: rejects a second variant with the same canonical key, even with attributes given in a different order (UC-CAT-004 rule 2)", async () => {
    const productRepository = new InMemoryProductRepository();
    const variantRepository = new InMemoryProductVariantRepository();
    const product = seedProduct(productRepository);
    const useCase = newUseCase(productRepository, variantRepository);

    const first = await useCase.execute(command(product.id));
    expect(first.kind).toBe("CREATED");

    const second = await useCase.execute(
      command(product.id, { attributes: { talla: "M", color: "azul" }, idempotencyKey: "create-variant:2" }),
    );

    expect(second).toEqual({ kind: "REJECTED", reason: "VARIANT_ALREADY_EXISTS" });
    expect(variantRepository.saved).toHaveLength(1);
  });

  it("idempotent replay: the SAME idempotencyKey returns the same variant without duplicating it", async () => {
    const productRepository = new InMemoryProductRepository();
    const variantRepository = new InMemoryProductVariantRepository();
    const product = seedProduct(productRepository);
    const useCase = newUseCase(productRepository, variantRepository);

    const first = await useCase.execute(command(product.id));
    const replay = await useCase.execute(command(product.id));

    expect(replay.kind).toBe("ALREADY_CREATED");
    if (replay.kind !== "ALREADY_CREATED" || first.kind !== "CREATED") throw new Error("unreachable");
    expect(replay.variant.id).toBe(first.variant.id);
    expect(variantRepository.saved).toHaveLength(1);
  });
});
