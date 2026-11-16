import { createHash } from "node:crypto";
import { createActor, createOperationScope, evaluatePermission, toRoleAssignments } from "@pos-platform/application";
import { CanonicalPermission } from "@pos-platform/contracts";
import { canonicalJson } from "../channel/canonical-json.js";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import type { SqliteInventoryStore } from "../inventory/sqlite-inventory-store.js";
import type {
  ControlledAuthorizationStatus,
  DispensationCategory,
  EstablishmentType,
  PharmacyProductKind,
  RegistrationVerificationStatus,
  SqlitePharmacyStore,
} from "./sqlite-pharmacy-store.js";

function authorized(
  scope: SyncScope,
  snapshot: StoredAuthorizationSnapshot,
  permission: string,
  at: Date,
): boolean {
  return evaluatePermission({
    actor: createActor("USER", snapshot.claims.user_id),
    permission,
    scope: createOperationScope(scope.tenantId, scope.companyId, scope.branchId),
    at,
    assignments: toRoleAssignments(snapshot.claims),
  }).allowed;
}

export class UpsertPharmacyEstablishmentUseCase {
  constructor(private readonly store: SqlitePharmacyStore) {}

  execute(
    scope: SyncScope,
    sessionId: string,
    authSnapshot: StoredAuthorizationSnapshot,
    request: {
      establishmentType: EstablishmentType;
      authorizedOtc: boolean;
      authorizedPrescription: boolean;
      authorizedControlledSpecial: boolean;
      controlledAuthorizationStatus: ControlledAuthorizationStatus;
      controlledAuthorizationNote: string | null;
      technicalDirectorAttribution: string | null;
      idempotencyKey: string;
      correlationId: string;
      causationId: string | null;
    },
    at: Date = new Date(),
  ) {
    if (!authorized(scope, authSnapshot, CanonicalPermission.CATALOG_PRODUCT_REGISTER, at)) {
      return { kind: "UNAUTHORIZED" as const };
    }
    const requestChecksum = createHash("sha256").update(canonicalJson({
      ...request,
      tenant_id: scope.tenantId,
      company_id: scope.companyId,
      branch_id: scope.branchId,
      actor_id: authSnapshot.claims.user_id,
    })).digest("hex");
    return this.store.upsertEstablishment({
      scope,
      sessionId,
      operatorUserId: authSnapshot.claims.user_id,
      ...request,
      requestChecksum,
    });
  }
}

export class UpsertPharmacyProfileUseCase {
  constructor(private readonly store: SqlitePharmacyStore) {}

  execute(
    scope: SyncScope,
    sessionId: string,
    authSnapshot: StoredAuthorizationSnapshot,
    request: {
      productId: string;
      productKind: PharmacyProductKind;
      commercialName: string;
      genericName: string | null;
      activeIngredients: ReadonlyArray<string>;
      concentrationText: string | null;
      pharmaceuticalForm: string | null;
      manufacturer: string | null;
      sanitaryHolder: string | null;
      sanitaryRegistration: string | null;
      registrationVerificationStatus: RegistrationVerificationStatus;
      dispensationCategory: DispensationCategory;
      requiresPrescription: boolean;
      controlledSpecial: boolean;
      storageCondition: "AMBIENT" | "CHILLED" | "CONTROLLED_ROOM" | "OTHER";
      requiresLotTracking: boolean;
      requiresExpiry: boolean;
      regulatoryReviewAt: string | null;
      idempotencyKey: string;
      correlationId: string;
      causationId: string | null;
    },
    at: Date = new Date(),
  ) {
    if (!authorized(scope, authSnapshot, CanonicalPermission.CATALOG_PRODUCT_REGISTER, at)) {
      return { kind: "UNAUTHORIZED" as const };
    }
    const requestChecksum = createHash("sha256").update(canonicalJson({
      ...request,
      tenant_id: scope.tenantId,
      company_id: scope.companyId,
      actor_id: authSnapshot.claims.user_id,
    })).digest("hex");
    return this.store.upsertProfile({
      scope,
      sessionId,
      operatorUserId: authSnapshot.claims.user_id,
      productId: request.productId,
      profile: {
        productKind: request.productKind,
        commercialName: request.commercialName,
        genericName: request.genericName,
        activeIngredientsJson: JSON.stringify(request.activeIngredients),
        concentrationText: request.concentrationText,
        pharmaceuticalForm: request.pharmaceuticalForm,
        manufacturer: request.manufacturer,
        sanitaryHolder: request.sanitaryHolder,
        sanitaryRegistration: request.sanitaryRegistration,
        registrationVerificationStatus: request.registrationVerificationStatus,
        dispensationCategory: request.dispensationCategory,
        requiresPrescription: request.requiresPrescription,
        controlledSpecial: request.controlledSpecial,
        storageCondition: request.storageCondition,
        requiresLotTracking: request.requiresLotTracking,
        requiresExpiry: request.requiresExpiry,
        regulatoryReviewAt: request.regulatoryReviewAt,
      },
      idempotencyKey: request.idempotencyKey,
      requestChecksum,
      correlationId: request.correlationId,
      causationId: request.causationId,
    });
  }
}

