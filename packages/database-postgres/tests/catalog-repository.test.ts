import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
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
  PostgresDatabase,
  PostgresProductIdentifierRepository,
  PostgresProductPresentationRepository,
  PostgresProductRepository,
  PostgresProductVariantRepository,
  PostgresUnitConversionRepository,
} from "../src/index.js";
import { applyCatalogSchema, databaseUrl, dropDatabase, recreateDatabase, roleUrl } from "./test-support.js";

const DB_NAME = "catalog_adapter_test";

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

let idCounter = 0;
function newId(): string {
  idCounter += 1;
  return `018f0000-0000-7000-8000-${idCounter.toString().padStart(12, "0")}`;
}
class SequentialIdGenerator implements IdGenerator {
  newId(): string { return newId(); }
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

const actor = Actor.forUser(newId());

// Every scope() call mints a fresh tenant/company pair — catalog.products has
// no FK to tenancy.tenants/organization.companies (only self-referencing FKs
// among catalog tables, see 005_catalog_foundation.up.sql), and tests share a
// single database, so per-test tenant isolation is what keeps them independent.
function scope(): CompanyScope {
  return new CompanyScope(newId(), newId());
}

function productCommand(currentScope: CompanyScope, overrides: Record<string, unknown> = {}) {
  return {
    scope: currentScope,
    actor,
    internalCode: "SKU-1",
    name: "Arroz Roa",
    description: null,
    categoryId: newId(),
    brandId: null,
    productType: "STANDARD" as const,
    stockControlled: true,
    lotControlled: false,
    expirationControlled: false,
    serialControlled: false,
    taxCategoryId: null,
    baseUnitId: newId(),
    variantPolicy: "OPTIONAL_VARIANTS" as const,
    idempotencyKey: "create-product:1",
    ...overrides,
  };
}

describe("PostgresProductRepository (real PostgreSQL, not a fake)", () => {
  let database: PostgresDatabase;
  let repository: PostgresProductRepository;

  beforeAll(async () => {
    await recreateDatabase(DB_NAME);
    await applyCatalogSchema(databaseUrl(DB_NAME));
    database = PostgresDatabase.open(roleUrl(databaseUrl(DB_NAME), "pos_app"));
    repository = new PostgresProductRepository(database);
  }, 60_000);

  afterAll(async () => {
    await database?.close();
    await dropDatabase(DB_NAME);
  });

  it("CREATE / FIND: persists a product and reads it back with the same values", async () => {
    const currentScope = scope();
    const useCase = new CreateProductUseCase(repository, new AlwaysAuthorized(), clock, new SequentialIdGenerator());

    const result = await useCase.execute(productCommand(currentScope));
    expect(result.kind).toBe("CREATED");
    if (result.kind !== "CREATED") throw new Error("unreachable");

    const reloaded = await repository.findById(currentScope, result.product.id);
    expect(reloaded?.name).toBe("Arroz Roa");
    expect(reloaded?.version).toBe(1);
    expect(reloaded?.status).toBe("ACTIVE");
  });

  it("UNIQUENESS: rejects a second product with the same internal_code in the same company", async () => {
    const currentScope = scope();
    const useCase = new CreateProductUseCase(repository, new AlwaysAuthorized(), clock, new SequentialIdGenerator());

    await useCase.execute(productCommand(currentScope));
    const second = await useCase.execute(productCommand(currentScope, { idempotencyKey: "create-product:2", name: "Otro producto" }));

    expect(second).toEqual({ kind: "REJECTED", reason: "INTERNAL_CODE_EXISTS" });
  });

  it("IDEMPOTENCY: replaying the SAME create idempotencyKey returns the ORIGINAL snapshot, unaffected by a later update", async () => {
    const currentScope = scope();
    const createUseCase = new CreateProductUseCase(repository, new AlwaysAuthorized(), clock, new SequentialIdGenerator());
    const updateUseCase = new UpdateProductUseCase(repository, new AlwaysAuthorized(), clock);

    const created = await createUseCase.execute(productCommand(currentScope));
    if (created.kind !== "CREATED") throw new Error("unreachable");

    await updateUseCase.execute({
      scope: currentScope, actor, productId: created.product.id, name: "Nombre cambiado", description: null,
      categoryId: created.product.categoryId, brandId: null, expectedVersion: 1, idempotencyKey: "update-product:1",
    });

    const replay = await createUseCase.execute(productCommand(currentScope));
    expect(replay.kind).toBe("ALREADY_CREATED");
    if (replay.kind !== "ALREADY_CREATED") throw new Error("unreachable");
    expect(replay.product.name).toBe("Arroz Roa");
    expect(replay.product.version).toBe(1);
  });

  it("OPTIMISTIC CONCURRENCY (lost update prevention): first update succeeds, second update against the SAME stale version fails", async () => {
    const currentScope = scope();
    const createUseCase = new CreateProductUseCase(repository, new AlwaysAuthorized(), clock, new SequentialIdGenerator());
    const updateUseCase = new UpdateProductUseCase(repository, new AlwaysAuthorized(), clock);
    const created = await createUseCase.execute(productCommand(currentScope));
    if (created.kind !== "CREATED") throw new Error("unreachable");

    const first = await updateUseCase.execute({
      scope: currentScope, actor, productId: created.product.id, name: "Primera actualización", description: null,
      categoryId: created.product.categoryId, brandId: null, expectedVersion: 1, idempotencyKey: "update-product:A",
    });
    const second = await updateUseCase.execute({
      scope: currentScope, actor, productId: created.product.id, name: "Segunda actualización (versión obsoleta)", description: null,
      categoryId: created.product.categoryId, brandId: null, expectedVersion: 1, idempotencyKey: "update-product:B",
    });

    expect(first.kind).toBe("UPDATED");
    expect(second).toEqual({ kind: "REJECTED", reason: "VERSION_CONFLICT" });

    const reloaded = await repository.findById(currentScope, created.product.id);
    expect(reloaded?.name).toBe("Primera actualización");
    expect(reloaded?.version).toBe(2);
  });

  it("REAL CONCURRENCY: two genuinely concurrent updates against the same version — exactly one succeeds", async () => {
    const currentScope = scope();
    const createUseCase = new CreateProductUseCase(repository, new AlwaysAuthorized(), clock, new SequentialIdGenerator());
    const created = await createUseCase.execute(productCommand(currentScope));
    if (created.kind !== "CREATED") throw new Error("unreachable");

    const useCaseA = new UpdateProductUseCase(repository, new AlwaysAuthorized(), clock);
    const useCaseB = new UpdateProductUseCase(repository, new AlwaysAuthorized(), clock);

    const [resultA, resultB] = await Promise.all([
      useCaseA.execute({
        scope: currentScope, actor, productId: created.product.id, name: "Concurrente A", description: null,
        categoryId: created.product.categoryId, brandId: null, expectedVersion: 1, idempotencyKey: "update-product:concurrent-A",
      }),
      useCaseB.execute({
        scope: currentScope, actor, productId: created.product.id, name: "Concurrente B", description: null,
        categoryId: created.product.categoryId, brandId: null, expectedVersion: 1, idempotencyKey: "update-product:concurrent-B",
      }),
    ]);

    const outcomes = [resultA.kind, resultB.kind].sort();
    expect(outcomes).toEqual(["REJECTED", "UPDATED"]);
  });

  it("DEACTIVATE: transitions to INACTIVE, identity remains stable, repeated deactivation outside replay is rejected", async () => {
    const currentScope = scope();
    const createUseCase = new CreateProductUseCase(repository, new AlwaysAuthorized(), clock, new SequentialIdGenerator());
    const deactivateUseCase = new DeactivateProductUseCase(repository, new AlwaysAuthorized(), clock);
    const created = await createUseCase.execute(productCommand(currentScope));
    if (created.kind !== "CREATED") throw new Error("unreachable");

    const result = await deactivateUseCase.execute({ scope: currentScope, actor, productId: created.product.id, expectedVersion: 1, idempotencyKey: "deactivate-product:1" });
    expect(result.kind).toBe("DEACTIVATED");

    const reloaded = await repository.findById(currentScope, created.product.id);
    expect(reloaded?.status).toBe("INACTIVE");
    expect(reloaded?.id).toBe(created.product.id);

    const second = await deactivateUseCase.execute({ scope: currentScope, actor, productId: created.product.id, expectedVersion: 2, idempotencyKey: "deactivate-product:2" });
    expect(second).toEqual({ kind: "REJECTED", reason: "ALREADY_INACTIVE" });
  });

  it("ROLLBACK: a failed create transaction leaves no partial row and no log entry", async () => {
    const currentScope = scope();
    const useCase = new CreateProductUseCase(repository, new AlwaysAuthorized(), clock, new SequentialIdGenerator());
    await useCase.execute(productCommand(currentScope));

    // Force the physical INSERT to fail mid-transaction (CHECK violation on a
    // nonsense product_type bypassing domain validation via a corrupted
    // command) — the mutation-log INSERT inside the SAME transaction must
    // never land either.
    await expect(
      useCase.execute(productCommand(currentScope, { idempotencyKey: "create-product:rollback", internalCode: "SKU-ROLLBACK", productType: "NOT_A_REAL_TYPE" })),
    ).rejects.toThrow();

    const admin = new Pool({ connectionString: databaseUrl(DB_NAME) });
    try {
      const rows = await admin.query("SELECT count(*)::int AS n FROM catalog.products WHERE tenant_id = $1 AND internal_code = 'SKU-ROLLBACK'", [currentScope.tenantId]);
      const logRows = await admin.query("SELECT count(*)::int AS n FROM catalog.product_mutation_log WHERE tenant_id = $1 AND idempotency_key = 'create-product:rollback'", [currentScope.tenantId]);
      expect(rows.rows[0].n).toBe(0);
      expect(logRows.rows[0].n).toBe(0);
    } finally {
      await admin.end();
    }
  });

  it("TENANT ISOLATION: a product from a different tenant is not found, not leaked (application-level scope check)", async () => {
    const currentScope = scope();
    const useCase = new CreateProductUseCase(repository, new AlwaysAuthorized(), clock, new SequentialIdGenerator());
    const created = await useCase.execute(productCommand(currentScope));
    if (created.kind !== "CREATED") throw new Error("unreachable");

    const otherScope = scope();
    const leaked = await repository.findById(otherScope, created.product.id);

    expect(leaked).toBeNull();
  });

  it("RLS: a session-level query without a matching app.tenant_id session var sees zero rows, even querying by raw id (real RLS, not just a WHERE clause)", async () => {
    const currentScope = scope();
    const useCase = new CreateProductUseCase(repository, new AlwaysAuthorized(), clock, new SequentialIdGenerator());
    const created = await useCase.execute(productCommand(currentScope));
    if (created.kind !== "CREATED") throw new Error("unreachable");

    const otherScope = scope();
    const rows = await database.withTenantTransaction(otherScope.tenantId, async (client) => {
      const result = await client.query("SELECT * FROM catalog.products WHERE id = $1", [created.product.id]);
      return result.rows;
    });
    expect(rows).toEqual([]);
  });
});

describe("Catalog cross-table integrity (real PostgreSQL FKs, constraints, RLS)", () => {
  let database: PostgresDatabase;
  let productRepository: PostgresProductRepository;
  let variantRepository: PostgresProductVariantRepository;
  let presentationRepository: PostgresProductPresentationRepository;
  let identifierRepository: PostgresProductIdentifierRepository;
  let conversionRepository: PostgresUnitConversionRepository;
  const DB_NAME_2 = "catalog_adapter_test_fk";

  beforeAll(async () => {
    await recreateDatabase(DB_NAME_2);
    await applyCatalogSchema(databaseUrl(DB_NAME_2));
    database = PostgresDatabase.open(roleUrl(databaseUrl(DB_NAME_2), "pos_app"));
    productRepository = new PostgresProductRepository(database);
    variantRepository = new PostgresProductVariantRepository(database);
    presentationRepository = new PostgresProductPresentationRepository(database);
    identifierRepository = new PostgresProductIdentifierRepository(database);
    conversionRepository = new PostgresUnitConversionRepository(database);
  }, 60_000);

  afterAll(async () => {
    await database?.close();
    await dropDatabase(DB_NAME_2);
  });

  async function seedProduct(currentScope: CompanyScope) {
    const useCase = new CreateProductUseCase(productRepository, new AlwaysAuthorized(), clock, new SequentialIdGenerator());
    const result = await useCase.execute(productCommand(currentScope));
    if (result.kind !== "CREATED") throw new Error("unreachable");
    return result.product;
  }

  it("REFERENTIAL INTEGRITY: a presentation cannot reference a non-existent product (real FK, not just application check)", async () => {
    const currentScope = scope();
    await expect(
      database.withTenantTransaction(currentScope.tenantId, async (client) => {
        await client.query(
          `INSERT INTO catalog.product_presentations (
            id, tenant_id, company_id, product_id, variant_id, name, internal_sku, unit_id,
            contained_quantity, variable_quantity, sales_enabled, purchasing_enabled, breakable,
            stock_mode, status, version, idempotency_key
          ) VALUES ($1,$2,$3,$4,NULL,$5,NULL,$6,1.000000,false,true,true,false,'INDEPENDENT','ACTIVE',1,$7)`,
          [newId(), currentScope.tenantId, currentScope.companyId, newId(), "unidad", newId(), "direct-insert:1"],
        );
      }),
    ).rejects.toThrow(/foreign key/i);
  });

  it("REFERENTIAL INTEGRITY: an identifier cannot reference a non-existent presentation", async () => {
    const currentScope = scope();
    const product = await seedProduct(currentScope);
    await expect(
      database.withTenantTransaction(currentScope.tenantId, async (client) => {
        await client.query(
          `INSERT INTO catalog.product_identifiers (
            id, tenant_id, company_id, product_id, variant_id, presentation_id, identifier_type,
            raw_value, normalized_value, status, version, idempotency_key
          ) VALUES ($1,$2,$3,$4,NULL,$5,'EAN_13','7701234567890','7701234567890','ACTIVE',1,$6)`,
          [newId(), currentScope.tenantId, currentScope.companyId, product.id, newId(), "direct-insert:2"],
        );
      }),
    ).rejects.toThrow(/foreign key/i);
  });

  it("CREATE VARIANT + PRESENTATION + IDENTIFIER end-to-end over real FKs", async () => {
    const currentScope = scope();
    const product = await seedProduct(currentScope);
    const idGenerator = new SequentialIdGenerator();

    const variantUseCase = new CreateVariantUseCase(productRepository, variantRepository, new AlwaysAuthorized(), new SortedCanonicalKeyPolicy(), clock, idGenerator);
    const variantResult = await variantUseCase.execute({ scope: currentScope, actor, productId: product.id, attributes: { color: "azul" }, idempotencyKey: "create-variant:1" });
    expect(variantResult.kind).toBe("CREATED");
    if (variantResult.kind !== "CREATED") throw new Error("unreachable");

    const presentationUseCase = new CreatePresentationUseCase(productRepository, variantRepository, presentationRepository, new AlwaysAuthorized(), clock, idGenerator);
    const presentationResult = await presentationUseCase.execute({
      scope: currentScope, actor, productId: product.id, variantId: variantResult.variant.id, name: "unidad", internalSku: "SKU-AZUL",
      unitId: newId(), containedQuantity: "1", variableQuantity: false,
      salesEnabled: true, purchasingEnabled: true, breakable: false, stockMode: "INDEPENDENT", idempotencyKey: "create-presentation:1",
    });
    expect(presentationResult.kind).toBe("CREATED");
    if (presentationResult.kind !== "CREATED") throw new Error("unreachable");

    const identifierUseCase = new AssignIdentifierUseCase(presentationRepository, identifierRepository, new AlwaysAuthorized(), new IdentityNormalizationPolicy(), clock, idGenerator);
    const identifierResult = await identifierUseCase.execute({
      scope: currentScope, actor, presentationId: presentationResult.presentation.id, identifierType: "EAN_13", rawValue: "7701234567890", idempotencyKey: "assign-identifier:1",
    });
    expect(identifierResult.kind).toBe("ASSIGNED");
    if (identifierResult.kind !== "ASSIGNED") throw new Error("unreachable");
    expect(identifierResult.identifier.presentationId).toBe(presentationResult.presentation.id);
    expect(identifierResult.identifier.productId).toBe(product.id);
  });

  it("DEFINE CONVERSION between two real presentations, rejects a duplicate pair under a real UNIQUE constraint", async () => {
    const currentScope = scope();
    const product = await seedProduct(currentScope);
    const idGenerator = new SequentialIdGenerator();

    const presentationUseCase = new CreatePresentationUseCase(productRepository, variantRepository, presentationRepository, new AlwaysAuthorized(), clock, idGenerator);
    const source = await presentationUseCase.execute({
      scope: currentScope, actor, productId: product.id, variantId: null, name: "paca x12", internalSku: "PACA-12",
      unitId: newId(), containedQuantity: "12", variableQuantity: false,
      salesEnabled: true, purchasingEnabled: true, breakable: true, stockMode: "CONVERTED_TO_BASE", idempotencyKey: "create-presentation:source",
    });
    const target = await presentationUseCase.execute({
      scope: currentScope, actor, productId: product.id, variantId: null, name: "bolsa", internalSku: "BOLSA-1",
      unitId: newId(), containedQuantity: "1", variableQuantity: false,
      salesEnabled: true, purchasingEnabled: true, breakable: false, stockMode: "INDEPENDENT", idempotencyKey: "create-presentation:target",
    });
    if (source.kind !== "CREATED" || target.kind !== "CREATED") throw new Error("unreachable");

    const conversionUseCase = new DefineConversionUseCase(presentationRepository, conversionRepository, new AlwaysAuthorized(), clock, idGenerator);
    const first = await conversionUseCase.execute({
      scope: currentScope, actor, sourcePresentationId: source.presentation.id, targetPresentationId: target.presentation.id,
      factor: "12", reversible: true, requiresAuthorization: false, wastePolicy: null, costPolicy: null, lotPolicy: null,
      idempotencyKey: "define-conversion:1",
    });
    expect(first.kind).toBe("DEFINED");

    const duplicate = await conversionUseCase.execute({
      scope: currentScope, actor, sourcePresentationId: source.presentation.id, targetPresentationId: target.presentation.id,
      factor: "12", reversible: true, requiresAuthorization: false, wastePolicy: null, costPolicy: null, lotPolicy: null,
      idempotencyKey: "define-conversion:2",
    });
    expect(duplicate).toEqual({ kind: "REJECTED", reason: "CONVERSION_ALREADY_EXISTS" });
  });
});
