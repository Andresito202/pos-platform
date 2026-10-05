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
export type OnboardingStatus = "READY_FOR_LICENSE" | "READY_FOR_ACTIVATION" | "COMPLETED";
export type OnboardingResult = { onboardingId: string; tenantId: string; companyId: string; branchId: string; ownerUserId: string; tenantMembershipId: string; status: OnboardingStatus; reasonCode: string | null; licenseReference: string | null; requestedPlan: string | null; correlationId: string; idempotencyKey: string; createdAt: string; updatedAt: string };
export type OnboardingRecord = OnboardingResult & { requestChecksum: string; actor: OnboardingActor };

export type OnboardingRepository = { transaction<T>(work: (tx: OnboardingTransaction) => Promise<T>): Promise<T> };
export type OnboardingTransaction = {
  findOnboarding(actor: OnboardingActor, idempotencyKey: string): Promise<OnboardingRecord | null>;
  assertCommercialReferenceAvailable(reference: string | undefined): Promise<void>;
  resolveOrCreateOwner(input: { userId?: string; email: string; phone?: string; fullName: string }): Promise<{ userId: string; created: boolean }>;
  createOnboarding(input: { id: string; actor: OnboardingActor; idempotencyKey: string; requestChecksum: string; correlationId: string }): Promise<void>;
  createTenant(input: { id: string; name: string; code?: string }): Promise<void>;
  createCompany(input: { id: string; tenantId: string; name: string; legalName?: string; taxId?: string; email?: string; phone?: string; timezone: string; currency: string }): Promise<void>;
  createBranch(input: { id: string; tenantId: string; companyId: string; name: string; code?: string; address?: string; city?: string; timezone: string }): Promise<void>;
  createOwnerMembership(input: { id: string; tenantId: string; userId: string; actor: OnboardingActor }): Promise<void>;
  assignInitialOwnerRole(input: { id: string; tenantId: string; membershipId: string; companyId: string; branchId: string; actor: OnboardingActor }): Promise<void>;
  applyInitialConfiguration(input: { tenantId: string; locale: string; timezone: string; currency: string; taxProfile?: unknown; configuration: Record<string, unknown> }): Promise<void>;
  completeOnboarding(input: { onboardingId: string; tenantId: string; companyId: string; branchId: string; ownerUserId: string; membershipId: string; status: OnboardingStatus; licenseReference?: string; requestedPlan?: string; correlationId: string }): Promise<OnboardingResult>;
  audit(input: { onboardingId: string; tenantId: string; actor: OnboardingActor; actionCode: string; resourceType: string; resourceId?: string; operationId?: string; correlationId: string; result: string; reasonCode?: string; newValue?: unknown }): Promise<void>;
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
    const requestChecksum = await checksum(input);
    return this.repository.transaction(async (tx) => {
      const existing = await tx.findOnboarding(input.actor, input.idempotencyKey);
      if (existing) {
        const decision = classifyIdempotency({ operation_id: existing.onboardingId, idempotency_key: existing.idempotencyKey, payload_checksum: existing.requestChecksum }, { operation_id: existing.onboardingId, idempotency_key: input.idempotencyKey, payload_checksum: requestChecksum });
        if (decision === "REPLAY") return existing;
        throw new Error("ONBOARDING_IDEMPOTENCY_CONFLICT");
      }
      await tx.assertCommercialReferenceAvailable(input.commercialReference);
      const ids = [uuidV7(this.now().getTime()), uuidV7(this.now().getTime()), uuidV7(this.now().getTime()), uuidV7(this.now().getTime()), uuidV7(this.now().getTime()), uuidV7(this.now().getTime())];
      const onboardingId = ids[0]!, tenantId = ids[1]!, companyId = ids[2]!, branchId = ids[3]!, membershipId = ids[4]!, roleAssignmentId = ids[5]!;
      await tx.createOnboarding({ id: onboardingId, actor: input.actor, idempotencyKey: input.idempotencyKey, requestChecksum, correlationId: input.correlationId });
      const owner = await tx.resolveOrCreateOwner({ userId: input.ownerUserId, email: input.ownerEmail, phone: input.ownerPhone, fullName: input.ownerFullName });
      await tx.createTenant({ id: tenantId, name: input.tenantName, code: input.tenantCode });
      await tx.createCompany({ id: companyId, tenantId, name: input.companyName, legalName: input.companyLegalName, taxId: input.companyTaxId, email: input.companyEmail, phone: input.companyPhone, timezone: input.initialTimezone, currency: input.initialCurrency });
      await tx.createBranch({ id: branchId, tenantId, companyId, name: input.branchName, code: input.branchCode, address: input.branchAddress, city: input.branchCity, timezone: input.initialTimezone });
      await tx.createOwnerMembership({ id: membershipId, tenantId, userId: owner.userId, actor: input.actor });
      await tx.assignInitialOwnerRole({ id: roleAssignmentId, tenantId, membershipId, companyId, branchId, actor: input.actor });
      await tx.applyInitialConfiguration({ tenantId, locale: input.initialLocale, timezone: input.initialTimezone, currency: input.initialCurrency, taxProfile: input.initialTaxProfile, configuration: input.initialConfiguration });
      const status: OnboardingStatus = input.licenseReference ? "READY_FOR_ACTIVATION" : "READY_FOR_LICENSE";
      const result = await tx.completeOnboarding({ onboardingId, tenantId, companyId, branchId, ownerUserId: owner.userId, membershipId, status, licenseReference: input.licenseReference, requestedPlan: input.requestedPlan, correlationId: input.correlationId });
      await tx.audit({ onboardingId, tenantId, actor: input.actor, actionCode: "ONBOARDING_COMPLETED", resourceType: "TENANT", resourceId: tenantId, correlationId: input.correlationId, result: "SUCCESS", newValue: { status, owner_created: owner.created } });
      return result;
    });
  }
}
