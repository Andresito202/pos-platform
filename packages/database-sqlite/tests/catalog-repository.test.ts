import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Actor, CompanyScope, VariantAttributes, type IdentifierType } from "@pos-platform/domain";
import {
  AssignIdentifierUseCase,
  CreatePresentationUseCase,
  CreateProductUseCase,
  CreateVariantUseCase,
  DeactivateProductUseCase,
  DefineConversionUseCase,
  UpdateProductUseCase,
  type CatalogAuthorizationPort,
  type Clock,
  type IdGenerator,
  type IdentifierNormalizationPolicy,
  type VariantCanonicalKeyPolicy,
} from "@pos-platform/application";
import {
  LocalDatabase,
  SqliteProductIdentifierRepository,
  SqliteProductPresentationRepository,
  SqliteProductRepository,
  SqliteProductVariantRepository,
  SqliteUnitConversionRepository,
} from "../src/index.js";

const directories: string[] = [];
async function directory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "pos-catalog-"));
  directories.push(value);
  return value;
}
afterEach(async () => {
  for (const item of directories.splice(0)) await rm(item, { recursive: true, force: true });
});

class FixedClock implements Clock {
  constructor(private readonly at: Date) {}
  now(): Date { return this.at; }
}
const clock = new FixedClock(new Date("2026-09-02T08:00:00Z"));

class AlwaysAuthorized implements CatalogAuthorizationPort {
  async canCreateProduct(): Promise<boolean> { return true; }
  async canUpdateProduct(): Promise<boolean> { return true; }
  async canDeactivateProduct(): Promise<boolean> { return true; }
  async canCreateVariant(): Promise<boolean> { return true; }
  async canCreatePresentation(): Promise<boolean> { return true; }
  async canAssignIdentifier(): Promise<boolean> { return true; }
  async canDefineConversion(): Promise<boolean> { return true; }
}

class SequentialIdGenerator implements IdGenerator {
  private counter: number;
  constructor(start = 0) { this.counter = start; }
  newId(): string { this.counter += 1; return `018f0000-0000-7000-8000-00000000${String(this.counter).padStart(4, "0")}`; }
}

class SortedCanonicalKeyPolicy implements VariantCanonicalKeyPolicy {
  canonicalize(attributes: VariantAttributes): string {
    const record = attributes.toRecord();
    return Object.keys(record).sort().map((key) => `${key}=${record[key]}`).join("|");
  }
}

class IdentityNormalizationPolicy implements IdentifierNormalizationPolicy {
  normalize(_identifierType: IdentifierType, rawValue: string): string { return rawValue; }
}

const scope = new CompanyScope("018f0000-0000-7000-8000-000000000010", "018f0000-0000-7000-8000-000000000011");
const actor = Actor.forUser("018f0000-0000-7000-8000-000000000030");

function productCommand(overrides: Record<string, unknown> = {}) {
  return {
    scope,
    actor,
    internalCode: "SKU-1",
    name: "Arroz Roa",
    description: null,
    categoryId: "018f0000-0000-7000-8000-000000000050",
    brandId: null,
    productType: "STANDARD" as const,
    stockControlled: true,
    lotControlled: false,
    expirationControlled: false,
    serialControlled: false,
    taxCategoryId: null,
    baseUnitId: "018f0000-0000-7000-8000-000000000060",
    variantPolicy: "OPTIONAL_VARIANTS" as const,
    idempotencyKey: "create-product:1",
    ...overrides,
  };
}

