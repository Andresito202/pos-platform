import { classifyIdempotency, uuidV7 } from "@pos-platform/contracts";

export type OnboardingActor = { type: "USER" | "PLATFORM_ACCOUNT"; id: string };
export type OnboardingInput = {
  actor: OnboardingActor; tenantName: string; tenantCode?: string; commercialReference?: string;
  companyName: string; companyLegalName?: string; companyTaxId?: string; companyEmail?: string; companyPhone?: string;
  branchName: string; branchCode?: string; branchAddress?: string; branchCity?: string;
  ownerUserId?: string; ownerEmail: string; ownerPhone?: string; ownerFullName: string;
  initialLocale: string; initialTimezone: string; initialCurrency: string; initialTaxProfile?: unknown;
  initialConfiguration: Record<string, unknown>; licenseReference?: string; requestedPlan?: string;
  idempotencyKey: string; correlationId: string;
};
export type OnboardingStatus = "READY_FOR_LICENSE";
export type OnboardingResult = { onboardingId: string; tenantId: string; companyId: string; branchId: string; ownerUserId: string; tenantMembershipId: string; status: OnboardingStatus; reasonCode: string | null; licenseReference: string | null; requestedPlan: string | null; correlationId: string; idempotencyKey: string; createdAt: string; updatedAt: string };
export type OnboardingRecord = OnboardingResult & { requestChecksum: string; actor: OnboardingActor };

export type OnboardingRepository = { transaction<T>(work: (tx: OnboardingTransaction) => Promise<T>): Promise<T> };
export type OnboardingTransaction = {
  setActorContext(actor: OnboardingActor): Promise<void>;
  setTenantContext(tenantId: string): Promise<void>;
  findOnboarding(actor: OnboardingActor, idempotencyKey: string): Promise<OnboardingRecord | null>;
  resolveOrCreateOwner(input: { userId?: string; email: string; phone?: string; fullName: string }): Promise<{ userId: string; created: boolean }>;
  createOnboarding(input: { id: string; actor: OnboardingActor; idempotencyKey: string; requestChecksum: string; correlationId: string; commercialReference?: string }): Promise<{ claimed: boolean }>;
  createTenant(input: { id: string; name: string; code?: string }): Promise<void>;
  createCompany(input: { id: string; tenantId: string; name: string; legalName?: string; taxId?: string; email?: string; phone?: string; timezone: string; currency: string }): Promise<void>;
  createBranch(input: { id: string; tenantId: string; companyId: string; name: string; code?: string; address?: string; city?: string; timezone: string }): Promise<void>;
  createOwnerMembership(input: { id: string; tenantId: string; userId: string; actor: OnboardingActor; isPrimary: boolean }): Promise<void>;
  assignInitialOwnerRole(input: { id: string; tenantId: string; membershipId: string; companyId: string; branchId: string; actor: OnboardingActor }): Promise<void>;
  applyInitialConfiguration(input: { onboardingId: string; tenantId: string; locale: string; timezone: string; currency: string; taxProfile?: unknown; configuration: Record<string, unknown> }): Promise<void>;
  completeOnboarding(input: { onboardingId: string; tenantId: string; companyId: string; branchId: string; ownerUserId: string; membershipId: string; status: OnboardingStatus; licenseReference?: string; requestedPlan?: string; correlationId: string }): Promise<OnboardingResult>;
  audit(input: { onboardingId: string; tenantId: string | null; companyId?: string | null; branchId?: string | null; actor: OnboardingActor; actionCode: string; resourceType: string; resourceId?: string; operationId?: string; correlationId: string; result: string; reasonCode?: string; newValue?: unknown }): Promise<void>;
  recordSyncOperation(input: { operationId: string; tenantId: string; companyId: string; branchId: string; actor: OnboardingActor; aggregateId: string; operationType: string; idempotencyKey: string; correlationId: string; payload: Record<string, unknown>; payloadChecksum: string }): Promise<void>;
  recordOutbox(input: { id: string; tenantId: string; operationId: string; operationType: string; correlationId: string; payloadChecksum: string }): Promise<void>;
};

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  const object = value as Record<string, unknown>;
  return "{" + Object.keys(object).sort().map((key) => JSON.stringify(key) + ":" + canonicalize(object[key])).join(",") + "}";
}
async function checksum(input: OnboardingInput): Promise<string> { const bytes = new TextEncoder().encode(canonicalize(input)); const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes); return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join(""); }
function validate(input: OnboardingInput): void {
  const required: Array<[string, string]> = [["tenantName", input.tenantName], ["companyName", input.companyName], ["branchName", input.branchName], ["ownerEmail", input.ownerEmail], ["ownerFullName", input.ownerFullName], ["initialLocale", input.initialLocale], ["initialTimezone", input.initialTimezone], ["initialCurrency", input.initialCurrency], ["idempotencyKey", input.idempotencyKey], ["correlationId", input.correlationId]];
  for (const pair of required) if (!pair[1].trim()) throw new Error("ONBOARDING_" + pair[0].toUpperCase() + "_REQUIRED");
  if (!/^[A-Z]{3}$/.test(input.initialCurrency)) throw new Error("ONBOARDING_CURRENCY_INVALID");
}