export class RegisterPharmacyPrescriptionUseCase {
  constructor(private readonly store: SqlitePharmacyStore) {}

  execute(
    scope: SyncScope,
    sessionId: string,
    authSnapshot: StoredAuthorizationSnapshot,
    request: {
      productId: string;
      prescribedQuantity: string;
      prescribedAt: string;
      expiresAt: string;
      issuerProfessionalId: string;
      issuerName: string;
      patientReference: string;
      idempotencyKey: string;
      correlationId: string;
      causationId: string | null;
    },
    at: Date = new Date(),
  ) {
    // Prescription capture is an administrative/dispensing support write — not cashier catalog edit.
    if (!authorized(scope, authSnapshot, CanonicalPermission.SALES_SALE_CREATE, at)
      && !authorized(scope, authSnapshot, CanonicalPermission.CATALOG_PRODUCT_REGISTER, at)) {
      return { kind: "UNAUTHORIZED" as const };
    }
    const requestChecksum = createHash("sha256").update(canonicalJson({
      ...request,
      tenant_id: scope.tenantId,
      company_id: scope.companyId,
      branch_id: scope.branchId,
      actor_id: authSnapshot.claims.user_id,
    })).digest("hex");
    return this.store.registerPrescription({
      scope,
      sessionId,
      operatorUserId: authSnapshot.claims.user_id,
      ...request,
      requestChecksum,
    });
  }
}

export class RegisterPharmacyTechnicalReceiptUseCase {
  constructor(
    private readonly store: SqlitePharmacyStore,
    private readonly inventoryStore?: SqliteInventoryStore,
  ) {}