describe("SqliteProductRepository (real SQLite, not a fake)", () => {
  it("CREATE / FIND: persists a product and reads it back with the same values", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const repository = new SqliteProductRepository(database);
      const useCase = new CreateProductUseCase(repository, new AlwaysAuthorized(), clock, new SequentialIdGenerator());

      const result = await useCase.execute(productCommand());
      expect(result.kind).toBe("CREATED");
      if (result.kind !== "CREATED") throw new Error("unreachable");

      const reloaded = await repository.findById(scope, result.product.id);
      expect(reloaded?.name).toBe("Arroz Roa");
      expect(reloaded?.version).toBe(1);
      expect(reloaded?.status).toBe("ACTIVE");
    } finally {
      database.close();
    }
  });

  it("UNIQUENESS: rejects a second product with the same internal_code in the same company", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const repository = new SqliteProductRepository(database);
      const useCase = new CreateProductUseCase(repository, new AlwaysAuthorized(), clock, new SequentialIdGenerator());

      await useCase.execute(productCommand());
      const second = await useCase.execute(productCommand({ idempotencyKey: "create-product:2", name: "Otro producto" }));

      expect(second).toEqual({ kind: "REJECTED", reason: "INTERNAL_CODE_EXISTS" });
    } finally {
      database.close();
    }
  });

  it("IDEMPOTENCY: replaying the SAME create idempotencyKey returns the ORIGINAL snapshot, unaffected by a later update", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const repository = new SqliteProductRepository(database);
      const createUseCase = new CreateProductUseCase(repository, new AlwaysAuthorized(), clock, new SequentialIdGenerator());
      const updateUseCase = new UpdateProductUseCase(repository, new AlwaysAuthorized(), clock);

      const created = await createUseCase.execute(productCommand());
      if (created.kind !== "CREATED") throw new Error("unreachable");

      await updateUseCase.execute({
        scope, actor, productId: created.product.id, name: "Nombre cambiado", description: null,
        categoryId: created.product.categoryId, brandId: null, expectedVersion: 1, idempotencyKey: "update-product:1",
      });

      const replay = await createUseCase.execute(productCommand());
      expect(replay.kind).toBe("ALREADY_CREATED");
      if (replay.kind !== "ALREADY_CREATED") throw new Error("unreachable");
      expect(replay.product.name).toBe("Arroz Roa");
      expect(replay.product.version).toBe(1);
    } finally {
      database.close();
    }
  });

  it("OPTIMISTIC CONCURRENCY (lost update prevention): first update succeeds, second update against the SAME stale version fails", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const repository = new SqliteProductRepository(database);
      const createUseCase = new CreateProductUseCase(repository, new AlwaysAuthorized(), clock, new SequentialIdGenerator());
      const updateUseCase = new UpdateProductUseCase(repository, new AlwaysAuthorized(), clock);
      const created = await createUseCase.execute(productCommand());
      if (created.kind !== "CREATED") throw new Error("unreachable");

      const first = await updateUseCase.execute({
        scope, actor, productId: created.product.id, name: "Primera actualización", description: null,
        categoryId: created.product.categoryId, brandId: null, expectedVersion: 1, idempotencyKey: "update-product:A",
      });
      const second = await updateUseCase.execute({
        scope, actor, productId: created.product.id, name: "Segunda actualización (versión obsoleta)", description: null,
        categoryId: created.product.categoryId, brandId: null, expectedVersion: 1, idempotencyKey: "update-product:B",
      });

      expect(first.kind).toBe("UPDATED");
      expect(second).toEqual({ kind: "REJECTED", reason: "VERSION_CONFLICT" });

      const reloaded = await repository.findById(scope, created.product.id);
      expect(reloaded?.name).toBe("Primera actualización");
      expect(reloaded?.version).toBe(2);
    } finally {
      database.close();
    }
  });

  it("REAL CONCURRENCY: two genuinely concurrent updates against the same version — exactly one succeeds", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const repository = new SqliteProductRepository(database);
      const createUseCase = new CreateProductUseCase(repository, new AlwaysAuthorized(), clock, new SequentialIdGenerator());
      const created = await createUseCase.execute(productCommand());
      if (created.kind !== "CREATED") throw new Error("unreachable");

      const useCaseA = new UpdateProductUseCase(repository, new AlwaysAuthorized(), clock);
      const useCaseB = new UpdateProductUseCase(repository, new AlwaysAuthorized(), clock);

      const [resultA, resultB] = await Promise.all([
        useCaseA.execute({
          scope, actor, productId: created.product.id, name: "Concurrente A", description: null,
          categoryId: created.product.categoryId, brandId: null, expectedVersion: 1, idempotencyKey: "update-product:concurrent-A",
        }),
        useCaseB.execute({
          scope, actor, productId: created.product.id, name: "Concurrente B", description: null,
          categoryId: created.product.categoryId, brandId: null, expectedVersion: 1, idempotencyKey: "update-product:concurrent-B",
        }),
      ]);

      const outcomes = [resultA.kind, resultB.kind].sort();
      expect(outcomes).toEqual(["REJECTED", "UPDATED"]);
    } finally {
      database.close();
    }
  });

  it("DEACTIVATE: transitions to INACTIVE, identity remains stable, repeated deactivation outside replay is rejected", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const repository = new SqliteProductRepository(database);
      const createUseCase = new CreateProductUseCase(repository, new AlwaysAuthorized(), clock, new SequentialIdGenerator());
      const deactivateUseCase = new DeactivateProductUseCase(repository, new AlwaysAuthorized(), clock);
      const created = await createUseCase.execute(productCommand());
      if (created.kind !== "CREATED") throw new Error("unreachable");

      const result = await deactivateUseCase.execute({ scope, actor, productId: created.product.id, expectedVersion: 1, idempotencyKey: "deactivate-product:1" });
      expect(result.kind).toBe("DEACTIVATED");

      const reloaded = await repository.findById(scope, created.product.id);
      expect(reloaded?.status).toBe("INACTIVE");
      expect(reloaded?.id).toBe(created.product.id);

      const second = await deactivateUseCase.execute({ scope, actor, productId: created.product.id, expectedVersion: 2, idempotencyKey: "deactivate-product:2" });
      expect(second).toEqual({ kind: "REJECTED", reason: "ALREADY_INACTIVE" });
    } finally {
      database.close();
    }
  });

  it("ROLLBACK: a failed create transaction leaves no partial row and no log entry", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const repository = new SqliteProductRepository(database);
      const useCase = new CreateProductUseCase(repository, new AlwaysAuthorized(), clock, new SequentialIdGenerator());
      await useCase.execute(productCommand());

      // Force the physical INSERT to fail mid-transaction (CHECK violation on
      // a nonsense product_type bypassing domain validation via a corrupted
      // command) — the mutation-log INSERT inside the SAME transaction must
      // never land either.
      await expect(useCase.execute(productCommand({ idempotencyKey: "create-product:rollback", internalCode: "SKU-ROLLBACK", productType: "NOT_A_REAL_TYPE" }))).rejects.toThrow();

      const rows = database.native.prepare("SELECT COUNT(*) AS n FROM catalog_products WHERE internal_code = 'SKU-ROLLBACK'").get() as { n: number };
      const logRows = database.native.prepare("SELECT COUNT(*) AS n FROM catalog_product_mutation_log WHERE idempotency_key = 'create-product:rollback'").get() as { n: number };
      expect(rows.n).toBe(0);
      expect(logRows.n).toBe(0);
    } finally {
      database.close();
    }
  });

  it("reapply: closing and reopening the same database file preserves Catalog data", async () => {
    const dataDirectory = await directory();
    const first = LocalDatabase.open({ dataDirectory });
    const repository1 = new SqliteProductRepository(first);
    const useCase = new CreateProductUseCase(repository1, new AlwaysAuthorized(), clock, new SequentialIdGenerator());
    const created = await useCase.execute(productCommand());
    if (created.kind !== "CREATED") throw new Error("unreachable");
    first.close();

    const second = LocalDatabase.open({ dataDirectory });
    try {
      const reloaded = await new SqliteProductRepository(second).findById(scope, created.product.id);
      expect(reloaded?.id).toBe(created.product.id);
      expect(reloaded?.name).toBe(created.product.name);
    } finally {
      second.close();
    }
  });
});

