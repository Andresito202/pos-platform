import { createHash } from "node:crypto";
import { uuidV7 } from "@pos-platform/contracts";
import type { LocalDatabase } from "@pos-platform/database-sqlite";
import { canonicalJson } from "../channel/canonical-json.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import { DurableSyncStore } from "../sync/durable-sync-store.js";
import { scale6ToBigInt } from "../money.js";

export type EstablishmentType =
  | "DROGUERIA"
  | "FARMACIA_DROGUERIA"
  | "SERVICIO_FARMACEUTICO_IPS"
  | "DEPOSITO_MAYORISTA";

export type DispensationCategory =
  | "OTC"
  | "PRESCRIPTION"
  | "CONTROLLED_SPECIAL"
  | "UNKNOWN";

export type RegistrationVerificationStatus =
  | "UNVERIFIED"
  | "VERIFIED_MANUAL"
  | "INVALID"
  | "EXPIRED";

export type PharmacyProductKind =
  | "MEDICINE"
  | "MEDICAL_DEVICE"
  | "COSMETIC"
  | "SUPPLEMENT"
  | "OTHER";

export type ControlledAuthorizationStatus =
  | "NONE"
  | "PENDING_FNE"
  | "ACCREDITED"
  | "REVOKED";

export interface PharmacyEstablishment {
  establishmentType: EstablishmentType;
  authorizedOtc: boolean;
  authorizedPrescription: boolean;
  authorizedControlledSpecial: boolean;
  controlledAuthorizationStatus: ControlledAuthorizationStatus;
  controlledAuthorizationNote: string | null;
  technicalDirectorAttribution: string | null;
  version: number;
}

export interface PharmacyProfile {
  productKind: PharmacyProductKind;
  commercialName: string;
  genericName: string | null;
  activeIngredientsJson: string;
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
  version: number;
}

export type PharmacyEligibilityDenial =
  | "PHARMACY_CLASSIFICATION_UNKNOWN"
  | "PHARMACY_REGISTRATION_UNVERIFIED"
  | "PHARMACY_ESTABLISHMENT_UNAUTHORIZED"
  | "PHARMACY_PRESCRIPTION_REQUIRED"
  | "PHARMACY_PRESCRIPTION_INVALID"
  | "PHARMACY_CONTROLLED_BLOCKED"
  | "PHARMACY_COMPETENCE_REQUIRED"
  | "PHARMACY_QUANTITY_EXCEEDS_PRESCRIPTION"
  | "PHARMACY_LOT_INELIGIBLE"
  | "PHARMACY_RECONCILIATION_HOLD";

/**
 * Farmacia/Droguería specialization over shared Catalog + Inventory.
 * Fail-closed for UNKNOWN / UNVERIFIED / CONTROLLED without accredited FNE evidence.
 * Does not claim INVIMA sync, sanitary certification or official FNE reports.
 */
