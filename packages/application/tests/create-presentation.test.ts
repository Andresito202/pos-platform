import { describe, expect, it } from "vitest";
import { Actor, CompanyScope, Product, ProductVariant, VariantAttributes } from "@pos-platform/domain";
import { CreatePresentationUseCase, type CreatePresentationCommand } from "../src/index.js";
import {
  FixedCatalogAuthorization,
  FixedClock,
  InMemoryProductPresentationRepository,
  InMemoryProductRepository,
  InMemoryProductVariantRepository,
  SequentialIdGenerator,
} from "./fakes.js";

const scope = new CompanyScope("018f0000-0000-7000-8000-000000000010", "018f0000-0000-7000-8000-000000000011");
const otherScope = new CompanyScope("018f0000-0000-7000-8000-000000000010", "018f0000-0000-7000-8000-0000000000cc");
const actor = Actor.forUser("018f0000-0000-7000-8000-000000000030");
const clock = new FixedClock(new Date("2026-09-02T08:00:00Z"));

function seedProduct(repository: InMemoryProductRepository, status: "ACTIVE" | "INACTIVE" = "ACTIVE"): Product {
  let product = Product.create({
    id: "018f0000-0000-7000-8000-000000000500",
    scope,
    internalCode: "SKU-1",
    name: "Arroz Roa",
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
    variantPolicy: "OPTIONAL_VARIANTS",
  });
  if (status === "INACTIVE") product = product.deactivate(1);
  void repository.save(product, "seed");
  return product;
}

function command(productId: string, overrides: Partial<CreatePresentationCommand> = {}): CreatePresentationCommand {
  return {
    scope,
    actor,
    productId,
    variantId: null,
    name: "bolsa 1kg",
    internalSku: "ARROZ-1KG",
    unitId: "018f0000-0000-7000-8000-000000000900",
    containedQuantity: "1",
    variableQuantity: false,
    salesEnabled: true,
    purchasingEnabled: true,
    breakable: false,
    stockMode: "INDEPENDENT",
    idempotencyKey: "create-presentation:1",
    ...overrides,
  };
}

function newUseCase(
  productRepository: InMemoryProductRepository,
  variantRepository: InMemoryProductVariantRepository,
  presentationRepository: InMemoryProductPresentationRepository,
  allow = true,
) {
  return new CreatePresentationUseCase(
    productRepository, variantRepository, presentationRepository, new FixedCatalogAuthorization(allow), clock, new SequentialIdGenerator(),
  );
}