describe("Catalog cross-table integrity (real SQLite FKs)", () => {
  async function seedProduct(repository: SqliteProductRepository, idGenerator: SequentialIdGenerator) {
    const useCase = new CreateProductUseCase(repository, new AlwaysAuthorized(), clock, idGenerator);
    const result = await useCase.execute(productCommand());
    if (result.kind !== "CREATED") throw new Error("unreachable");
    return result.product;
  }

  it("REFERENTIAL INTEGRITY: a presentation cannot reference a non-existent product (real FK, not just application check)", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      expect(() =>
        database.native
          .prepare(
            `INSERT INTO catalog_product_presentations (
              id, tenant_id, company_id, product_id, variant_id, name, internal_sku, unit_id,
              contained_quantity, variable_quantity, sales_enabled, purchasing_enabled, breakable,
              stock_mode, status, version, idempotency_key, created_at
            ) VALUES (?, ?, ?, ?, NULL, ?, NULL, ?, '1.000000', 0, 1, 1, 0, 'INDEPENDENT', 'ACTIVE', 1, ?, ?)`,
          )
          .run(
            "018f0000-0000-7000-8000-000000000700", scope.tenantId, scope.companyId,
            "018f0000-0000-7000-8000-000000009999", "unidad", "018f0000-0000-7000-8000-000000000060",
            "direct-insert:1", new Date().toISOString(),
          ),
      ).toThrow(/FOREIGN KEY/);
    } finally {
      database.close();
    }
  });

  it("REFERENTIAL INTEGRITY: an identifier cannot reference a non-existent presentation", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    const repository = new SqliteProductRepository(database);
    const product = await seedProduct(repository, new SequentialIdGenerator());
    try {
      expect(() =>
        database.native
          .prepare(
            `INSERT INTO catalog_product_identifiers (
              id, tenant_id, company_id, product_id, variant_id, presentation_id, identifier_type,
              raw_value, normalized_value, status, version, idempotency_key, created_at
            ) VALUES (?, ?, ?, ?, NULL, ?, 'EAN_13', '7701234567890', '7701234567890', 'ACTIVE', 1, ?, ?)`,
          )
          .run(
            "018f0000-0000-7000-8000-000000000800", scope.tenantId, scope.companyId, product.id,
            "018f0000-0000-7000-8000-000000009999", "direct-insert:2", new Date().toISOString(),
          ),
      ).toThrow(/FOREIGN KEY/);
    } finally {
      database.close();
    }
  });

  it("CREATE VARIANT + PRESENTATION + IDENTIFIER end-to-end over real FKs", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const productRepository = new SqliteProductRepository(database);
      const variantRepository = new SqliteProductVariantRepository(database);
      const presentationRepository = new SqliteProductPresentationRepository(database);
      const identifierRepository = new SqliteProductIdentifierRepository(database);
      const idGenerator = new SequentialIdGenerator();
      const product = await seedProduct(productRepository, idGenerator);

      const variantUseCase = new CreateVariantUseCase(productRepository, variantRepository, new AlwaysAuthorized(), new SortedCanonicalKeyPolicy(), clock, idGenerator);
      const variantResult = await variantUseCase.execute({ scope, actor, productId: product.id, attributes: { color: "azul" }, idempotencyKey: "create-variant:1" });
      expect(variantResult.kind).toBe("CREATED");
      if (variantResult.kind !== "CREATED") throw new Error("unreachable");

      const presentationUseCase = new CreatePresentationUseCase(productRepository, variantRepository, presentationRepository, new AlwaysAuthorized(), clock, idGenerator);
      const presentationResult = await presentationUseCase.execute({
        scope, actor, productId: product.id, variantId: variantResult.variant.id, name: "unidad", internalSku: "SKU-AZUL",
        unitId: "018f0000-0000-7000-8000-000000000060", containedQuantity: "1", variableQuantity: false,
        salesEnabled: true, purchasingEnabled: true, breakable: false, stockMode: "INDEPENDENT", idempotencyKey: "create-presentation:1",
      });
      expect(presentationResult.kind).toBe("CREATED");
      if (presentationResult.kind !== "CREATED") throw new Error("unreachable");

      const identifierUseCase = new AssignIdentifierUseCase(presentationRepository, identifierRepository, new AlwaysAuthorized(), new IdentityNormalizationPolicy(), clock, idGenerator);
      const identifierResult = await identifierUseCase.execute({
        scope, actor, presentationId: presentationResult.presentation.id, identifierType: "EAN_13", rawValue: "7701234567890", idempotencyKey: "assign-identifier:1",
      });
      expect(identifierResult.kind).toBe("ASSIGNED");
      if (identifierResult.kind !== "ASSIGNED") throw new Error("unreachable");
      expect(identifierResult.identifier.presentationId).toBe(presentationResult.presentation.id);
      expect(identifierResult.identifier.productId).toBe(product.id);
    } finally {
      database.close();
    }
  });

  it("DEFINE CONVERSION between two real presentations, rejects a duplicate pair under a real UNIQUE constraint", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const productRepository = new SqliteProductRepository(database);
      const variantRepository = new SqliteProductVariantRepository(database);
      const presentationRepository = new SqliteProductPresentationRepository(database);
      const conversionRepository = new SqliteUnitConversionRepository(database);
      const idGenerator = new SequentialIdGenerator();
      const product = await seedProduct(productRepository, idGenerator);

      const presentationUseCase = new CreatePresentationUseCase(productRepository, variantRepository, presentationRepository, new AlwaysAuthorized(), clock, idGenerator);
      const source = await presentationUseCase.execute({
        scope, actor, productId: product.id, variantId: null, name: "paca x12", internalSku: "PACA-12",
        unitId: "018f0000-0000-7000-8000-000000000060", containedQuantity: "12", variableQuantity: false,
        salesEnabled: true, purchasingEnabled: true, breakable: true, stockMode: "CONVERTED_TO_BASE", idempotencyKey: "create-presentation:source",
      });
      const target = await presentationUseCase.execute({
        scope, actor, productId: product.id, variantId: null, name: "bolsa", internalSku: "BOLSA-1",
        unitId: "018f0000-0000-7000-8000-000000000060", containedQuantity: "1", variableQuantity: false,
        salesEnabled: true, purchasingEnabled: true, breakable: false, stockMode: "INDEPENDENT", idempotencyKey: "create-presentation:target",
      });
      if (source.kind !== "CREATED" || target.kind !== "CREATED") throw new Error("unreachable");

      const conversionUseCase = new DefineConversionUseCase(presentationRepository, conversionRepository, new AlwaysAuthorized(), clock, idGenerator);
      const first = await conversionUseCase.execute({
        scope, actor, sourcePresentationId: source.presentation.id, targetPresentationId: target.presentation.id,
        factor: "12", reversible: true, requiresAuthorization: false, wastePolicy: null, costPolicy: null, lotPolicy: null,
        idempotencyKey: "define-conversion:1",
      });
      expect(first.kind).toBe("DEFINED");

      const duplicate = await conversionUseCase.execute({
        scope, actor, sourcePresentationId: source.presentation.id, targetPresentationId: target.presentation.id,
        factor: "12", reversible: true, requiresAuthorization: false, wastePolicy: null, costPolicy: null, lotPolicy: null,
        idempotencyKey: "define-conversion:2",
      });
      expect(duplicate).toEqual({ kind: "REJECTED", reason: "CONVERSION_ALREADY_EXISTS" });
    } finally {
      database.close();
    }
  });

  it("TENANT/COMPANY ISOLATION: a product from a different company is not found, not leaked", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    try {
      const repository = new SqliteProductRepository(database);
      const product = await seedProduct(repository, new SequentialIdGenerator());

      const otherCompanyScope = new CompanyScope(scope.tenantId, "018f0000-0000-7000-8000-0000000000cc");
      const leaked = await repository.findById(otherCompanyScope, product.id);

      expect(leaked).toBeNull();
    } finally {
      database.close();
    }
  });
});