export class SqlitePharmacyStore {
  constructor(
    private readonly database: LocalDatabase,
    private readonly durableSync: DurableSyncStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  getEstablishment(scope: SyncScope): PharmacyEstablishment | null {
    const row = this.database.native.prepare(
      `SELECT establishment_type, authorized_otc, authorized_prescription,
              authorized_controlled_special, controlled_authorization_status,
              controlled_authorization_note, technical_director_attribution, version
       FROM company_pharmacy_establishment
       WHERE tenant_id=? AND company_id=? AND branch_id=?`,
    ).get(scope.tenantId, scope.companyId, scope.branchId) as {
      establishment_type: EstablishmentType;
      authorized_otc: number;
      authorized_prescription: number;
      authorized_controlled_special: number;
      controlled_authorization_status: ControlledAuthorizationStatus;
      controlled_authorization_note: string | null;
      technical_director_attribution: string | null;
      version: number;
    } | undefined;
    if (!row) return null;
    return {
      establishmentType: row.establishment_type,
      authorizedOtc: row.authorized_otc === 1,
      authorizedPrescription: row.authorized_prescription === 1,
      authorizedControlledSpecial: row.authorized_controlled_special === 1,
      controlledAuthorizationStatus: row.controlled_authorization_status,
      controlledAuthorizationNote: row.controlled_authorization_note,
      technicalDirectorAttribution: row.technical_director_attribution,
      version: row.version,
    };
  }

  upsertEstablishment(input: {
    scope: SyncScope;
    sessionId: string;
    operatorUserId: string;
    establishmentType: EstablishmentType;
    authorizedOtc: boolean;
    authorizedPrescription: boolean;
    authorizedControlledSpecial: boolean;
    controlledAuthorizationStatus: ControlledAuthorizationStatus;
    controlledAuthorizationNote: string | null;
    technicalDirectorAttribution: string | null;
    idempotencyKey: string;
    requestChecksum: string;
    correlationId: string;
    causationId: string | null;
  }):
    | { kind: "SAVED"; version: number }
    | { kind: "IDEMPOTENT"; version: number }
    | { kind: "IDEMPOTENCY_CONFLICT" }
    | { kind: "INVALID_CONFIGURATION" } {
    // Controlled special remains fail-closed unless ACCREDITED evidence is recorded.
    if (
      input.authorizedControlledSpecial
      && input.controlledAuthorizationStatus !== "ACCREDITED"
    ) {
      return { kind: "INVALID_CONFIGURATION" };
    }
    if (
      input.controlledAuthorizationStatus === "ACCREDITED"
      && (input.controlledAuthorizationNote === null
        || input.controlledAuthorizationNote.trim().length < 8)
    ) {
      return { kind: "INVALID_CONFIGURATION" };
    }
    return this.database.native.transaction(() => {
      const nowIso = this.now().toISOString();
      const priorOp = this.database.native.prepare(
        "SELECT payload_checksum FROM runtime_operations WHERE idempotency_key=?",
      ).get(input.idempotencyKey) as { payload_checksum: string } | undefined;
      if (priorOp) {
        if (priorOp.payload_checksum !== input.requestChecksum) return { kind: "IDEMPOTENCY_CONFLICT" as const };
        const existing = this.getEstablishment(input.scope);
        return { kind: "IDEMPOTENT" as const, version: existing?.version ?? 0 };
      }
      const prior = this.getEstablishment(input.scope);
      const version = (prior?.version ?? 0) + 1;
      if (prior) {
        this.database.native.prepare(
          `UPDATE company_pharmacy_establishment SET
            establishment_type=?, authorized_otc=?, authorized_prescription=?,
            authorized_controlled_special=?, controlled_authorization_status=?,
            controlled_authorization_note=?, technical_director_attribution=?,
            version=?, updated_by=?, updated_at=?
           WHERE tenant_id=? AND company_id=? AND branch_id=?`,
        ).run(
          input.establishmentType, input.authorizedOtc ? 1 : 0, input.authorizedPrescription ? 1 : 0,
          input.authorizedControlledSpecial ? 1 : 0, input.controlledAuthorizationStatus,
          input.controlledAuthorizationNote, input.technicalDirectorAttribution,
          version, input.operatorUserId, nowIso,
          input.scope.tenantId, input.scope.companyId, input.scope.branchId,
        );
      } else {
        this.database.native.prepare(
          `INSERT INTO company_pharmacy_establishment(
            tenant_id,company_id,branch_id,establishment_type,authorized_otc,authorized_prescription,
            authorized_controlled_special,controlled_authorization_status,controlled_authorization_note,
            technical_director_attribution,version,updated_by,updated_at
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(
          input.scope.tenantId, input.scope.companyId, input.scope.branchId, input.establishmentType,
          input.authorizedOtc ? 1 : 0, input.authorizedPrescription ? 1 : 0,
          input.authorizedControlledSpecial ? 1 : 0, input.controlledAuthorizationStatus,
          input.controlledAuthorizationNote, input.technicalDirectorAttribution,
          version, input.operatorUserId, nowIso,
        );
      }
      this.recordOperation(input.idempotencyKey, input.requestChecksum, "PHARMACY_ESTABLISHMENT_SAVED", nowIso);
      this.writeAudit(input.scope, input.sessionId, input.operatorUserId, "PHARMACY_ESTABLISHMENT_UPSERT",
        "PHARMACY_ESTABLISHMENT", `${input.scope.companyId}:${input.scope.branchId}`,
        input.correlationId, input.causationId, { version, establishment_type: input.establishmentType }, nowIso);
      return { kind: "SAVED" as const, version };
    })();
  }

  getProfile(scope: { tenantId: string; companyId: string }, productId: string): PharmacyProfile | null {
    const row = this.database.native.prepare(
      `SELECT product_kind, commercial_name, generic_name, active_ingredients_json, concentration_text,
              pharmaceutical_form, manufacturer, sanitary_holder, sanitary_registration,
              registration_verification_status, dispensation_category, requires_prescription,
              controlled_special, storage_condition, requires_lot_tracking, requires_expiry,
              regulatory_review_at, version
       FROM catalog_pharmacy_profile WHERE tenant_id=? AND company_id=? AND product_id=?`,
    ).get(scope.tenantId, scope.companyId, productId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      productKind: row.product_kind as PharmacyProductKind,
      commercialName: String(row.commercial_name),
      genericName: (row.generic_name as string | null) ?? null,
      activeIngredientsJson: String(row.active_ingredients_json),
      concentrationText: (row.concentration_text as string | null) ?? null,
      pharmaceuticalForm: (row.pharmaceutical_form as string | null) ?? null,
      manufacturer: (row.manufacturer as string | null) ?? null,
      sanitaryHolder: (row.sanitary_holder as string | null) ?? null,
      sanitaryRegistration: (row.sanitary_registration as string | null) ?? null,
      registrationVerificationStatus: row.registration_verification_status as RegistrationVerificationStatus,
      dispensationCategory: row.dispensation_category as DispensationCategory,
      requiresPrescription: Number(row.requires_prescription) === 1,
      controlledSpecial: Number(row.controlled_special) === 1,
      storageCondition: row.storage_condition as PharmacyProfile["storageCondition"],
      requiresLotTracking: Number(row.requires_lot_tracking) === 1,
      requiresExpiry: Number(row.requires_expiry) === 1,
      regulatoryReviewAt: (row.regulatory_review_at as string | null) ?? null,
      version: Number(row.version),
    };
  }

  upsertProfile(input: {
    scope: SyncScope;
    sessionId: string;
    operatorUserId: string;
    productId: string;
    profile: Omit<PharmacyProfile, "version">;
    idempotencyKey: string;
    requestChecksum: string;
    correlationId: string;
    causationId: string | null;
  }):
    | { kind: "SAVED"; version: number }
    | { kind: "IDEMPOTENT"; version: number }
    | { kind: "IDEMPOTENCY_CONFLICT" }
    | { kind: "PRODUCT_NOT_FOUND" }
    | { kind: "INVALID_CONFIGURATION" } {
    const p = input.profile;
    if (p.dispensationCategory === "UNKNOWN" && (p.requiresPrescription || p.controlledSpecial)) {
      return { kind: "INVALID_CONFIGURATION" };
    }
    if (p.controlledSpecial && p.dispensationCategory !== "CONTROLLED_SPECIAL") {
      return { kind: "INVALID_CONFIGURATION" };
    }
    if (p.dispensationCategory === "PRESCRIPTION" && !p.requiresPrescription) {
      return { kind: "INVALID_CONFIGURATION" };
    }
    try {
      const parsed = JSON.parse(p.activeIngredientsJson);
      if (!Array.isArray(parsed)) return { kind: "INVALID_CONFIGURATION" };
    } catch {
      return { kind: "INVALID_CONFIGURATION" };
    }
    return this.database.native.transaction(() => {
      const nowIso = this.now().toISOString();
      const priorOp = this.database.native.prepare(
        "SELECT payload_checksum FROM runtime_operations WHERE idempotency_key=?",
      ).get(input.idempotencyKey) as { payload_checksum: string } | undefined;
      if (priorOp) {
        if (priorOp.payload_checksum !== input.requestChecksum) return { kind: "IDEMPOTENCY_CONFLICT" as const };
        const existing = this.getProfile(input.scope, input.productId);
        return { kind: "IDEMPOTENT" as const, version: existing?.version ?? 0 };
      }
      const product = this.database.native.prepare(
        "SELECT id FROM catalog_product WHERE tenant_id=? AND company_id=? AND id=?",
      ).get(input.scope.tenantId, input.scope.companyId, input.productId) as { id: string } | undefined;
      if (!product) return { kind: "PRODUCT_NOT_FOUND" as const };
      const prior = this.getProfile(input.scope, input.productId);
      const version = (prior?.version ?? 0) + 1;
      if (prior) {
        this.database.native.prepare(
          `UPDATE catalog_pharmacy_profile SET
            company_id=?, product_kind=?, commercial_name=?, generic_name=?, active_ingredients_json=?,
            concentration_text=?, pharmaceutical_form=?, manufacturer=?, sanitary_holder=?,
            sanitary_registration=?, registration_verification_status=?, dispensation_category=?,
            requires_prescription=?, controlled_special=?, storage_condition=?, requires_lot_tracking=?,
            requires_expiry=?, regulatory_review_at=?, version=?, updated_by=?, updated_at=?
           WHERE tenant_id=? AND product_id=?`,
        ).run(
          input.scope.companyId, p.productKind, p.commercialName, p.genericName, p.activeIngredientsJson,
          p.concentrationText, p.pharmaceuticalForm, p.manufacturer, p.sanitaryHolder,
          p.sanitaryRegistration, p.registrationVerificationStatus, p.dispensationCategory,
          p.requiresPrescription ? 1 : 0, p.controlledSpecial ? 1 : 0, p.storageCondition,
          p.requiresLotTracking ? 1 : 0, p.requiresExpiry ? 1 : 0, p.regulatoryReviewAt,
          version, input.operatorUserId, nowIso, input.scope.tenantId, input.productId,
        );
      } else {
        this.database.native.prepare(
          `INSERT INTO catalog_pharmacy_profile(
            tenant_id,company_id,product_id,product_kind,commercial_name,generic_name,active_ingredients_json,
            concentration_text,pharmaceutical_form,manufacturer,sanitary_holder,sanitary_registration,
            registration_verification_status,dispensation_category,requires_prescription,controlled_special,
            storage_condition,requires_lot_tracking,requires_expiry,regulatory_review_at,version,updated_by,updated_at
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(
          input.scope.tenantId, input.scope.companyId, input.productId, p.productKind, p.commercialName,
          p.genericName, p.activeIngredientsJson, p.concentrationText, p.pharmaceuticalForm,
          p.manufacturer, p.sanitaryHolder, p.sanitaryRegistration, p.registrationVerificationStatus,
          p.dispensationCategory, p.requiresPrescription ? 1 : 0, p.controlledSpecial ? 1 : 0,
          p.storageCondition, p.requiresLotTracking ? 1 : 0, p.requiresExpiry ? 1 : 0,
          p.regulatoryReviewAt, version, input.operatorUserId, nowIso,
        );
      }
      this.recordOperation(input.idempotencyKey, input.requestChecksum, "PHARMACY_PROFILE_SAVED", nowIso);
      this.writeAudit(input.scope, input.sessionId, input.operatorUserId, "PHARMACY_PROFILE_UPSERT",
        "CATALOG_PRODUCT", input.productId, input.correlationId, input.causationId,
        { version, dispensation_category: p.dispensationCategory }, nowIso);
      this.enqueueOutbox(input.scope, input.sessionId, input.operatorUserId, input.productId,
        "PHARMACY_PROFILE_UPSERT", input.idempotencyKey, input.correlationId, input.causationId,
        { product_id: input.productId, version, dispensation_category: p.dispensationCategory }, nowIso);
      return { kind: "SAVED" as const, version };
    })();
  }

  registerPrescription(input: {
    scope: SyncScope;
    sessionId: string;
    operatorUserId: string;
    productId: string;
    prescribedQuantity: string;
    prescribedAt: string;
    expiresAt: string;
    issuerProfessionalId: string;
    issuerName: string;
    patientReference: string;
    idempotencyKey: string;
    requestChecksum: string;
    correlationId: string;
    causationId: string | null;
  }):
    | { kind: "REGISTERED"; prescriptionId: string }
    | { kind: "IDEMPOTENT"; prescriptionId: string }
    | { kind: "IDEMPOTENCY_CONFLICT" }
    | { kind: "PRODUCT_NOT_FOUND" }
    | { kind: "INVALID_QUANTITY" } {
    if (!/^(0|[1-9]\d{0,12})\.\d{6}$/.test(input.prescribedQuantity)
      || scale6ToBigInt(input.prescribedQuantity) <= 0n) {
      return { kind: "INVALID_QUANTITY" };
    }
    if (input.expiresAt < input.prescribedAt) return { kind: "INVALID_QUANTITY" };
    return this.database.native.transaction(() => {
      const nowIso = this.now().toISOString();
      const prior = this.database.native.prepare(
        `SELECT id, request_checksum FROM pharmacy_prescription
         WHERE tenant_id=? AND idempotency_key=?`,
      ).get(input.scope.tenantId, input.idempotencyKey) as
        { id: string; request_checksum: string } | undefined;
      if (prior) {
        return prior.request_checksum === input.requestChecksum
          ? { kind: "IDEMPOTENT" as const, prescriptionId: prior.id }
          : { kind: "IDEMPOTENCY_CONFLICT" as const };
      }
      const product = this.database.native.prepare(
        "SELECT id FROM catalog_product WHERE tenant_id=? AND company_id=? AND id=?",
      ).get(input.scope.tenantId, input.scope.companyId, input.productId) as { id: string } | undefined;
      if (!product) return { kind: "PRODUCT_NOT_FOUND" as const };
      const id = uuidV7();
      this.database.native.prepare(
        `INSERT INTO pharmacy_prescription(
          tenant_id,company_id,branch_id,id,product_id,prescribed_quantity,prescribed_at,expires_at,
          issuer_professional_id,issuer_name,patient_reference,status,actor_id,session_id,
          idempotency_key,request_checksum,correlation_id,causation_id,created_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,'ACTIVE',?,?,?,?,?,?,?)`,
      ).run(
        input.scope.tenantId, input.scope.companyId, input.scope.branchId, id, input.productId,
        input.prescribedQuantity, input.prescribedAt, input.expiresAt, input.issuerProfessionalId,
        input.issuerName, input.patientReference, input.operatorUserId, input.sessionId,
        input.idempotencyKey, input.requestChecksum, input.correlationId, input.causationId, nowIso,
      );
      this.writeAudit(input.scope, input.sessionId, input.operatorUserId, "PHARMACY_PRESCRIPTION_REGISTER",
        "PHARMACY_PRESCRIPTION", id, input.correlationId, input.causationId,
        { product_id: input.productId, patient_reference: input.patientReference }, nowIso);
      return { kind: "REGISTERED" as const, prescriptionId: id };
    })();
  }

  evaluateLineEligibility(input: {
    scope: SyncScope;
    productId: string;
    quantity: string;
    prescriptionId: string | null;
    professionalCompetenceCode: string | null;
    atIso?: string;
  }): { kind: "ALLOWED"; profile: PharmacyProfile | null; snapshot: Record<string, unknown> }
    | { kind: "DENIED"; reason: PharmacyEligibilityDenial; snapshot: Record<string, unknown> } {
    const profile = this.getProfile(input.scope, input.productId);
    const establishment = this.getEstablishment(input.scope);
    const at = (input.atIso ?? this.now().toISOString()).slice(0, 10);
    const snapshot: Record<string, unknown> = {
      product_id: input.productId,
      has_profile: profile !== null,
      establishment_type: establishment?.establishmentType ?? null,
      controlled_authorization_status: establishment?.controlledAuthorizationStatus ?? null,
    };
    if (!profile) {
      // Ordinary commercial product without pharmacy profile remains allowed.
      return { kind: "ALLOWED", profile: null, snapshot: { ...snapshot, path: "NON_PHARMACY" } };
    }
    snapshot.dispensation_category = profile.dispensationCategory;
    snapshot.registration_verification_status = profile.registrationVerificationStatus;

    if (profile.dispensationCategory === "UNKNOWN") {
      return { kind: "DENIED", reason: "PHARMACY_CLASSIFICATION_UNKNOWN", snapshot };
    }
    if (
      profile.productKind === "MEDICINE"
      && (profile.registrationVerificationStatus === "UNVERIFIED"
        || profile.registrationVerificationStatus === "INVALID"
        || profile.registrationVerificationStatus === "EXPIRED")
      && profile.dispensationCategory !== "OTC"
    ) {
      return { kind: "DENIED", reason: "PHARMACY_REGISTRATION_UNVERIFIED", snapshot };
    }
    if (!establishment) {
      if (profile.dispensationCategory === "OTC" && !profile.controlledSpecial) {
        // OTC without establishment config: still require explicit OTC authorization surface.
        return { kind: "DENIED", reason: "PHARMACY_ESTABLISHMENT_UNAUTHORIZED", snapshot };
      }
      return { kind: "DENIED", reason: "PHARMACY_ESTABLISHMENT_UNAUTHORIZED", snapshot };
    }
    if (profile.dispensationCategory === "OTC") {
      if (!establishment.authorizedOtc) {
        return { kind: "DENIED", reason: "PHARMACY_ESTABLISHMENT_UNAUTHORIZED", snapshot };
      }
      return { kind: "ALLOWED", profile, snapshot: { ...snapshot, path: "OTC" } };
    }
    if (profile.dispensationCategory === "PRESCRIPTION" || profile.requiresPrescription) {
      if (!establishment.authorizedPrescription) {
        return { kind: "DENIED", reason: "PHARMACY_ESTABLISHMENT_UNAUTHORIZED", snapshot };
      }
      if (!input.prescriptionId) {
        return { kind: "DENIED", reason: "PHARMACY_PRESCRIPTION_REQUIRED", snapshot };
      }
      const prescription = this.loadActivePrescription(input.scope, input.prescriptionId, input.productId, at);
      if (!prescription) {
        return { kind: "DENIED", reason: "PHARMACY_PRESCRIPTION_INVALID", snapshot };
      }
      if (scale6ToBigInt(input.quantity) > scale6ToBigInt(prescription.prescribed_quantity)) {
        return { kind: "DENIED", reason: "PHARMACY_QUANTITY_EXCEEDS_PRESCRIPTION", snapshot };
      }
      snapshot.prescription_id = prescription.id;
    }
    if (profile.controlledSpecial || profile.dispensationCategory === "CONTROLLED_SPECIAL") {
      // Default BLOCKED until FNE/establishment accreditation is recorded with evidence.
      if (
        !establishment.authorizedControlledSpecial
        || establishment.controlledAuthorizationStatus !== "ACCREDITED"
      ) {
        return { kind: "DENIED", reason: "PHARMACY_CONTROLLED_BLOCKED", snapshot };
      }
      if (!input.professionalCompetenceCode || input.professionalCompetenceCode.trim().length < 3) {
        return { kind: "DENIED", reason: "PHARMACY_COMPETENCE_REQUIRED", snapshot };
      }
      if (!input.prescriptionId) {
        return { kind: "DENIED", reason: "PHARMACY_PRESCRIPTION_REQUIRED", snapshot };
      }
      // Official FNE report formats / government ACK are external — ledger writes stay blocked
      // until a separate accredited reporting integration exists. Dispensation itself remains denied
      // here to avoid claiming controlled capability without report pathway.
      return {
        kind: "DENIED",
        reason: "PHARMACY_CONTROLLED_BLOCKED",
        snapshot: {
          ...snapshot,
          blocked_dependency: "FNE_REPORTING_AND_OFFICIAL_LEDGER_NOT_INTEGRATED",
        },
      };
    }
    return { kind: "ALLOWED", profile, snapshot: { ...snapshot, path: "PRESCRIPTION" } };
  }

  recordDispensationAuthorization(input: {
    scope: SyncScope;
    sessionId: string;
    operatorUserId: string;
    saleId: string;
    productId: string;
    presentationId: string;
    prescriptionId: string | null;
    dispensationCategory: string;
    snapshot: Record<string, unknown>;
    status: "AUTHORIZED" | "BLOCKED_RECORD";
  }): void {
    const nowIso = this.now().toISOString();
    this.database.native.prepare(
      `INSERT INTO pharmacy_dispensation(
        tenant_id,company_id,branch_id,id,sale_id,product_id,presentation_id,prescription_id,
        dispensation_category,eligibility_snapshot_json,status,actor_id,session_id,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      input.scope.tenantId, input.scope.companyId, input.scope.branchId, uuidV7(),
      input.saleId, input.productId, input.presentationId, input.prescriptionId,
      input.dispensationCategory, canonicalJson(input.snapshot), input.status,
      input.operatorUserId, input.sessionId, nowIso,
    );
  }

  revalidateSaleEligibility(scope: SyncScope, saleId: string):
    | { kind: "OK" }
    | { kind: "DENIED"; reason: PharmacyEligibilityDenial } {
    const hold = this.database.native.prepare(
      `SELECT 1 AS ok FROM pharmacy_dispensation
       WHERE tenant_id=? AND branch_id=? AND sale_id=? AND status='BLOCKED_RECORD'
         AND json_extract(eligibility_snapshot_json, '$.reconciliation_pending') = 1
       LIMIT 1`,
    ).get(scope.tenantId, scope.branchId, saleId) as { ok: number } | undefined;
    if (hold) return { kind: "DENIED", reason: "PHARMACY_RECONCILIATION_HOLD" };

    const rows = this.database.native.prepare(
      `SELECT product_id, presentation_id, prescription_id, dispensation_category, eligibility_snapshot_json
       FROM pharmacy_dispensation
       WHERE tenant_id=? AND branch_id=? AND sale_id=? AND status='AUTHORIZED'`,
    ).all(scope.tenantId, scope.branchId, saleId) as Array<{
      product_id: string;
      presentation_id: string;
      prescription_id: string | null;
      dispensation_category: string;
      eligibility_snapshot_json: string;
    }>;
    if (rows.length === 0) return { kind: "OK" };
    const items = this.database.native.prepare(
      `SELECT product_id, presentation_id, quantity FROM sales_sale_items
       WHERE tenant_id=? AND sale_id=?`,
    ).all(scope.tenantId, saleId) as Array<{
      product_id: string; presentation_id: string; quantity: string;
    }>;
    for (const row of rows) {
      const line = items.find((item) =>
        item.product_id === row.product_id && item.presentation_id === row.presentation_id);
      if (!line) return { kind: "DENIED", reason: "PHARMACY_PRESCRIPTION_INVALID" };
      const snap = JSON.parse(row.eligibility_snapshot_json) as {
        professional_competence_code?: string | null;
      };
      const evaluated = this.evaluateLineEligibility({
        scope,
        productId: row.product_id,
        quantity: line.quantity,
        prescriptionId: row.prescription_id,
        professionalCompetenceCode: snap.professional_competence_code ?? null,
      });
      if (evaluated.kind === "DENIED") return { kind: "DENIED", reason: evaluated.reason };
    }

    const today = this.now().toISOString().slice(0, 10);
    const reservedLots = this.database.native.prepare(
      `SELECT l.id, l.status, l.expiry_date
       FROM inventory_reservation r
       JOIN inventory_reservation_lot rl
         ON rl.tenant_id=r.tenant_id AND rl.company_id=r.company_id
        AND rl.branch_id=r.branch_id AND rl.reservation_id=r.id
       JOIN inventory_lot l
         ON l.tenant_id=rl.tenant_id AND l.company_id=rl.company_id
        AND l.branch_id=rl.branch_id AND l.id=rl.lot_id
       WHERE r.tenant_id=? AND r.company_id=? AND r.branch_id=?
         AND r.reference_type='SALE' AND r.reference_id=?
         AND r.status IN ('ACTIVE','PARTIALLY_CONSUMED')`,
    ).all(scope.tenantId, scope.companyId, scope.branchId, saleId) as Array<{
      id: string; status: string; expiry_date: string | null;
    }>;
    for (const lot of reservedLots) {
      if (lot.status !== "AVAILABLE") {
        return { kind: "DENIED", reason: "PHARMACY_LOT_INELIGIBLE" };
      }
      if (lot.expiry_date !== null && lot.expiry_date < today) {
        return { kind: "DENIED", reason: "PHARMACY_LOT_INELIGIBLE" };
      }
    }
    return { kind: "OK" };
  }

  recordPaymentReconciliationPending(input: {
    scope: SyncScope;
    sessionId: string;
    operatorUserId: string;
    saleId: string;
    reason: string;
    evidenceNote: string;
    correlationId: string;
    causationId: string | null;
  }): void {
    const nowIso = this.now().toISOString();
    const existingHold = this.database.native.prepare(
      `SELECT 1 AS ok FROM pharmacy_dispensation
       WHERE tenant_id=? AND branch_id=? AND sale_id=? AND status='BLOCKED_RECORD'
         AND json_extract(eligibility_snapshot_json, '$.reconciliation_pending') = 1
       LIMIT 1`,
    ).get(input.scope.tenantId, input.scope.branchId, input.saleId) as { ok: number } | undefined;
    if (existingHold) return;

    const authorized = this.database.native.prepare(
      `SELECT product_id, presentation_id, prescription_id, dispensation_category
       FROM pharmacy_dispensation
       WHERE tenant_id=? AND branch_id=? AND sale_id=? AND status='AUTHORIZED'`,
    ).all(input.scope.tenantId, input.scope.branchId, input.saleId) as Array<{
      product_id: string;
      presentation_id: string;
      prescription_id: string | null;
      dispensation_category: string;
    }>;
    for (const row of authorized) {
      this.recordDispensationAuthorization({
        scope: input.scope,
        sessionId: input.sessionId,
        operatorUserId: input.operatorUserId,
        saleId: input.saleId,
        productId: row.product_id,
        presentationId: row.presentation_id,
        prescriptionId: row.prescription_id,
        dispensationCategory: row.dispensation_category,
        snapshot: {
          reconciliation_pending: 1,
          reason: input.reason,
          evidence_note: input.evidenceNote,
          bank_reversal_claimed: false,
        },
        status: "BLOCKED_RECORD",
      });
    }
    this.writeAudit(
      input.scope, input.sessionId, input.operatorUserId,
      "PHARMACY_PAYMENT_RECONCILIATION_PENDING", "SALE", input.saleId,
      input.correlationId, input.causationId,
      {
        reason: input.reason,
        evidence_note: input.evidenceNote,
        bank_reversal_claimed: false,
      },
      nowIso,
    );
  }

  registerTechnicalReceipt(input: {
    scope: SyncScope;
    sessionId: string;
    operatorUserId: string;
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
    requestChecksum: string;
    correlationId: string;
    causationId: string | null;
  }):
    | { kind: "RECORDED"; receiptId: string }
    | { kind: "IDEMPOTENT"; receiptId: string }
    | { kind: "IDEMPOTENCY_CONFLICT" }
    | { kind: "INVALID_QUANTITY" } {
    if (!/^(0|[1-9]\d{0,12})\.\d{6}$/.test(input.quantity) || scale6ToBigInt(input.quantity) <= 0n) {
      return { kind: "INVALID_QUANTITY" };
    }
    return this.database.native.transaction(() => {
      const nowIso = this.now().toISOString();
      const prior = this.database.native.prepare(
        `SELECT id, request_checksum FROM pharmacy_technical_receipt
         WHERE tenant_id=? AND idempotency_key=?`,
      ).get(input.scope.tenantId, input.idempotencyKey) as
        { id: string; request_checksum: string } | undefined;
      if (prior) {
        return prior.request_checksum === input.requestChecksum
          ? { kind: "IDEMPOTENT" as const, receiptId: prior.id }
          : { kind: "IDEMPOTENCY_CONFLICT" as const };
      }
      const id = uuidV7();
      this.database.native.prepare(
        `INSERT INTO pharmacy_technical_receipt(
          tenant_id,company_id,branch_id,id,presentation_id,lot_id,sanitary_registration,batch_code,
          expiry_date,quantity,storage_condition,inspection_result,inspector_actor_id,observations,
          inventory_movement_id,actor_id,session_id,idempotency_key,request_checksum,correlation_id,
          causation_id,occurred_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        input.scope.tenantId, input.scope.companyId, input.scope.branchId, id, input.presentationId,
        input.lotId, input.sanitaryRegistration, input.batchCode, input.expiryDate, input.quantity,
        input.storageCondition, input.inspectionResult, input.operatorUserId, input.observations,
        input.inventoryMovementId, input.operatorUserId, input.sessionId, input.idempotencyKey,
        input.requestChecksum, input.correlationId, input.causationId, nowIso,
      );
      this.writeAudit(input.scope, input.sessionId, input.operatorUserId, "PHARMACY_TECHNICAL_RECEIPT",
        "PHARMACY_TECHNICAL_RECEIPT", id, input.correlationId, input.causationId,
        { inspection_result: input.inspectionResult, batch_code: input.batchCode }, nowIso);
      return { kind: "RECORDED" as const, receiptId: id };
    })();
  }

  registerSanitaryAlert(input: {
    scope: SyncScope;
    sessionId: string;
    operatorUserId: string;
    sourceKind: "MANUAL_AUTHORIZED" | "EXTERNAL_IMPORT";
    sourceReference: string;
    productId: string | null;
    lotId: string | null;
    actionCode: "QUARANTINE" | "RECALL";
    evidenceNote: string;
    idempotencyKey: string;
    requestChecksum: string;
    correlationId: string;
    causationId: string | null;
  }):
    | { kind: "RECORDED"; alertId: string }
    | { kind: "IDEMPOTENT"; alertId: string }
    | { kind: "IDEMPOTENCY_CONFLICT" }
    | { kind: "INVALID_CONFIGURATION" } {
    if (input.productId === null && input.lotId === null) return { kind: "INVALID_CONFIGURATION" };
    return this.database.native.transaction(() => {
      const nowIso = this.now().toISOString();
      const prior = this.database.native.prepare(
        `SELECT id, request_checksum FROM pharmacy_sanitary_alert
         WHERE tenant_id=? AND idempotency_key=?`,
      ).get(input.scope.tenantId, input.idempotencyKey) as
        { id: string; request_checksum: string } | undefined;
      if (prior) {
        return prior.request_checksum === input.requestChecksum
          ? { kind: "IDEMPOTENT" as const, alertId: prior.id }
          : { kind: "IDEMPOTENCY_CONFLICT" as const };
      }
      const id = uuidV7();
      this.database.native.prepare(
        `INSERT INTO pharmacy_sanitary_alert(
          tenant_id,company_id,branch_id,id,source_kind,source_reference,product_id,lot_id,action_code,
          evidence_note,actor_id,session_id,idempotency_key,request_checksum,correlation_id,causation_id,created_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        input.scope.tenantId, input.scope.companyId, input.scope.branchId, id, input.sourceKind,
        input.sourceReference, input.productId, input.lotId, input.actionCode, input.evidenceNote,
        input.operatorUserId, input.sessionId, input.idempotencyKey, input.requestChecksum,
        input.correlationId, input.causationId, nowIso,
      );
      this.writeAudit(input.scope, input.sessionId, input.operatorUserId, "PHARMACY_SANITARY_ALERT",
        "PHARMACY_SANITARY_ALERT", id, input.correlationId, input.causationId,
        {
          source_kind: input.sourceKind,
          action_code: input.actionCode,
          official_sync_claimed: false,
        }, nowIso);
      return { kind: "RECORDED" as const, alertId: id };
    })();
  }

  private loadActivePrescription(
    scope: SyncScope,
    prescriptionId: string,
    productId: string,
    atDate: string,
  ): { id: string; prescribed_quantity: string } | null {
    const row = this.database.native.prepare(
      `SELECT id, prescribed_quantity, expires_at, status, product_id
       FROM pharmacy_prescription
       WHERE tenant_id=? AND company_id=? AND branch_id=? AND id=?`,
    ).get(scope.tenantId, scope.companyId, scope.branchId, prescriptionId) as {
      id: string; prescribed_quantity: string; expires_at: string; status: string; product_id: string;
    } | undefined;
    if (!row || row.product_id !== productId || row.status !== "ACTIVE") return null;
    if (row.expires_at.slice(0, 10) < atDate) return null;
    return { id: row.id, prescribed_quantity: row.prescribed_quantity };
  }

  private recordOperation(
    idempotencyKey: string,
    requestChecksum: string,
    resultCode: string,
    nowIso: string,
  ): void {
    this.database.native.prepare(
      `INSERT INTO runtime_operations(
        operation_id, idempotency_key, payload_checksum, status, result_code, created_at, updated_at)
       VALUES (?,?,?,'SUCCEEDED',?,?,?)`,
    ).run(uuidV7(), idempotencyKey, requestChecksum, resultCode, nowIso, nowIso);
  }

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

  private enqueueOutbox(
    scope: SyncScope,
    sessionId: string,
    actorId: string,
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
      aggregate_type: "PHARMACY",
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
}
