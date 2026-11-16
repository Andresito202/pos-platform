import { createHash } from "node:crypto";
import { uuidV7 } from "@pos-platform/contracts";
import type { LocalDatabase } from "@pos-platform/database-sqlite";
import { canonicalJson } from "../channel/canonical-json.js";
import { bigIntToScale6, scale6ToBigInt } from "../money.js";
import type { DurableSyncStore, SyncScope } from "../sync/durable-sync-store.js";
import type { SqliteInventoryStore } from "../inventory/sqlite-inventory-store.js";

const COSTING_POLICY_VERSION = "BAKERY_LOT_ACQUISITION_V1";

export type RecipeStatus = "DRAFT" | "APPROVED" | "RETIRED";
export type ProductionStatus =
  | "DRAFT" | "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "PARTIALLY_COMPLETED" | "CANCELLED";

export type RecipeLineInput = {
  ingredientProductId: string;
  ingredientPresentationId: string;
  quantity: string;
  unitCode: string;
  massQuantity: string | null;
};

function addScale6(a: string, b: string): string {
  return bigIntToScale6(scale6ToBigInt(a) + scale6ToBigInt(b));
}

function mulScale6(qty: string, unitCost: string): string {
  // (qty * unitCost) / 1e6 with floor toward zero for deterministic remainder policy.
  const product = scale6ToBigInt(qty) * scale6ToBigInt(unitCost);
  return bigIntToScale6(product / 1_000_000n);
}

function divUnitCost(total: string, qty: string): string | null {
  const q = scale6ToBigInt(qty);
  if (q <= 0n) return null;
  // (total_micro * 1e6) / qty_micro → unit cost in scale-6 micro-units; floor remainder.
  return bigIntToScale6((scale6ToBigInt(total) * 1_000_000n) / q);
}