export type OnboardingAuthorizer = { authorize(actor: OnboardingActor): Promise<void> };

export class InitializeTenant {
  constructor(private readonly repository: OnboardingRepository, private readonly authorizer: OnboardingAuthorizer, private readonly now: () => Date = () => new Date()) {}
  async execute(input: OnboardingInput): Promise<OnboardingResult> {
    validate(input);
    await this.authorizer.authorize(input.actor);
    const requestChecksum = await checksum(input);
    return this.repository.transaction(async (tx) => {
      await tx.setActorContext(input.actor);
      const onboardingId = uuidV7(this.now().getTime());
      const claim = await tx.createOnboarding({
        id: onboardingId,
        actor: input.actor,
        idempotencyKey: input.idempotencyKey,
        requestChecksum,
        correlationId: input.correlationId,
        ...(input.commercialReference === undefined ? {} : { commercialReference: input.commercialReference }),
      });
      if (!claim.claimed) {
        const existing = await tx.findOnboarding(input.actor, input.idempotencyKey);
        if (!existing) throw new Error("ONBOARDING_IDEMPOTENCY_RESULT_MISSING");
        const decision = classifyIdempotency({ operation_id: existing.onboardingId, idempotency_key: existing.idempotencyKey, payload_checksum: existing.requestChecksum }, { operation_id: existing.onboardingId, idempotency_key: input.idempotencyKey, payload_checksum: requestChecksum });
        if (decision === "REPLAY") return existing;
        throw new Error("ONBOARDING_IDEMPOTENCY_CONFLICT");
      }
      const tenantId = uuidV7(this.now().getTime());
      const companyId = uuidV7(this.now().getTime());
      const branchId = uuidV7(this.now().getTime());
      const membershipId = uuidV7(this.now().getTime());
      const roleAssignmentId = uuidV7(this.now().getTime());
      await tx.setTenantContext(tenantId);
      const owner = await tx.resolveOrCreateOwner({
        email: input.ownerEmail,
        fullName: input.ownerFullName,
        ...(input.ownerUserId === undefined ? {} : { userId: input.ownerUserId }),
        ...(input.ownerPhone === undefined ? {} : { phone: input.ownerPhone }),
      });
      await tx.createTenant({
        id: tenantId,
        name: input.tenantName,
        ...(input.tenantCode === undefined ? {} : { code: input.tenantCode }),
      });
      await tx.audit({ onboardingId, tenantId, companyId: null, branchId: null, actor: input.actor, actionCode: "ONBOARDING_STARTED", resourceType: "ONBOARDING_OPERATION", resourceId: onboardingId, correlationId: input.correlationId, result: "SUCCEEDED", newValue: { status: "PENDING", idempotency_key: input.idempotencyKey } });
      await tx.audit({ onboardingId, tenantId, companyId: null, branchId: null, actor: input.actor, actionCode: "TENANT_CREATED", resourceType: "TENANT", resourceId: tenantId, correlationId: input.correlationId, result: "SUCCEEDED", newValue: { name: input.tenantName, status: "ACTIVE" } });
      await tx.createCompany({
        id: companyId,
        tenantId,
        name: input.companyName,
        timezone: input.initialTimezone,
        currency: input.initialCurrency,
        ...(input.companyLegalName === undefined ? {} : { legalName: input.companyLegalName }),
        ...(input.companyTaxId === undefined ? {} : { taxId: input.companyTaxId }),
        ...(input.companyEmail === undefined ? {} : { email: input.companyEmail }),
        ...(input.companyPhone === undefined ? {} : { phone: input.companyPhone }),
      });
      await tx.audit({ onboardingId, tenantId, companyId, branchId: null, actor: input.actor, actionCode: "COMPANY_CREATED", resourceType: "COMPANY", resourceId: companyId, correlationId: input.correlationId, result: "SUCCEEDED", newValue: { trade_name: input.companyName, currency_code: input.initialCurrency } });
      await tx.createBranch({
        id: branchId,
        tenantId,
        companyId,
        name: input.branchName,
        timezone: input.initialTimezone,
        ...(input.branchCode === undefined ? {} : { code: input.branchCode }),
        ...(input.branchAddress === undefined ? {} : { address: input.branchAddress }),
        ...(input.branchCity === undefined ? {} : { city: input.branchCity }),
      });
      await tx.audit({ onboardingId, tenantId, companyId, branchId, actor: input.actor, actionCode: "BRANCH_CREATED", resourceType: "BRANCH", resourceId: branchId, correlationId: input.correlationId, result: "SUCCEEDED", newValue: { name: input.branchName, timezone: input.initialTimezone } });
      await tx.createOwnerMembership({ id: membershipId, tenantId, userId: owner.userId, actor: input.actor, isPrimary: owner.created });
      await tx.audit({ onboardingId, tenantId, companyId: null, branchId: null, actor: input.actor, actionCode: "TENANT_OWNER_ASSIGNED", resourceType: "TENANT_MEMBERSHIP", resourceId: membershipId, correlationId: input.correlationId, result: "SUCCEEDED", newValue: { membership_type: "OWNER", owner_user_id: owner.userId, owner_created: owner.created } });
      await tx.assignInitialOwnerRole({ id: roleAssignmentId, tenantId, membershipId, companyId, branchId, actor: input.actor });
      await tx.audit({ onboardingId, tenantId, companyId, branchId: null, actor: input.actor, actionCode: "OWNER_ROLE_ASSIGNED", resourceType: "USER_ROLE_ASSIGNMENT", resourceId: roleAssignmentId, correlationId: input.correlationId, result: "SUCCEEDED" });
      await tx.applyInitialConfiguration({ onboardingId, tenantId, locale: input.initialLocale, timezone: input.initialTimezone, currency: input.initialCurrency, taxProfile: input.initialTaxProfile, configuration: input.initialConfiguration });
      const status: OnboardingStatus = "READY_FOR_LICENSE";
      const operationId = uuidV7(this.now().getTime());
      const payload = { onboarding_id: onboardingId, tenant_id: tenantId, company_id: companyId, branch_id: branchId, owner_user_id: owner.userId, status };
      const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
      const payloadDigest = await globalThis.crypto.subtle.digest("SHA-256", payloadBytes);
      const payloadChecksum = Array.from(new Uint8Array(payloadDigest), (value) => value.toString(16).padStart(2, "0")).join("");
      await tx.recordSyncOperation({ operationId, tenantId, companyId, branchId, actor: input.actor, aggregateId: tenantId, operationType: "TENANT_ONBOARDED", idempotencyKey: input.idempotencyKey, correlationId: input.correlationId, payload, payloadChecksum });
      await tx.recordOutbox({ id: uuidV7(this.now().getTime()), tenantId, operationId, operationType: "TENANT_ONBOARDED", correlationId: input.correlationId, payloadChecksum });
      const result = await tx.completeOnboarding({
        onboardingId,
        tenantId,
        companyId,
        branchId,
        ownerUserId: owner.userId,
        membershipId,
        status,
        correlationId: input.correlationId,
        ...(input.licenseReference === undefined ? {} : { licenseReference: input.licenseReference }),
        ...(input.requestedPlan === undefined ? {} : { requestedPlan: input.requestedPlan }),
      });
      await tx.audit({ onboardingId, tenantId, companyId, branchId, actor: input.actor, actionCode: "ONBOARDING_STATUS_CHANGED", resourceType: "ONBOARDING_OPERATION", resourceId: onboardingId, correlationId: input.correlationId, result: "SUCCEEDED", newValue: { previous_status: "PENDING", status } });
      return result;
    });
  }
}
