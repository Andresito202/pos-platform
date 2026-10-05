import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InitializeTenant, type OnboardingInput, type OnboardingTransaction } from "../src/onboarding/initialize-tenant.js";

function input(): OnboardingInput { return {
  actor: { type: "PLATFORM_ACCOUNT", id: "01890f5a-0000-7000-8000-000000000001" }, tenantName: "Tenant A", tenantCode: "TEN-A", commercialReference: "COMM-A",
  companyName: "Company A", branchName: "Branch A", ownerEmail: "owner@example.com", ownerFullName: "Owner A",
  initialLocale: "es-CO", initialTimezone: "America/Bogota", initialCurrency: "COP", initialConfiguration: { printer: "default" },
  idempotencyKey: "onb-001", correlationId: "01890f5a-0000-7000-8000-000000000002",
}; }

function checksum(value: unknown): string { if (value === null || typeof value !== "object") return JSON.stringify(value) as string; if (Array.isArray(value)) return "[" + value.map(checksum).join(",") + "]"; const object = value as Record<string, unknown>; return "{" + Object.keys(object).sort().map((key) => JSON.stringify(key) + ":" + checksum(object[key])).join(",") + "}"; }
function requestChecksum(value: OnboardingInput): string { return createHash("sha256").update(checksum(value)).digest("hex"); }

function tx(): OnboardingTransaction {
  return {
    setActorContext: async () => undefined, setTenantContext: async () => undefined,
    findOnboarding: async () => null, assertCommercialReferenceAvailable: async () => undefined,
    resolveOrCreateOwner: async () => ({ userId: "01890f5a-0000-7000-8000-000000000003", created: false }),
    createOnboarding: async () => undefined, createTenant: async () => undefined, createCompany: async () => undefined,
    createBranch: async () => undefined, createOwnerMembership: async () => undefined, assignInitialOwnerRole: async () => undefined,
    applyInitialConfiguration: async () => undefined,
    completeOnboarding: async (v) => ({ onboardingId: v.onboardingId, tenantId: v.tenantId, companyId: v.companyId, branchId: v.branchId, ownerUserId: v.ownerUserId, tenantMembershipId: v.membershipId, status: v.status, reasonCode: null, licenseReference: v.licenseReference ?? null, requestedPlan: v.requestedPlan ?? null, correlationId: v.correlationId, idempotencyKey: "onb-001", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }),
    audit: async () => undefined, recordSyncOperation: async () => undefined, recordOutbox: async () => undefined,
  };
}

describe("InitializeTenant", () => {
  it("authorizes the actor before opening the transaction", async () => {
    let opened = false;
    let authorized = false;
    const authorizer = { authorize: async () => { authorized = true; } };
    const repository = { transaction: async () => { opened = true; throw new Error("TRANSACTION_SHOULD_NOT_OPEN"); } };
    await expect(new InitializeTenant(repository, authorizer).execute(input())).rejects.toThrow("TRANSACTION_SHOULD_NOT_OPEN");
    expect(authorized).toBe(true);
    expect(opened).toBe(true);
  });

  it("rejects unauthorized actors before opening the transaction", async () => {
    let opened = false;
    const authorizer = { authorize: async () => { throw new Error("ONBOARDING_ACTOR_UNAUTHORIZED"); } };
    const repository = { transaction: async () => { opened = true; throw new Error("TRANSACTION_SHOULD_NOT_OPEN"); } };
    await expect(new InitializeTenant(repository, authorizer).execute(input())).rejects.toThrow("ONBOARDING_ACTOR_UNAUTHORIZED");
    expect(opened).toBe(false);
  });

  it("creates the complete minimum onboarding chain in one repository transaction", async () => {
    const calls: string[] = []; const base = tx();
    const tracked = Object.fromEntries(Object.entries(base).map(([key, value]) => [key, async (...args: unknown[]) => { calls.push(key); return (value as (...x: unknown[]) => unknown)(...args); }])) as unknown as OnboardingTransaction;
    const result = await new InitializeTenant({ transaction: async (work) => work(tracked) }, { authorize: async () => undefined }).execute(input());
    expect(result.status).toBe("READY_FOR_LICENSE");
    expect(calls).toEqual(["setActorContext", "findOnboarding", "assertCommercialReferenceAvailable", "createOnboarding", "setTenantContext", "resolveOrCreateOwner", "createTenant", "audit", "createCompany", "audit", "createBranch", "audit", "createOwnerMembership", "audit", "assignInitialOwnerRole", "audit", "applyInitialConfiguration", "audit", "recordSyncOperation", "recordOutbox", "completeOnboarding", "audit"]);
  });

  it("returns the existing result for an exact idempotent replay", async () => {
    const existing = { onboardingId: "01890f5a-0000-7000-8000-000000000010", tenantId: "01890f5a-0000-7000-8000-000000000011", companyId: "01890f5a-0000-7000-8000-000000000012", branchId: "01890f5a-0000-7000-8000-000000000013", ownerUserId: "01890f5a-0000-7000-8000-000000000014", tenantMembershipId: "01890f5a-0000-7000-8000-000000000015", status: "READY_FOR_LICENSE" as const, reasonCode: null, licenseReference: null, requestedPlan: null, correlationId: input().correlationId, idempotencyKey: input().idempotencyKey, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", requestChecksum: requestChecksum(input()), actor: input().actor };
    const replayTx = tx(); replayTx.findOnboarding = async () => existing;
    const result = await new InitializeTenant({ transaction: async (work) => work(replayTx) }, { authorize: async () => undefined }).execute(input());
    expect(result).toBe(existing);
  });

  it("rejects the same idempotency key with a different request", async () => {
    const existing = { onboardingId: "01890f5a-0000-7000-8000-000000000020", tenantId: "01890f5a-0000-7000-8000-000000000021", companyId: "01890f5a-0000-7000-8000-000000000022", branchId: "01890f5a-0000-7000-8000-000000000023", ownerUserId: "01890f5a-0000-7000-8000-000000000024", tenantMembershipId: "01890f5a-0000-7000-8000-000000000025", status: "READY_FOR_LICENSE" as const, reasonCode: null, licenseReference: null, requestedPlan: null, correlationId: input().correlationId, idempotencyKey: input().idempotencyKey, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", requestChecksum: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", actor: input().actor };
    const conflictTx = tx(); conflictTx.findOnboarding = async () => existing;
    await expect(new InitializeTenant({ transaction: async (work) => work(conflictTx) }, { authorize: async () => undefined }).execute({ ...input(), companyName: "Different Company" })).rejects.toThrow("ONBOARDING_IDEMPOTENCY_CONFLICT");
  });

  it("does not continue when validation fails", async () => {
    let opened = false;
    await expect(new InitializeTenant({ transaction: async (work) => { opened = true; return work(tx()); } }, { authorize: async () => undefined }).execute({ ...input(), initialCurrency: "CO" })).rejects.toThrow("ONBOARDING_CURRENCY_INVALID");
    expect(opened).toBe(false);
  });
});