export class SqliteBakeryStore {
  constructor(
    private readonly database: LocalDatabase,
    private readonly durableSync: DurableSyncStore,
    private readonly inventoryStore: SqliteInventoryStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private writeAudit(
    scope: SyncScope,
    sessionId: string,
    actorId: string,
    actionCode: string,
    resourceType: string,
    resourceId: string,
    correlationId: string,
    causationId: string | null,
    details: Record<string, unknown>,
    nowIso: string,
  ): void {
    this.database.native.prepare(
      `INSERT INTO local_operation_audit(
        tenant_id, company_id, branch_id, device_id,
        actor_type, actor_id, session_id,
        action_code, resource_type, resource_id,
        correlation_id, causation_id, reason_code, details_json, created_at
      ) VALUES (?,?,?,?,'USER',?,?,?,?,?,?,?,NULL,?,?)`,
    ).run(
      scope.tenantId, scope.companyId, scope.branchId, scope.deviceId,
      actorId, sessionId, actionCode, resourceType, resourceId,
      correlationId, causationId, canonicalJson(details), nowIso,
    );
  }

  private enqueue(
    scope: SyncScope,
    sessionId: string,
    actorId: string,
    aggregateType: string,
    aggregateId: string,
    operationType: string,
    idempotencyKey: string,
    correlationId: string,
    causationId: string | null,
    payload: Record<string, unknown>,
    nowIso: string,
  ): void {
    const nextSequence = (this.database.native.prepare(
      `SELECT COALESCE(MAX(local_sequence), 0) + 1 AS next_sequence FROM local_sync_outbox
       WHERE tenant_id=? AND company_id=? AND branch_id=? AND device_id=? AND installation_id=?`,
    ).get(scope.tenantId, scope.companyId, scope.branchId, scope.deviceId, scope.installationId) as {
      next_sequence: number;
    }).next_sequence;
    const payloadChecksum = createHash("sha256").update(canonicalJson(payload)).digest("hex");
    this.durableSync.enqueue({
      operation_id: uuidV7(),
      tenant_id: scope.tenantId,
      company_id: scope.companyId,
      branch_id: scope.branchId,
      device_id: scope.deviceId,
      installation_id: scope.installationId,
      session_id: sessionId,
      actor_id: actorId,
      aggregate_type: aggregateType,
      aggregate_id: aggregateId,
      operation_type: operationType,
      authority_policy: "LOCAL_AUTHORITATIVE_UNTIL_SYNC",
      local_sequence: nextSequence,
      idempotency_key: idempotencyKey,
      expected_version: null,
      payload_schema_version: "1.0.0",
      payload,
      payload_checksum: payloadChecksum,
      causation_id: causationId,
      correlation_id: correlationId,
      occurred_at_local: nowIso,
      recorded_at_local: nowIso,
    });
  }

  upsertIngredientProfile(input: {
    scope: SyncScope;
    sessionId: string;
    operatorUserId: string;
    productId: string;
    purchasePresentationId: string;
    consumptionUnitCode: string;
    consumptionUnitPrecision: number;
    approvedConversionFactor: string | null;
    approvedConversionFromUnit: string | null;
    approvedConversionToUnit: string | null;
    conservationCode: "AMBIENT" | "CHILLED" | "FROZEN" | "CONTROLLED";
    requiresLotTracking: boolean;
    requiresExpiry: boolean;
    idempotencyKey: string;
    requestChecksum: string;
    correlationId: string;
    causationId: string | null;
  }) {
    const product = this.database.native.prepare(
      `SELECT company_id FROM catalog_product WHERE tenant_id=? AND id=?`,
    ).get(input.scope.tenantId, input.productId) as { company_id: string } | undefined;
    if (product === undefined) return { kind: "PRODUCT_NOT_FOUND" as const };
    if (product.company_id !== input.scope.companyId) return { kind: "COMPANY_MISMATCH" as const };
    const presentation = this.database.native.prepare(
      `SELECT product_id FROM catalog_presentation WHERE tenant_id=? AND id=? AND status='ACTIVE'`,
    ).get(input.scope.tenantId, input.purchasePresentationId) as { product_id: string } | undefined;
    if (presentation === undefined || presentation.product_id !== input.productId) {
      return { kind: "PRESENTATION_NOT_FOUND" as const };
    }
    const nowIso = this.now().toISOString();
    const existing = this.database.native.prepare(
      `SELECT version FROM catalog_bakery_ingredient_profile WHERE tenant_id=? AND product_id=?`,
    ).get(input.scope.tenantId, input.productId) as { version: number } | undefined;
    const version = (existing?.version ?? 0) + 1;
    this.database.native.prepare(
      `INSERT INTO catalog_bakery_ingredient_profile(
        tenant_id,company_id,product_id,purchase_presentation_id,consumption_unit_code,
        consumption_unit_precision,approved_conversion_factor,approved_conversion_from_unit,
        approved_conversion_to_unit,conservation_code,requires_lot_tracking,requires_expiry,
        version,updated_by,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(tenant_id,product_id) DO UPDATE SET
        purchase_presentation_id=excluded.purchase_presentation_id,
        consumption_unit_code=excluded.consumption_unit_code,
        consumption_unit_precision=excluded.consumption_unit_precision,
        approved_conversion_factor=excluded.approved_conversion_factor,
        approved_conversion_from_unit=excluded.approved_conversion_from_unit,
        approved_conversion_to_unit=excluded.approved_conversion_to_unit,
        conservation_code=excluded.conservation_code,
        requires_lot_tracking=excluded.requires_lot_tracking,
        requires_expiry=excluded.requires_expiry,
        version=excluded.version,
        updated_by=excluded.updated_by,
        updated_at=excluded.updated_at`,
    ).run(
      input.scope.tenantId, input.scope.companyId, input.productId, input.purchasePresentationId,
      input.consumptionUnitCode, input.consumptionUnitPrecision,
      input.approvedConversionFactor, input.approvedConversionFromUnit, input.approvedConversionToUnit,
      input.conservationCode, input.requiresLotTracking ? 1 : 0, input.requiresExpiry ? 1 : 0,
      version, input.operatorUserId, nowIso,
    );
    this.writeAudit(
      input.scope, input.sessionId, input.operatorUserId,
      "BAKERY_INGREDIENT_PROFILE_UPSERT", "CATALOG_PRODUCT", input.productId,
      input.correlationId, input.causationId, { version }, nowIso,
    );
    return { kind: "SAVED" as const, version };
  }

  upsertFinishedPolicy(input: {
    scope: SyncScope;
    sessionId: string;
    operatorUserId: string;
    productId: string;
    shelfLifeDays: number;
    conservationCode: "AMBIENT" | "CHILLED" | "FROZEN" | "CONTROLLED";
    releaseRequired: boolean;
    policyBasis: string;
    idempotencyKey: string;
    requestChecksum: string;
    correlationId: string;
    causationId: string | null;
  }) {
    const product = this.database.native.prepare(
      `SELECT company_id FROM catalog_product WHERE tenant_id=? AND id=?`,
    ).get(input.scope.tenantId, input.productId) as { company_id: string } | undefined;
    if (product === undefined) return { kind: "PRODUCT_NOT_FOUND" as const };
    if (product.company_id !== input.scope.companyId) return { kind: "COMPANY_MISMATCH" as const };
    const nowIso = this.now().toISOString();
    const existing = this.database.native.prepare(
      `SELECT version FROM catalog_bakery_finished_policy WHERE tenant_id=? AND product_id=?`,
    ).get(input.scope.tenantId, input.productId) as { version: number } | undefined;
    const version = (existing?.version ?? 0) + 1;
    this.database.native.prepare(
      `INSERT INTO catalog_bakery_finished_policy(
        tenant_id,company_id,product_id,shelf_life_days,conservation_code,release_required,
        policy_basis,version,updated_by,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(tenant_id,product_id) DO UPDATE SET
        shelf_life_days=excluded.shelf_life_days,
        conservation_code=excluded.conservation_code,
        release_required=excluded.release_required,
        policy_basis=excluded.policy_basis,
        version=excluded.version,
        updated_by=excluded.updated_by,
        updated_at=excluded.updated_at`,
    ).run(
      input.scope.tenantId, input.scope.companyId, input.productId, input.shelfLifeDays,
      input.conservationCode, input.releaseRequired ? 1 : 0, input.policyBasis,
      version, input.operatorUserId, nowIso,
    );
    this.writeAudit(
      input.scope, input.sessionId, input.operatorUserId,
      "BAKERY_FINISHED_POLICY_UPSERT", "CATALOG_PRODUCT", input.productId,
      input.correlationId, input.causationId, { version, shelf_life_days: input.shelfLifeDays }, nowIso,
    );
    return { kind: "SAVED" as const, version };
  }

  createRecipeDraft(input: {
    scope: SyncScope;
    sessionId: string;
    operatorUserId: string;
    recipeFamilyId: string | null;
    name: string;
    finishedProductId: string;
    finishedPresentationId: string;
    baseBatchQuantity: string;
    expectedYieldQuantity: string;
    expectedShrinkageQuantity: string;
    canonicalMassUnit: "G" | "KG" | null;
    instructions: string | null;
    lines: ReadonlyArray<RecipeLineInput>;
    idempotencyKey: string;
    requestChecksum: string;
    correlationId: string;
    causationId: string | null;
  }) {
    const prior = this.database.native.prepare(
      `SELECT id,request_checksum,status,version FROM bakery_recipe
       WHERE tenant_id=? AND idempotency_key=?`,
    ).get(input.scope.tenantId, input.idempotencyKey) as
      | { id: string; request_checksum: string; status: string; version: number } | undefined;
    if (prior) {
      return prior.request_checksum === input.requestChecksum
        ? { kind: "IDEMPOTENT" as const, recipeId: prior.id, version: prior.version }
        : { kind: "IDEMPOTENCY_CONFLICT" as const };
    }
    if (input.lines.length === 0) return { kind: "INVALID_RECIPE" as const };

    const finished = this.database.native.prepare(
      `SELECT p.company_id, pr.product_id FROM catalog_product p
       JOIN catalog_presentation pr ON pr.tenant_id=p.tenant_id AND pr.product_id=p.id
       WHERE p.tenant_id=? AND p.id=? AND pr.id=? AND pr.status='ACTIVE'`,
    ).get(
      input.scope.tenantId, input.finishedProductId, input.finishedPresentationId,
    ) as { company_id: string; product_id: string } | undefined;
    if (finished === undefined) return { kind: "PRODUCT_NOT_FOUND" as const };
    if (finished.company_id !== input.scope.companyId) return { kind: "COMPANY_MISMATCH" as const };

    for (const line of input.lines) {
      const ing = this.database.native.prepare(
        `SELECT p.company_id FROM catalog_product p
         JOIN catalog_presentation pr ON pr.tenant_id=p.tenant_id AND pr.id=?
         WHERE p.tenant_id=? AND p.id=? AND pr.product_id=p.id AND pr.status='ACTIVE'`,
      ).get(line.ingredientPresentationId, input.scope.tenantId, line.ingredientProductId) as
        | { company_id: string } | undefined;
      if (ing === undefined) return { kind: "INGREDIENT_NOT_FOUND" as const };
      if (ing.company_id !== input.scope.companyId) return { kind: "COMPANY_MISMATCH" as const };
    }

    const familyId = input.recipeFamilyId ?? uuidV7();
    const maxVersion = this.database.native.prepare(
      `SELECT COALESCE(MAX(version),0) AS v FROM bakery_recipe
       WHERE tenant_id=? AND recipe_family_id=?`,
    ).get(input.scope.tenantId, familyId) as { v: number };
    const version = maxVersion.v + 1;
    const recipeId = uuidV7();
    const nowIso = this.now().toISOString();

    this.database.native.transaction(() => {
      this.database.native.prepare(
        `INSERT INTO bakery_recipe(
          tenant_id,company_id,branch_id,id,recipe_family_id,finished_product_id,
          finished_presentation_id,version,status,name,base_batch_quantity,expected_yield_quantity,
          expected_shrinkage_quantity,canonical_mass_unit,instructions,approved_by,approved_at,
          retired_at,created_by,created_at,idempotency_key,request_checksum
        ) VALUES(?,?,?,?,?,?,?,?,'DRAFT',?,?,?,?,?,?,NULL,NULL,NULL,?,?,?,?)`,
      ).run(
        input.scope.tenantId, input.scope.companyId, input.scope.branchId, recipeId, familyId,
        input.finishedProductId, input.finishedPresentationId, version, input.name,
        input.baseBatchQuantity, input.expectedYieldQuantity, input.expectedShrinkageQuantity,
        input.canonicalMassUnit, input.instructions, input.operatorUserId, nowIso,
        input.idempotencyKey, input.requestChecksum,
      );
      for (const [index, line] of input.lines.entries()) {
        this.database.native.prepare(
          `INSERT INTO bakery_recipe_line(
            tenant_id,recipe_id,line_number,ingredient_product_id,ingredient_presentation_id,
            quantity,unit_code,mass_quantity
          ) VALUES(?,?,?,?,?,?,?,?)`,
        ).run(
          input.scope.tenantId, recipeId, index + 1, line.ingredientProductId,
          line.ingredientPresentationId, line.quantity, line.unitCode, line.massQuantity,
        );
      }
      this.writeAudit(
        input.scope, input.sessionId, input.operatorUserId,
        "BAKERY_RECIPE_DRAFT_CREATED", "BAKERY_RECIPE", recipeId,
        input.correlationId, input.causationId, { version, family_id: familyId }, nowIso,
      );
      this.enqueue(
        input.scope, input.sessionId, input.operatorUserId,
        "BAKERY_RECIPE", recipeId, "BAKERY_RECIPE_DRAFT",
        input.idempotencyKey, input.correlationId, input.causationId,
        { recipe_id: recipeId, version, status: "DRAFT" }, nowIso,
      );
    })();

    return { kind: "CREATED" as const, recipeId, version, recipeFamilyId: familyId };
  }

  approveRecipe(input: {
    scope: SyncScope;
    sessionId: string;
    operatorUserId: string;
    recipeId: string;
    expectedVersion: number;
    idempotencyKey: string;
    requestChecksum: string;
    correlationId: string;
    causationId: string | null;
  }) {
    const priorOp = this.database.native.prepare(
      `SELECT payload_checksum FROM runtime_operations WHERE idempotency_key=?`,
    ).get(input.idempotencyKey) as { payload_checksum: string } | undefined;
    if (priorOp) {
      return priorOp.payload_checksum === input.requestChecksum
        ? { kind: "IDEMPOTENT" as const, recipeId: input.recipeId }
        : { kind: "IDEMPOTENCY_CONFLICT" as const };
    }

    const recipe = this.database.native.prepare(
      `SELECT id,status,version,company_id FROM bakery_recipe WHERE tenant_id=? AND id=?`,
    ).get(input.scope.tenantId, input.recipeId) as
      | { id: string; status: string; version: number; company_id: string } | undefined;
    if (recipe === undefined) return { kind: "NOT_FOUND" as const };
    if (recipe.company_id !== input.scope.companyId) return { kind: "COMPANY_MISMATCH" as const };
    if (recipe.version !== input.expectedVersion) return { kind: "VERSION_CONFLICT" as const };
    if (recipe.status !== "DRAFT") return { kind: "NOT_DRAFT" as const };

    const nowIso = this.now().toISOString();
    this.database.native.transaction(() => {
      this.database.native.prepare(
        `INSERT INTO runtime_operations(operation_id,idempotency_key,payload_checksum,status,result_code,created_at,updated_at)
         VALUES(?,?,?,'SUCCEEDED','BAKERY_RECIPE_APPROVED',?,?)`,
      ).run(uuidV7(), input.idempotencyKey, input.requestChecksum, nowIso, nowIso);
      this.database.native.prepare(
        `UPDATE bakery_recipe SET status='APPROVED', approved_by=?, approved_at=?
         WHERE tenant_id=? AND id=? AND status='DRAFT' AND version=?`,
      ).run(input.operatorUserId, nowIso, input.scope.tenantId, input.recipeId, input.expectedVersion);
      this.writeAudit(
        input.scope, input.sessionId, input.operatorUserId,
        "BAKERY_RECIPE_APPROVED", "BAKERY_RECIPE", input.recipeId,
        input.correlationId, input.causationId, { version: input.expectedVersion }, nowIso,
      );
    })();
    return { kind: "APPROVED" as const, recipeId: input.recipeId, version: input.expectedVersion };
  }

  recordLotAcquisitionCost(input: {
    scope: SyncScope;
    sessionId: string;
    operatorUserId: string;
    lotId: string;
    unitCostAmount: string;
    currencyCode: string;
    sourceKind: "GOODS_RECEIPT" | "MANUAL_AUTHORIZED" | "PRODUCTION_TRANSFER";
    sourceDocument: string;
    idempotencyKey: string;
    requestChecksum: string;
    correlationId: string;
    causationId: string | null;
  }) {
    const prior = this.database.native.prepare(
      `SELECT lot_id,request_checksum FROM inventory_lot_acquisition_cost
       WHERE tenant_id=? AND idempotency_key=?`,
    ).get(input.scope.tenantId, input.idempotencyKey) as
      | { lot_id: string; request_checksum: string } | undefined;
    if (prior) {
      return prior.request_checksum === input.requestChecksum
        ? { kind: "IDEMPOTENT" as const, lotId: prior.lot_id }
        : { kind: "IDEMPOTENCY_CONFLICT" as const };
    }
    const lot = this.database.native.prepare(
      `SELECT id FROM inventory_lot WHERE tenant_id=? AND company_id=? AND branch_id=? AND id=?`,
    ).get(input.scope.tenantId, input.scope.companyId, input.scope.branchId, input.lotId) as
      | { id: string } | undefined;
    if (lot === undefined) return { kind: "LOT_NOT_FOUND" as const };
    const existing = this.database.native.prepare(
      `SELECT 1 AS ok FROM inventory_lot_acquisition_cost WHERE tenant_id=? AND branch_id=? AND lot_id=?`,
    ).get(input.scope.tenantId, input.scope.branchId, input.lotId);
    if (existing) return { kind: "ALREADY_RECORDED" as const };
    const nowIso = this.now().toISOString();
    this.database.native.prepare(
      `INSERT INTO inventory_lot_acquisition_cost(
        tenant_id,company_id,branch_id,lot_id,unit_cost_amount,currency_code,source_kind,
        source_document,costing_policy_version,actor_id,recorded_at,idempotency_key,request_checksum
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      input.scope.tenantId, input.scope.companyId, input.scope.branchId, input.lotId,
      input.unitCostAmount, input.currencyCode, input.sourceKind, input.sourceDocument,
      COSTING_POLICY_VERSION, input.operatorUserId, nowIso, input.idempotencyKey, input.requestChecksum,
    );
    this.writeAudit(
      input.scope, input.sessionId, input.operatorUserId,
      "INVENTORY_LOT_ACQUISITION_COST", "INVENTORY_LOT", input.lotId,
      input.correlationId, input.causationId,
      { unit_cost_amount: input.unitCostAmount, source_kind: input.sourceKind, catalog_price_used: false },
      nowIso,
    );
    return { kind: "RECORDED" as const, lotId: input.lotId };
  }

  createProductionOrder(input: {
    scope: SyncScope;
    sessionId: string;
    operatorUserId: string;
    recipeId: string;
    plannedQuantity: string;
    idempotencyKey: string;
    requestChecksum: string;
    correlationId: string;
    causationId: string | null;
  }) {
    const prior = this.database.native.prepare(
      `SELECT id,request_checksum,status FROM bakery_production_order
       WHERE tenant_id=? AND idempotency_key=?`,
    ).get(input.scope.tenantId, input.idempotencyKey) as
      | { id: string; request_checksum: string; status: string } | undefined;
    if (prior) {
      return prior.request_checksum === input.requestChecksum
        ? { kind: "IDEMPOTENT" as const, orderId: prior.id }
        : { kind: "IDEMPOTENCY_CONFLICT" as const };
    }

    const recipe = this.database.native.prepare(
      `SELECT id,status,version,company_id,finished_product_id,finished_presentation_id,
              base_batch_quantity,expected_yield_quantity,expected_shrinkage_quantity,
              canonical_mass_unit,name
       FROM bakery_recipe WHERE tenant_id=? AND id=?`,
    ).get(input.scope.tenantId, input.recipeId) as {
      id: string; status: string; version: number; company_id: string;
      finished_product_id: string; finished_presentation_id: string;
      base_batch_quantity: string; expected_yield_quantity: string;
      expected_shrinkage_quantity: string; canonical_mass_unit: "G" | "KG" | null; name: string;
    } | undefined;
    if (recipe === undefined) return { kind: "RECIPE_NOT_FOUND" as const };
    if (recipe.company_id !== input.scope.companyId) return { kind: "COMPANY_MISMATCH" as const };
    if (recipe.status !== "APPROVED") return { kind: "RECIPE_NOT_APPROVED" as const };

    const lines = this.database.native.prepare(
      `SELECT line_number,ingredient_product_id,ingredient_presentation_id,quantity,unit_code,mass_quantity
       FROM bakery_recipe_line WHERE tenant_id=? AND recipe_id=? ORDER BY line_number`,
    ).all(input.scope.tenantId, input.recipeId) as Array<{
      line_number: number; ingredient_product_id: string; ingredient_presentation_id: string;
      quantity: string; unit_code: string; mass_quantity: string | null;
    }>;
    if (lines.length === 0) return { kind: "INVALID_RECIPE" as const };

    const policy = this.database.native.prepare(
      `SELECT shelf_life_days,release_required,policy_basis FROM catalog_bakery_finished_policy
       WHERE tenant_id=? AND product_id=?`,
    ).get(input.scope.tenantId, recipe.finished_product_id) as
      | { shelf_life_days: number; release_required: number; policy_basis: string } | undefined;
    if (policy === undefined) return { kind: "FINISHED_POLICY_REQUIRED" as const };

    const snapshot = {
      recipe_id: recipe.id,
      version: recipe.version,
      name: recipe.name,
      finished_product_id: recipe.finished_product_id,
      finished_presentation_id: recipe.finished_presentation_id,
      base_batch_quantity: recipe.base_batch_quantity,
      expected_yield_quantity: recipe.expected_yield_quantity,
      expected_shrinkage_quantity: recipe.expected_shrinkage_quantity,
      canonical_mass_unit: recipe.canonical_mass_unit,
      shelf_life_days: policy.shelf_life_days,
      release_required: policy.release_required === 1,
      policy_basis: policy.policy_basis,
      lines: lines.map((line) => ({
        line_number: line.line_number,
        ingredient_product_id: line.ingredient_product_id,
        ingredient_presentation_id: line.ingredient_presentation_id,
        quantity: line.quantity,
        unit_code: line.unit_code,
        mass_quantity: line.mass_quantity,
      })),
    };

    const orderId = uuidV7();
    const nowIso = this.now().toISOString();
    this.database.native.prepare(
      `INSERT INTO bakery_production_order(
        tenant_id,company_id,branch_id,id,status,recipe_id,recipe_version,recipe_snapshot_json,
        planned_quantity,actual_quantity,shrinkage_quantity,shrinkage_reason,production_date,
        finished_lot_id,finished_batch_code,finished_expiry_date,transform_order_id,cost_status,
        total_ingredient_cost,total_direct_cost,total_production_cost,unit_cost,costing_policy_version,
        cost_snapshot_json,actor_id,session_id,idempotency_key,request_checksum,correlation_id,
        causation_id,created_at,updated_at,cancelled_at,completed_at
      ) VALUES (
        ?,?,?,?,'DRAFT',?,?,?,?,
        NULL,NULL,NULL,NULL,
        NULL,NULL,NULL,NULL,'PENDING',
        NULL,NULL,NULL,NULL,NULL,NULL,
        ?,?,?,?,?,?,?,?,NULL,NULL
      )`,
    ).run(
      input.scope.tenantId, input.scope.companyId, input.scope.branchId, orderId,
      recipe.id, recipe.version, canonicalJson(snapshot), input.plannedQuantity,
      input.operatorUserId, input.sessionId, input.idempotencyKey, input.requestChecksum,
      input.correlationId, input.causationId, nowIso, nowIso,
    );
    this.writeAudit(
      input.scope, input.sessionId, input.operatorUserId,
      "BAKERY_PRODUCTION_ORDER_CREATED", "BAKERY_PRODUCTION_ORDER", orderId,
      input.correlationId, input.causationId,
      { recipe_id: recipe.id, recipe_version: recipe.version, planned_quantity: input.plannedQuantity },
      nowIso,
    );
    return { kind: "CREATED" as const, orderId, recipeVersion: recipe.version };
  }

  planProductionOrder(input: {
    scope: SyncScope;
    sessionId: string;
    operatorUserId: string;
    orderId: string;
    correlationId: string;
    causationId: string | null;
  }) {
    const order = this.loadOrder(input.scope, input.orderId);
    if (order === null) return { kind: "NOT_FOUND" as const };
    if (order.status !== "DRAFT") return { kind: "INVALID_STATUS" as const };
    const snapshot = JSON.parse(order.recipe_snapshot_json) as {
      base_batch_quantity: string;
      lines: Array<{ ingredient_presentation_id: string; quantity: string }>;
    };
    const scale = scale6ToBigInt(order.planned_quantity) * 1_000_000n
      / scale6ToBigInt(snapshot.base_batch_quantity);
    const shortages: Array<{ presentationId: string; required: string; available: string }> = [];
    for (const line of snapshot.lines) {
      const required = bigIntToScale6(scale6ToBigInt(line.quantity) * scale / 1_000_000n);
      const available = this.inventoryStore.availableUnits(input.scope, line.ingredient_presentation_id);
      if (available < scale6ToBigInt(required)) {
        shortages.push({
          presentationId: line.ingredient_presentation_id,
          required,
          available: bigIntToScale6(available),
        });
      }
    }
    if (shortages.length > 0) return { kind: "INSUFFICIENT_INGREDIENTS" as const, shortages };
    const nowIso = this.now().toISOString();
    this.database.native.prepare(
      `UPDATE bakery_production_order SET status='PLANNED', updated_at=?
       WHERE tenant_id=? AND branch_id=? AND id=? AND status='DRAFT'`,
    ).run(nowIso, input.scope.tenantId, input.scope.branchId, input.orderId);
    this.writeAudit(
      input.scope, input.sessionId, input.operatorUserId,
      "BAKERY_PRODUCTION_PLANNED", "BAKERY_PRODUCTION_ORDER", input.orderId,
      input.correlationId, input.causationId, { shortages: [] }, nowIso,
    );
    return { kind: "PLANNED" as const, orderId: input.orderId };
  }

  cancelProductionOrder(input: {
    scope: SyncScope;
    sessionId: string;
    operatorUserId: string;
    orderId: string;
    correlationId: string;
    causationId: string | null;
  }) {
    const order = this.loadOrder(input.scope, input.orderId);
    if (order === null) return { kind: "NOT_FOUND" as const };
    if (order.status === "COMPLETED" || order.status === "PARTIALLY_COMPLETED") {
      return { kind: "ALREADY_CONSUMED" as const };
    }
    if (order.status === "CANCELLED") return { kind: "IDEMPOTENT" as const, orderId: input.orderId };
    if (order.status === "IN_PROGRESS" && order.transform_order_id !== null) {
      return { kind: "ALREADY_CONSUMED" as const };
    }
    const nowIso = this.now().toISOString();
    this.database.native.prepare(
      `UPDATE bakery_production_order SET status='CANCELLED', cancelled_at=?, updated_at=?
       WHERE tenant_id=? AND branch_id=? AND id=?`,
    ).run(nowIso, nowIso, input.scope.tenantId, input.scope.branchId, input.orderId);
    this.writeAudit(
      input.scope, input.sessionId, input.operatorUserId,
      "BAKERY_PRODUCTION_CANCELLED", "BAKERY_PRODUCTION_ORDER", input.orderId,
      input.correlationId, input.causationId,
      { previous_status: order.status, physical_movements_reversed: false }, nowIso,
    );
    return { kind: "CANCELLED" as const, orderId: input.orderId };
  }

  /**
   * Validate consumptions against the immutable recipe snapshot.
   * Multi-lot lines for the same ingredient are consolidated.
   * Unauthorized / omitted ingredients require documented deviations.
   */
  private validateRecipeConsumptions(input: {
    scope: SyncScope;
    plannedQuantity: string;
    snapshot: {
      base_batch_quantity: string;
      lines: Array<{
        ingredient_product_id?: string;
        ingredient_presentation_id: string;
        quantity: string;
        mass_quantity: string | null;
      }>;
    };
    consumptions: ReadonlyArray<{
      ingredientPresentationId: string;
      lotId: string;
      plannedQuantity: string;
      actualQuantity: string;
      massQuantity: string | null;
    }>;
    recipeDeviations: ReadonlyArray<{
      kind: "OMISSION" | "SUBSTITUTION" | "QUANTITY_VARIANCE";
      recipePresentationId: string | null;
      ingredientPresentationId: string | null;
      reason: string;
      authorizedBy: string;
    }>;
  }): { kind: "OK" } | { kind: string; detail?: string } {
    const scale = scale6ToBigInt(input.plannedQuantity) * 1_000_000n
      / scale6ToBigInt(input.snapshot.base_batch_quantity);
    const expected = new Map<string, bigint>();
    for (const line of input.snapshot.lines) {
      const qty = scale6ToBigInt(line.quantity) * scale / 1_000_000n;
      expected.set(
        line.ingredient_presentation_id,
        (expected.get(line.ingredient_presentation_id) ?? 0n) + qty,
      );
    }

    const consolidated = new Map<string, { planned: bigint; actual: bigint; lots: string[] }>();
    for (const line of input.consumptions) {
      const lot = this.database.native.prepare(
        `SELECT presentation_id FROM inventory_lot
         WHERE tenant_id=? AND company_id=? AND branch_id=? AND id=?`,
      ).get(
        input.scope.tenantId, input.scope.companyId, input.scope.branchId, line.lotId,
      ) as { presentation_id: string } | undefined;
      if (lot === undefined) return { kind: "LOT_NOT_FOUND" };
      if (lot.presentation_id !== line.ingredientPresentationId) {
        return { kind: "RECIPE_CONSUMPTION_MISMATCH", detail: "LOT_PRESENTATION" };
      }
      const cur = consolidated.get(line.ingredientPresentationId) ?? {
        planned: 0n, actual: 0n, lots: [] as string[],
      };
      cur.planned += scale6ToBigInt(line.plannedQuantity);
      cur.actual += scale6ToBigInt(line.actualQuantity);
      cur.lots.push(line.lotId);
      consolidated.set(line.ingredientPresentationId, cur);
    }

    const omissions = new Set(
      input.recipeDeviations
        .filter((d) => d.kind === "OMISSION" && d.recipePresentationId)
        .map((d) => d.recipePresentationId!),
    );
    const substitutions = new Map<string, string>();
    for (const d of input.recipeDeviations.filter((x) => x.kind === "SUBSTITUTION")) {
      if (!d.recipePresentationId || !d.ingredientPresentationId || d.reason.trim().length === 0) {
        return { kind: "INVALID_DEVIATION" };
      }
      if (!d.authorizedBy || d.authorizedBy.length !== 36) return { kind: "INVALID_DEVIATION" };
      substitutions.set(d.ingredientPresentationId, d.recipePresentationId);
    }
    const quantityVariances = new Set(
      input.recipeDeviations
        .filter((d) => d.kind === "QUANTITY_VARIANCE" && d.ingredientPresentationId)
        .map((d) => d.ingredientPresentationId!),
    );
    for (const d of input.recipeDeviations) {
      if (d.reason.trim().length === 0 || d.authorizedBy.length !== 36) {
        return { kind: "INVALID_DEVIATION" };
      }
    }

    for (const [presentationId, expectedQty] of expected) {
      const used = consolidated.get(presentationId);
      if (used === undefined) {
        const substitutedBy = [...substitutions.entries()]
          .find(([, recipePres]) => recipePres === presentationId);
        if (substitutedBy) continue;
        if (omissions.has(presentationId)) continue;
        return { kind: "RECIPE_INGREDIENT_OMITTED", detail: presentationId };
      }
      if (used.planned !== expectedQty) {
        return { kind: "RECIPE_QUANTITY_MISMATCH", detail: presentationId };
      }
      if (used.actual !== used.planned && !quantityVariances.has(presentationId)) {
        return { kind: "DEVIATION_REQUIRED", detail: presentationId };
      }
    }

    for (const presentationId of consolidated.keys()) {
      if (expected.has(presentationId)) continue;
      if (!substitutions.has(presentationId)) {
        return { kind: "RECIPE_INGREDIENT_UNAUTHORIZED", detail: presentationId };
      }
    }

    return { kind: "OK" };
  }

  confirmProduction(input: {
    scope: SyncScope;
    sessionId: string;
    operatorUserId: string;
    orderId: string;
    /** Commercial / sellable units of finished product (not inferred mass). */
    actualQuantity: string;
    /** Measured net mass of finished output when mass conservation applies. */
    actualNetMassQuantity: string | null;
    shrinkageQuantity: string;
    shrinkageReason: string | null;
    productionDate: string;
    finishedBatchCode: string;
    consumptions: ReadonlyArray<{
      ingredientPresentationId: string;
      lotId: string;
      plannedQuantity: string;
      actualQuantity: string;
      massQuantity: string | null;
      deviationKind?: "QUANTITY_VARIANCE" | "SUBSTITUTION" | null;
      deviationReason?: string | null;
      deviationAuthorizedBy?: string | null;
    }>;
    recipeDeviations: ReadonlyArray<{
      kind: "OMISSION" | "SUBSTITUTION" | "QUANTITY_VARIANCE";
      recipePresentationId: string | null;
      ingredientPresentationId: string | null;
      reason: string;
      authorizedBy: string;
    }>;
    directCosts: ReadonlyArray<{
      costKind: "LABOR" | "ENERGY" | "PACKAGING" | "OTHER";
      amount: string;
      sourceNote: string;
    }>;
    shrinkageAttributions: ReadonlyArray<{
      presentationId: string;
      lotId: string;
      quantity: string;
      massQuantity: string | null;
    }>;
    idempotencyKey: string;
    requestChecksum: string;
    correlationId: string;
    causationId: string | null;
  }) {
    const prior = this.database.native.prepare(
      `SELECT id,request_checksum,status,transform_order_id,finished_lot_id,cost_status,
              total_production_cost,unit_cost
       FROM bakery_production_order WHERE tenant_id=? AND idempotency_key=?`,
    ).get(input.scope.tenantId, input.idempotencyKey) as {
      id: string; request_checksum: string; status: string; transform_order_id: string | null;
      finished_lot_id: string | null; cost_status: string;
      total_production_cost: string | null; unit_cost: string | null;
    } | undefined;
    if (prior) {
      if (prior.request_checksum !== input.requestChecksum) return { kind: "IDEMPOTENCY_CONFLICT" as const };
      return {
        kind: "IDEMPOTENT" as const,
        orderId: prior.id,
        transformOrderId: prior.transform_order_id,
        finishedLotId: prior.finished_lot_id,
        costStatus: prior.cost_status,
        totalProductionCost: prior.total_production_cost,
        unitCost: prior.unit_cost,
      };
    }

    class AbortConfirm extends Error {
      constructor(readonly result: Record<string, unknown>) { super("BAKERY_CONFIRM_ABORT"); }
    }
    const abort = (result: Record<string, unknown>): never => { throw new AbortConfirm(result); };

    try {
      return this.database.native.transaction(() => {
        const order = this.loadOrder(input.scope, input.orderId);
        if (order === null) abort({ kind: "NOT_FOUND" });
        if (order!.status !== "DRAFT" && order!.status !== "PLANNED" && order!.status !== "IN_PROGRESS") {
          abort({ kind: "INVALID_STATUS" });
        }
        const snapshot = JSON.parse(order!.recipe_snapshot_json) as {
          finished_presentation_id: string;
          finished_product_id: string;
          base_batch_quantity: string;
          expected_yield_quantity: string;
          expected_shrinkage_quantity: string;
          canonical_mass_unit: "G" | "KG" | null;
          shelf_life_days: number;
          release_required: boolean;
          lines: Array<{
            ingredient_product_id?: string;
            ingredient_presentation_id: string; quantity: string; mass_quantity: string | null;
          }>;
        };
        if (input.consumptions.length === 0) abort({ kind: "INVALID_QUANTITY" });
        if (!/^\d{4}-\d{2}-\d{2}$/.test(input.productionDate)) abort({ kind: "INVALID_QUANTITY" });
        if (scale6ToBigInt(input.actualQuantity) <= 0n) abort({ kind: "INVALID_QUANTITY" });

        // Commercial quantity is never treated as measured mass.
        if (snapshot.canonical_mass_unit !== null) {
          if (input.actualNetMassQuantity === null
            || scale6ToBigInt(input.actualNetMassQuantity) <= 0n) {
            abort({ kind: "MASS_QUANTITY_REQUIRED" });
          }
        } else if (input.actualNetMassQuantity !== null) {
          abort({ kind: "MASS_QUANTITY_REQUIRED" });
        }

        const recipeCheck = this.validateRecipeConsumptions({
          scope: input.scope,
          plannedQuantity: order!.planned_quantity,
          snapshot,
          consumptions: input.consumptions,
          recipeDeviations: input.recipeDeviations,
        });
        if (recipeCheck.kind !== "OK") {
          abort({
            kind: recipeCheck.kind,
            ...("detail" in recipeCheck && recipeCheck.detail !== undefined
              ? { detail: recipeCheck.detail }
              : {}),
          });
        }

        const expiryDate = (() => {
          const base = new Date(`${input.productionDate}T00:00:00.000Z`);
          base.setUTCDate(base.getUTCDate() + snapshot.shelf_life_days);
          return base.toISOString().slice(0, 10);
        })();

        this.database.native.prepare(
          `UPDATE bakery_production_order SET status='IN_PROGRESS', updated_at=?
           WHERE tenant_id=? AND branch_id=? AND id=?`,
        ).run(this.now().toISOString(), input.scope.tenantId, input.scope.branchId, input.orderId);

        const finishedMass = snapshot.canonical_mass_unit === null
          ? null
          : input.actualNetMassQuantity;

        const transform = this.inventoryStore.executeTransform({
          scope: input.scope,
          sessionId: input.sessionId,
          actorId: input.operatorUserId,
          reasonCode: "BAKERY_PRODUCTION",
          businessDate: input.productionDate,
          canonicalMassUnit: snapshot.canonical_mass_unit,
          inputs: input.consumptions.map((line) => ({
            presentationId: line.ingredientPresentationId,
            lotId: line.lotId,
            quantity: line.actualQuantity,
            massQuantity: line.massQuantity,
          })),
          outputs: [{
            presentationId: snapshot.finished_presentation_id,
            quantity: input.actualQuantity,
            massQuantity: finishedMass,
            batchCode: input.finishedBatchCode,
            expiryDate,
            manufactureDate: input.productionDate,
            initialStatus: snapshot.release_required ? "QUARANTINE" : "AVAILABLE",
          }],
          shrinkage: input.shrinkageAttributions.map((line) => ({
            presentationId: line.presentationId,
            lotId: line.lotId,
            quantity: line.quantity,
            massQuantity: line.massQuantity,
          })),
          idempotencyKey: `bakery-transform:${input.idempotencyKey}`,
          requestChecksum: createHash("sha256").update(canonicalJson({
            bakery: input.requestChecksum,
            consumptions: input.consumptions,
            actual_commercial: input.actualQuantity,
            actual_net_mass: input.actualNetMassQuantity,
            shrinkage: input.shrinkageQuantity,
            recipe_deviations: input.recipeDeviations,
          })).digest("hex"),
          correlationId: input.correlationId,
          causationId: input.causationId,
        });

        if (transform.kind !== "POSTED" && transform.kind !== "IDEMPOTENT") {
          abort({ kind: transform.kind, ...(transform.kind === "INSUFFICIENT_STOCK" ? { available: transform.available } : {}) });
        }
        const transformOrderId = transform.kind === "POSTED" || transform.kind === "IDEMPOTENT"
          ? transform.orderId
          : abort({ kind: "CONFLICT" });

        const finishedLot = this.database.native.prepare(
          `SELECT id FROM inventory_lot
           WHERE tenant_id=? AND company_id=? AND branch_id=? AND presentation_id=? AND batch_code=?`,
        ).get(
          input.scope.tenantId, input.scope.companyId, input.scope.branchId,
          snapshot.finished_presentation_id, input.finishedBatchCode,
        ) as { id: string } | undefined;
        if (finishedLot === undefined) abort({ kind: "CONFLICT" });

        let ingredientCost = 0n;
        let missingCost = false;
        let lineNumber = 1;
        for (const line of input.consumptions) {
          const cost = this.database.native.prepare(
            `SELECT unit_cost_amount FROM inventory_lot_acquisition_cost
             WHERE tenant_id=? AND branch_id=? AND lot_id=?`,
          ).get(input.scope.tenantId, input.scope.branchId, line.lotId) as
            | { unit_cost_amount: string } | undefined;
          const unitCost = cost?.unit_cost_amount ?? null;
          const lineCost = unitCost === null ? null : mulScale6(line.actualQuantity, unitCost);
          if (unitCost === null) missingCost = true;
          else ingredientCost += scale6ToBigInt(lineCost!);
          const deviationKind = line.deviationKind ?? null;
          const deviationReason = line.deviationReason ?? null;
          const deviationAuthorizedBy = line.deviationAuthorizedBy ?? null;
          this.database.native.prepare(
            `INSERT INTO bakery_production_consumption(
              tenant_id,branch_id,order_id,line_number,ingredient_presentation_id,lot_id,
              planned_quantity,actual_quantity,mass_quantity,unit_cost_amount,line_cost_amount,
              deviation_kind,deviation_reason,deviation_authorized_by
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          ).run(
            input.scope.tenantId, input.scope.branchId, input.orderId, lineNumber,
            line.ingredientPresentationId, line.lotId, line.plannedQuantity, line.actualQuantity,
            line.massQuantity, unitCost, lineCost,
            deviationKind, deviationReason, deviationAuthorizedBy,
          );
          lineNumber += 1;
        }

        let deviationLine = 1;
        for (const deviation of input.recipeDeviations) {
          this.database.native.prepare(
            `INSERT INTO bakery_production_recipe_deviation(
              tenant_id,branch_id,order_id,line_number,kind,recipe_presentation_id,
              ingredient_presentation_id,reason,authorized_by
            ) VALUES(?,?,?,?,?,?,?,?,?)`,
          ).run(
            input.scope.tenantId, input.scope.branchId, input.orderId, deviationLine,
            deviation.kind, deviation.recipePresentationId, deviation.ingredientPresentationId,
            deviation.reason, deviation.authorizedBy,
          );
          deviationLine += 1;
        }

        let directCost = 0n;
        let directLine = 1;
        for (const line of input.directCosts) {
          directCost += scale6ToBigInt(line.amount);
          this.database.native.prepare(
            `INSERT INTO bakery_production_direct_cost(
              tenant_id,branch_id,order_id,line_number,cost_kind,amount,source_note
            ) VALUES(?,?,?,?,?,?,?)`,
          ).run(
            input.scope.tenantId, input.scope.branchId, input.orderId, directLine,
            line.costKind, line.amount, line.sourceNote,
          );
          directLine += 1;
        }

        const total = ingredientCost + directCost;
        const costStatus = missingCost ? "NOT_COSTABLE" : "COSTED";
        const totalIngredient = missingCost ? null : bigIntToScale6(ingredientCost);
        const totalDirect = bigIntToScale6(directCost);
        const totalProduction = missingCost ? null : bigIntToScale6(total);
        // Unit cost uses commercial finished quantity, never invented mass-per-unit.
        const unitCost = missingCost ? null : divUnitCost(bigIntToScale6(total), input.actualQuantity);
        const costSnapshot = {
          costing_policy_version: COSTING_POLICY_VERSION,
          catalog_price_used: false,
          missing_lot_acquisition_cost: missingCost,
          ingredient_cost: totalIngredient,
          direct_cost: totalDirect,
          total_production_cost: totalProduction,
          unit_cost: unitCost,
          rounding: "FLOOR_SCALE6_DIVISION",
          commercial_quantity: input.actualQuantity,
          actual_net_mass_quantity: input.actualNetMassQuantity,
          expected_yield_quantity: snapshot.expected_yield_quantity,
          // NOT_COSTABLE: physical sale may proceed when lot is AVAILABLE/released;
          // never report 0 as definitive cost; COGS/analytics require COSTED.
          definitive_cost_reported: !missingCost,
          zero_cost_forbidden: true,
          commercial_sale_when_not_costable: "ALLOWED_IF_LOT_SELLABLE",
          cost_reporting_when_not_costable: "BLOCKED",
        };

        const planned = scale6ToBigInt(order!.planned_quantity);
        const actual = scale6ToBigInt(input.actualQuantity);
        const status = actual < planned ? "PARTIALLY_COMPLETED" : "COMPLETED";
        const nowIso = this.now().toISOString();
        this.database.native.prepare(
          `UPDATE bakery_production_order SET
            status=?, actual_quantity=?, actual_net_mass_quantity=?, shrinkage_quantity=?, shrinkage_reason=?,
            production_date=?, finished_lot_id=?, finished_batch_code=?, finished_expiry_date=?,
            transform_order_id=?, cost_status=?, total_ingredient_cost=?, total_direct_cost=?,
            total_production_cost=?, unit_cost=?, costing_policy_version=?, cost_snapshot_json=?,
            idempotency_key=?, request_checksum=?, updated_at=?, completed_at=?
           WHERE tenant_id=? AND branch_id=? AND id=?`,
        ).run(
          status, input.actualQuantity, input.actualNetMassQuantity,
          input.shrinkageQuantity, input.shrinkageReason,
          input.productionDate, finishedLot!.id, input.finishedBatchCode, expiryDate,
          transformOrderId, costStatus, totalIngredient, totalDirect, totalProduction, unitCost,
          COSTING_POLICY_VERSION, canonicalJson(costSnapshot),
          input.idempotencyKey, input.requestChecksum, nowIso, nowIso,
          input.scope.tenantId, input.scope.branchId, input.orderId,
        );

        this.writeAudit(
          input.scope, input.sessionId, input.operatorUserId,
          "BAKERY_PRODUCTION_CONFIRMED", "BAKERY_PRODUCTION_ORDER", input.orderId,
          input.correlationId, input.causationId,
          {
            status, transform_order_id: transformOrderId, finished_lot_id: finishedLot!.id,
            cost_status: costStatus, physical_rollback_safe: true,
            actual_commercial_quantity: input.actualQuantity,
            actual_net_mass_quantity: input.actualNetMassQuantity,
            release_required: snapshot.release_required,
            auto_released: false,
          },
          nowIso,
        );
        this.enqueue(
          input.scope, input.sessionId, input.operatorUserId,
          "BAKERY_PRODUCTION_ORDER", input.orderId, "BAKERY_PRODUCTION_CONFIRMED",
          input.idempotencyKey, input.correlationId, input.causationId,
          {
            order_id: input.orderId, transform_order_id: transformOrderId,
            finished_lot_id: finishedLot!.id, cost_status: costStatus,
          },
          nowIso,
        );

        return {
          kind: "CONFIRMED" as const,
          orderId: input.orderId,
          status,
          transformOrderId,
          finishedLotId: finishedLot!.id,
          finishedExpiryDate: expiryDate,
          costStatus,
          totalProductionCost: totalProduction,
          unitCost,
          sellable: !snapshot.release_required,
        };
      })();
    } catch (error) {
      if (error instanceof AbortConfirm) return error.result as never;
      throw error;
    }
  }

  releaseFinishedLot(input: {
    scope: SyncScope;
    sessionId: string;
    operatorUserId: string;
    orderId: string;
    idempotencyKey: string;
    requestChecksum: string;
    correlationId: string;
    causationId: string | null;
  }) {
    const order = this.loadOrder(input.scope, input.orderId);
    if (order === null) return { kind: "NOT_FOUND" as const };
    if (order.status !== "COMPLETED" && order.status !== "PARTIALLY_COMPLETED") {
      return { kind: "INVALID_STATUS" as const };
    }
    if (order.finished_lot_id === null) return { kind: "INVALID_STATUS" as const };
    const result = this.inventoryStore.changeBatchStatus({
      scope: input.scope,
      sessionId: input.sessionId,
      actorId: input.operatorUserId,
      lotId: order.finished_lot_id,
      status: "AVAILABLE",
      reasonCode: "BAKERY_RELEASE",
      idempotencyKey: input.idempotencyKey,
      requestChecksum: input.requestChecksum,
      correlationId: input.correlationId,
      causationId: input.causationId,
    });
    if (result === "UPDATED") return { kind: "RELEASED" as const, lotId: order.finished_lot_id };
    if (result === "IDEMPOTENT") return { kind: "IDEMPOTENT" as const, lotId: order.finished_lot_id };
    if (result === "NOT_FOUND") return { kind: "LOT_NOT_FOUND" as const };
    return { kind: "CONFLICT" as const };
  }

  getTraceability(scope: SyncScope, orderId: string) {
    const order = this.loadOrder(scope, orderId);
    if (order === null) return { kind: "NOT_FOUND" as const };
    const consumptions = this.database.native.prepare(
      `SELECT line_number,ingredient_presentation_id,lot_id,actual_quantity,unit_cost_amount,line_cost_amount
       FROM bakery_production_consumption
       WHERE tenant_id=? AND branch_id=? AND order_id=? ORDER BY line_number`,
    ).all(scope.tenantId, scope.branchId, orderId) as Array<Record<string, unknown>>;
    const sources = consumptions.map((row) => {
      const lot = this.database.native.prepare(
        `SELECT supplier_reference,receipt_document,batch_code,expiry_date
         FROM inventory_lot WHERE tenant_id=? AND branch_id=? AND id=?`,
      ).get(scope.tenantId, scope.branchId, row.lot_id) as Record<string, unknown> | undefined;
      return { ...row, lot };
    });
    return {
      kind: "FOUND" as const,
      orderId,
      recipeId: order.recipe_id,
      recipeVersion: order.recipe_version,
      transformOrderId: order.transform_order_id,
      finishedLotId: order.finished_lot_id,
      finishedBatchCode: order.finished_batch_code,
      costStatus: order.cost_status,
      totalProductionCost: order.total_production_cost,
      unitCost: order.unit_cost,
      sources,
    };
  }

  private loadOrder(scope: SyncScope, orderId: string) {
    return this.database.native.prepare(
      `SELECT id,status,recipe_id,recipe_version,recipe_snapshot_json,planned_quantity,
              actual_quantity,transform_order_id,finished_lot_id,finished_batch_code,cost_status,
              total_production_cost,unit_cost,company_id
       FROM bakery_production_order WHERE tenant_id=? AND branch_id=? AND id=?`,
    ).get(scope.tenantId, scope.branchId, orderId) as {
      id: string; status: string; recipe_id: string; recipe_version: number;
      recipe_snapshot_json: string; planned_quantity: string; actual_quantity: string | null;
      transform_order_id: string | null; finished_lot_id: string | null;
      finished_batch_code: string | null; cost_status: string;
      total_production_cost: string | null; unit_cost: string | null; company_id: string;
    } | null ?? null;
  }
}