  execute(
    scope: SyncScope,
    sessionId: string,
    authSnapshot: StoredAuthorizationSnapshot,
    request: {
      presentationId: string;
      lotId: string | null;
      sanitaryRegistration: string | null;
      batchCode: string;
      expiryDate: string | null;
      quantity: string;
      storageCondition: "AMBIENT" | "CHILLED" | "CONTROLLED_ROOM" | "OTHER";
      inspectionResult: "ACCEPTED" | "QUARANTINE" | "REJECTED";
      observations: string | null;
      inventoryMovementId: string | null;
      idempotencyKey: string;
      correlationId: string;
      causationId: string | null;
    },
    at: Date = new Date(),
  ) {
    if (!authorized(scope, authSnapshot, CanonicalPermission.INVENTORY_STOCK_RECEIVE, at)) {
      return { kind: "UNAUTHORIZED" as const };
    }
    const requestChecksum = createHash("sha256").update(canonicalJson({
      ...request,
      tenant_id: scope.tenantId,
      company_id: scope.companyId,
      branch_id: scope.branchId,
      actor_id: authSnapshot.claims.user_id,
    })).digest("hex");
    const recorded = this.store.registerTechnicalReceipt({
      scope,
      sessionId,
      operatorUserId: authSnapshot.claims.user_id,
      ...request,
      requestChecksum,
    });
    if (
      recorded.kind === "RECORDED"
      && request.inspectionResult === "QUARANTINE"
      && request.lotId !== null
      && this.inventoryStore !== undefined
    ) {
      const statusChecksum = createHash("sha256").update(canonicalJson({
        tenant_id: scope.tenantId,
        company_id: scope.companyId,
        branch_id: scope.branchId,
        lot_id: request.lotId,
        next_status: "QUARANTINE",
        reason_code: "TECHNICAL_QUARANTINE",
        actor_id: authSnapshot.claims.user_id,
        idempotency_key: `${request.idempotencyKey}:lot-status`,
      })).digest("hex");
      this.inventoryStore.changeBatchStatus({
        scope,
        sessionId,
        lotId: request.lotId,
        status: "QUARANTINE",
        actorId: authSnapshot.claims.user_id,
        reasonCode: "TECHNICAL_QUARANTINE",
        idempotencyKey: `${request.idempotencyKey}:lot-status`,
        requestChecksum: statusChecksum,
        correlationId: request.correlationId,
        causationId: request.causationId,
      });
    }
    return recorded;
  }
}

export class RegisterPharmacySanitaryAlertUseCase {
  constructor(
    private readonly store: SqlitePharmacyStore,
    private readonly inventoryStore?: SqliteInventoryStore,
  ) {}

  execute(
    scope: SyncScope,
    sessionId: string,
    authSnapshot: StoredAuthorizationSnapshot,
    request: {
      sourceKind: "MANUAL_AUTHORIZED" | "EXTERNAL_IMPORT";
      sourceReference: string;
      productId: string | null;
      lotId: string | null;
      actionCode: "QUARANTINE" | "RECALL";
      evidenceNote: string;
      idempotencyKey: string;
      correlationId: string;
      causationId: string | null;
    },
    at: Date = new Date(),
  ) {
    if (!authorized(scope, authSnapshot, CanonicalPermission.INVENTORY_STOCK_ADJUST, at)) {
      return { kind: "UNAUTHORIZED" as const };
    }
    const requestChecksum = createHash("sha256").update(canonicalJson({
      ...request,
      tenant_id: scope.tenantId,
      company_id: scope.companyId,
      branch_id: scope.branchId,
      actor_id: authSnapshot.claims.user_id,
    })).digest("hex");
    const recorded = this.store.registerSanitaryAlert({
      scope,
      sessionId,
      operatorUserId: authSnapshot.claims.user_id,
      ...request,
      requestChecksum,
    });
    if (
      recorded.kind === "RECORDED"
      && request.lotId !== null
      && this.inventoryStore !== undefined
    ) {
      const nextStatus = request.actionCode === "RECALL" ? "RECALLED" : "QUARANTINE";
      const statusChecksum = createHash("sha256").update(canonicalJson({
        tenant_id: scope.tenantId,
        company_id: scope.companyId,
        branch_id: scope.branchId,
        lot_id: request.lotId,
        next_status: nextStatus,
        reason_code: `SANITARY_${request.actionCode}`,
        actor_id: authSnapshot.claims.user_id,
        idempotency_key: `${request.idempotencyKey}:lot-status`,
      })).digest("hex");
      this.inventoryStore.changeBatchStatus({
        scope,
        sessionId,
        lotId: request.lotId,
        status: nextStatus,
        actorId: authSnapshot.claims.user_id,
        reasonCode: `SANITARY_${request.actionCode}`,
        idempotencyKey: `${request.idempotencyKey}:lot-status`,
        requestChecksum: statusChecksum,
        correlationId: request.correlationId,
        causationId: request.causationId,
      });
    }
    return recorded;
  }
}
