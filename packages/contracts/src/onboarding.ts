import type { UUID } from "./primitives.js";

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
export type OnboardingAuthorizer = { authorize(actor: OnboardingActor): Promise<void> };