describe("CreatePresentationUseCase", () => {
  it("creates a presentation directly on the product (no variant) and returns the domain event", async () => {
    const productRepository = new InMemoryProductRepository();
    const variantRepository = new InMemoryProductVariantRepository();
    const presentationRepository = new InMemoryProductPresentationRepository();
    const product = seedProduct(productRepository);
    const useCase = newUseCase(productRepository, variantRepository, presentationRepository);

    const result = await useCase.execute(command(product.id));

    expect(result.kind).toBe("CREATED");
    if (result.kind !== "CREATED") throw new Error("unreachable");
    expect(result.presentation.productId).toBe(product.id);
    expect(result.presentation.variantId).toBeNull();
    expect(result.event.type).toBe("ProductPresentationCreated");
  });

  it("rejects without touching the repository when unauthorized", async () => {
    const productRepository = new InMemoryProductRepository();
    const variantRepository = new InMemoryProductVariantRepository();
    const presentationRepository = new InMemoryProductPresentationRepository();
    const product = seedProduct(productRepository);
    const useCase = newUseCase(productRepository, variantRepository, presentationRepository, false);

    const result = await useCase.execute(command(product.id));

    expect(result).toEqual({ kind: "REJECTED", reason: "NOT_AUTHORIZED" });
    expect(presentationRepository.saved).toHaveLength(0);
  });

  it("rejects a product that does not exist in scope", async () => {
    const productRepository = new InMemoryProductRepository();
    const variantRepository = new InMemoryProductVariantRepository();
    const presentationRepository = new InMemoryProductPresentationRepository();
    const useCase = newUseCase(productRepository, variantRepository, presentationRepository);

    const result = await useCase.execute(command("018f0000-0000-7000-8000-000000009999"));

    expect(result).toEqual({ kind: "REJECTED", reason: "PRODUCT_NOT_FOUND" });
  });

  it("rejects an INACTIVE product (UC-CAT-005 precondition 'Producto activo')", async () => {
    const productRepository = new InMemoryProductRepository();
    const variantRepository = new InMemoryProductVariantRepository();
    const presentationRepository = new InMemoryProductPresentationRepository();
    const product = seedProduct(productRepository, "INACTIVE");
    const useCase = newUseCase(productRepository, variantRepository, presentationRepository);

    const result = await useCase.execute(command(product.id));

    expect(result).toEqual({ kind: "REJECTED", reason: "PRODUCT_INACTIVE" });
  });

  it("accepts a variant that genuinely belongs to the same product", async () => {
    const productRepository = new InMemoryProductRepository();
    const variantRepository = new InMemoryProductVariantRepository();
    const presentationRepository = new InMemoryProductPresentationRepository();
    const product = seedProduct(productRepository);
    const variant = ProductVariant.create({
      id: "018f0000-0000-7000-8000-000000000600",
      scope,
      productId: product.id,
      attributes: VariantAttributes.fromRecord({ color: "azul" }),
      canonicalKey: "color=azul",
    });
    void variantRepository.save(variant, "seed-variant");
    const useCase = newUseCase(productRepository, variantRepository, presentationRepository);

    const result = await useCase.execute(command(product.id, { variantId: variant.id }));

    expect(result.kind).toBe("CREATED");
  });

  it("REJECTS a Presentation whose variantId belongs to a DIFFERENT product (DEC-004 escenario 5, CATALOG_VARIANT_PRODUCT_MISMATCH)", async () => {
    const productRepository = new InMemoryProductRepository();
    const variantRepository = new InMemoryProductVariantRepository();
    const presentationRepository = new InMemoryProductPresentationRepository();
    const productA = seedProduct(productRepository);
    let productB = Product.create({
      id: "018f0000-0000-7000-8000-000000000501",
      scope,
      internalCode: "SKU-2",
      name: "Producto B",
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
      variantPolicy: "OPTIONAL_VARIANTS",
    });
    void productRepository.save(productB, "seed-b");
    const variantOfB = ProductVariant.create({
      id: "018f0000-0000-7000-8000-000000000601",
      scope,
      productId: productB.id,
      attributes: VariantAttributes.fromRecord({ color: "roja" }),
      canonicalKey: "color=roja",
    });
    void variantRepository.save(variantOfB, "seed-variant-b");
    const useCase = newUseCase(productRepository, variantRepository, presentationRepository);

    const result = await useCase.execute(command(productA.id, { variantId: variantOfB.id }));

    expect(result).toEqual({ kind: "REJECTED", reason: "VARIANT_PRODUCT_MISMATCH" });
  });

  it("rejects a non-existent variant id", async () => {
    const productRepository = new InMemoryProductRepository();
    const variantRepository = new InMemoryProductVariantRepository();
    const presentationRepository = new InMemoryProductPresentationRepository();
    const product = seedProduct(productRepository);
    const useCase = newUseCase(productRepository, variantRepository, presentationRepository);

    const result = await useCase.execute(command(product.id, { variantId: "018f0000-0000-7000-8000-000000009999" }));

    expect(result).toEqual({ kind: "REJECTED", reason: "VARIANT_NOT_FOUND" });
  });

  it("rejects an invalid contained quantity", async () => {
    const productRepository = new InMemoryProductRepository();
    const variantRepository = new InMemoryProductVariantRepository();
    const presentationRepository = new InMemoryProductPresentationRepository();
    const product = seedProduct(productRepository);
    const useCase = newUseCase(productRepository, variantRepository, presentationRepository);

    const result = await useCase.execute(command(product.id, { containedQuantity: "not-a-number" }));

    expect(result).toEqual({ kind: "REJECTED", reason: "INVALID_QUANTITY" });
  });

  it("rejects a non-positive contained quantity", async () => {
    const productRepository = new InMemoryProductRepository();
    const variantRepository = new InMemoryProductVariantRepository();
    const presentationRepository = new InMemoryProductPresentationRepository();
    const product = seedProduct(productRepository);
    const useCase = newUseCase(productRepository, variantRepository, presentationRepository);

    const result = await useCase.execute(command(product.id, { containedQuantity: "0" }));

    expect(result).toEqual({ kind: "REJECTED", reason: "NON_POSITIVE_QUANTITY" });
  });

  it("SKU UNIQUENESS: rejects a SKU already used by another presentation in the same company", async () => {
    const productRepository = new InMemoryProductRepository();
    const variantRepository = new InMemoryProductVariantRepository();
    const presentationRepository = new InMemoryProductPresentationRepository();
    const product = seedProduct(productRepository);
    const useCase = newUseCase(productRepository, variantRepository, presentationRepository);

    const first = await useCase.execute(command(product.id));
    expect(first.kind).toBe("CREATED");

    const second = await useCase.execute(command(product.id, { idempotencyKey: "create-presentation:2", name: "otra presentación" }));

    expect(second).toEqual({ kind: "REJECTED", reason: "SKU_ALREADY_EXISTS" });
    expect(presentationRepository.saved).toHaveLength(1);
  });

  it("does NOT treat a null SKU as a conflict across two presentations", async () => {
    const productRepository = new InMemoryProductRepository();
    const variantRepository = new InMemoryProductVariantRepository();
    const presentationRepository = new InMemoryProductPresentationRepository();
    const product = seedProduct(productRepository);
    const useCase = newUseCase(productRepository, variantRepository, presentationRepository);

    const first = await useCase.execute(command(product.id, { internalSku: null }));
    const second = await useCase.execute(command(product.id, { internalSku: null, idempotencyKey: "create-presentation:2" }));

    expect(first.kind).toBe("CREATED");
    expect(second.kind).toBe("CREATED");
  });

  it("COMPANY ISOLATION: the same SKU is not taken across different companies", async () => {
    const productRepository = new InMemoryProductRepository();
    const variantRepository = new InMemoryProductVariantRepository();
    const presentationRepository = new InMemoryProductPresentationRepository();
    const product = seedProduct(productRepository);
    let otherProduct = Product.create({
      id: "018f0000-0000-7000-8000-000000000502",
      scope: otherScope,
      internalCode: "SKU-1",
      name: "Arroz Roa",
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
      variantPolicy: "OPTIONAL_VARIANTS",
    });
    void productRepository.save(otherProduct, "seed-other");
    const useCase = newUseCase(productRepository, variantRepository, presentationRepository);

    const first = await useCase.execute(command(product.id));
    const second = await useCase.execute(command(otherProduct.id, { scope: otherScope, idempotencyKey: "create-presentation:2" }));

    expect(first.kind).toBe("CREATED");
    expect(second.kind).toBe("CREATED");
  });

  it("idempotent replay: the SAME idempotencyKey returns the same presentation without duplicating it", async () => {
    const productRepository = new InMemoryProductRepository();
    const variantRepository = new InMemoryProductVariantRepository();
    const presentationRepository = new InMemoryProductPresentationRepository();
    const product = seedProduct(productRepository);
    const useCase = newUseCase(productRepository, variantRepository, presentationRepository);

    const first = await useCase.execute(command(product.id));
    const replay = await useCase.execute(command(product.id));

    expect(replay.kind).toBe("ALREADY_CREATED");
    if (replay.kind !== "ALREADY_CREATED" || first.kind !== "CREATED") throw new Error("unreachable");
    expect(replay.presentation.id).toBe(first.presentation.id);
    expect(presentationRepository.saved).toHaveLength(1);
  });
});
