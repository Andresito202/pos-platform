import { describe, expect, it } from "vitest";
import { InitializeTenant } from "../src/onboarding/initialize-tenant.js";
import type { OnboardingInput, OnboardingTransaction } from "@pos-platform/contracts";

function input(): OnboardingInput {
  return {
    actor: { type: "PLATFORM_ACCOUNT", id: "01890f5a-0000-7000-8000-000000000001" },
    tenantName: "Tenant A", tenantCode: "TEN-A", commercialReference: "COMM-A",
    companyName: "Company A", branchName: "Branch A",
    ownerEmail: "owner@example.com", ownerFullName: "Owner A",
    initialLocale: "es-CO", initialTimezone: "America/Bogota", initialCurrency: "COP",
    initialConfiguration: { taxPolicyVersion: "tax-v1" },
    idempotencyKey: "onb-001", correlationId: "01890f5a-0000-7000-8000-000000000002",
  };
}

function tx(): OnboardingTransaction {
  return {
    setActorContext: async () => undefined,
    setTenantContext: async () => undefined,
    findOnboarding: async () => null,
    resolveOrCreateOwner: async () => ({ userId: "01890f5a-0000-7000-8000-000000000003", created: true }),
    createOnboarding: async () => ({ claimed: true }),
    createTenant: async () => undefined,
    createCompany: async () => undefined,
    createBranch: async () => undefined,
    createOwnerMembership: async () => undefined,
    assignInitialOwnerRole: async () => undefined,
    applyInitialConfiguration: async () => undefined,
    completeOnboarding: async (v) => ({
      onboardingId: v.onboardingId, tenantId: v.tenantId, companyId: v.companyId, branchId: v.branchId,
      ownerUserId: v.ownerUserId, tenantMembershipId: v.membershipId, status: "READY_FOR_LICENSE",
      reasonCode: null, licenseReference: null, requestedPlan: null, correlationId: v.correlationId,
      idempotencyKey: "onb-001", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
    }),
    audit: async () => undefined,
    recordSyncOperation: async () => undefined,
    recordOutbox: async () => undefined,
  };
}

describe("InitializeTenant", () => {
  it("authorizes before opening the transaction", async () => {
    const order: string[] = [];
    const authorizer = { authorize: async () => { order.push("authorize"); } };
    const repository = { transaction: async () => { order.push("transaction"); throw new Error("TRANSACTION_STOP"); } };
    await expect(new InitializeTenant(repository, authorizer).execute(input())).rejects.toThrow("TRANSACTION_STOP");
    expect(order).toEqual(["authorize", "transaction"]);
  });

  it("rejects unauthorized actors before opening the transaction", async () => {
    let opened = false;
    const authorizer = { authorize: async () => { throw new Error("ONBOARDING_ACTOR_UNAUTHORIZED"); } };
    const repository = { transaction: async () => { opened = true; throw new Error("TRANSACTION_SHOULD_NOT_OPEN"); } };
    await expect(new InitializeTenant(repository, authorizer).execute(input())).rejects.toThrow("ONBOARDING_ACTOR_UNAUTHORIZED");
    expect(opened).toBe(false);
  });

  it("keeps the full onboarding order and outbox inside one transaction", async () => {
    const calls: string[] = [];
    const base = tx();
    const tracked = Object.fromEntries(Object.entries(base).map(([key, value]) => [
      key,
      async (...args: unknown[]) => { calls.push(key); return (value as (...x: unknown[]) => unknown)(...args); },
    ])) as unknown as OnboardingTransaction;
    const result = await new InitializeTenant({ transaction: async (work) => work(tracked) }, { authorize: async () => undefined }).execute(input());
    expect(result.status).toBe("READY_FOR_LICENSE");
    expect(calls).toEqual([
      "setActorContext", "createOnboarding", "setTenantContext", "resolveOrCreateOwner",
      "createTenant", "audit", "audit", "createCompany", "audit", "createBranch", "audit",
      "createOwnerMembership", "audit", "assignInitialOwnerRole", "audit",
      "applyInitialConfiguration", "recordSyncOperation", "recordOutbox", "completeOnboarding", "audit",
    ]);
  });

  it("returns the existing result for an exact idempotent replay", async () => {
    const existing = {
      onboardingId: "01890f5a-0000-7000-8000-000000000010", tenantId: "01890f5a-0000-7000-8000-000000000011",
      companyId: "01890f5a-0000-7000-8000-000000000012", branchId: "01890f5a-0000-7000-8000-000000000013",
      ownerUserId: "01890f5a-0000-7000-8000-000000000014", tenantMembershipId: "01890f5a-0000-7000-8000-000000000015",
      status: "READY_FOR_LICENSE" as const, reasonCode: null, licenseReference: null, requestedPlan: null,
      correlationId: input().correlationId, idempotencyKey: input().idempotencyKey, createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z", requestChecksum: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", actor: input().actor,
    };
    const replayTx = tx();
    let replayChecksum = "";
    let persisted: typeof existing | undefined;
    replayTx.createOnboarding = async (record) => {
      replayChecksum = record.requestChecksum;
      persisted = { ...existing, requestChecksum: replayChecksum };
      return { claimed: false };
    };
    replayTx.findOnboarding = async () => persisted ?? null;
    const result = await new InitializeTenant({ transaction: async (work) => work(replayTx) }, { authorize: async () => undefined }).execute(input());
    expect(result).toBe(persisted);
    expect(persisted?.requestChecksum).toBe(replayChecksum);
  });

  it("rejects the same idempotency key with a different request", async () => {
    const existing = { ...(await Promise.resolve({
      onboardingId: "01890f5a-0000-7000-8000-000000000020", tenantId: "01890f5a-0000-7000-8000-000000000021",
      companyId: "01890f5a-0000-7000-8000-000000000022", branchId: "01890f5a-0000-7000-8000-000000000023",
      ownerUserId: "01890f5a-0000-7000-8000-000000000024", tenantMembershipId: "01890f5a-0000-7000-8000-000000000025",
      status: "READY_FOR_LICENSE" as const, reasonCode: null, licenseReference: null, requestedPlan: null,
      correlationId: input().correlationId, idempotencyKey: input().idempotencyKey, createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z", requestChecksum: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      actor: input().actor,
    })) };
    const conflictTx = tx();
    conflictTx.createOnboarding = async () => ({ claimed: false });
    conflictTx.findOnboarding = async () => existing;
    await expect(new InitializeTenant({ transaction: async (work) => work(conflictTx) }, { authorize: async () => undefined }).execute({ ...input(), companyName: "Different Company" })).rejects.toThrow("ONBOARDING_IDEMPOTENCY_CONFLICT");
  });

  it("does not continue when validation fails", async () => {
    let opened = false;
    await expect(new InitializeTenant({ transaction: async (work) => { opened = true; return work(tx()); } }, { authorize: async () => undefined }).execute({ ...input(), initialCurrency: "CO" })).rejects.toThrow("ONBOARDING_CURRENCY_INVALID");
    expect(opened).toBe(false);
  });
});