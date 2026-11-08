import { beforeEach, describe, expect, it, vi } from "vitest";
import { BusinessLoginCoordinator } from "../src/business-login-coordinator.js";

const mocks = vi.hoisted(() => ({
  begin: vi.fn(),
  complete: vi.fn(),
  open: vi.fn(),
  resolveCurrent: vi.fn(),
  close: vi.fn(),
  prepareSequence: vi.fn(),
  assertAllowed: vi.fn(),
  authorityCreated: vi.fn(),
}));

vi.mock("../src/business-initial-mfa-flow.js", () => ({
  BusinessInitialMfaFlow: class {
    begin = mocks.begin;
    complete = mocks.complete;
  },
}));

vi.mock("../src/business-session-authority.js", () => ({
  BusinessSessionAuthority: class {
    constructor(...args: unknown[]) {
      mocks.authorityCreated(...args);
    }
  },
}));

vi.mock("../src/business-access-preparation.js", () => ({
  BusinessAccessPreparation: class {
    open = mocks.open;
    resolveCurrent = mocks.resolveCurrent;
    close = mocks.close;
    prepareSequence = mocks.prepareSequence;
  },
}));

describe("BusinessLoginCoordinator — orchestration boundaries", () => {
  const pool = {} as ConstructorParameters<typeof BusinessLoginCoordinator>[0];
  const mfaPolicy = {} as ConstructorParameters<typeof BusinessLoginCoordinator>[1];
  const sessionPolicy = {} as ConstructorParameters<typeof BusinessLoginCoordinator>[2];
  const accessPolicy = {} as ConstructorParameters<typeof BusinessLoginCoordinator>[3];
  const attempts = {
    policyReference: "test-explicit-control",
    assertAllowed: mocks.assertAllowed,
  };
  const beginInput = {
    email: "fixture@example.test",
    password: "test-only-password",
    factorId: "factor-fixture",
    correlationId: "correlation-fixture",
  };
  const completion = {} as Parameters<BusinessLoginCoordinator["complete"]>[0];
  const selection = { tenantId: "tenant-fixture", membershipId: "membership-fixture" };
  const make = () => new BusinessLoginCoordinator(pool, mfaPolicy, sessionPolicy, accessPolicy, attempts);

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.assertAllowed.mockResolvedValue(undefined);
    mocks.begin.mockResolvedValue({ challenge: "fixture-challenge" });
    mocks.complete.mockResolvedValue({ kind: "BUSINESS_INITIAL_MFA_RECEIPT" });
    mocks.open.mockResolvedValue({ kind: "BUSINESS_ACCESS_PREPARATION" });
  });

  it("refuses a missing or empty trusted attempt control", () => {
    expect(() => new BusinessLoginCoordinator(pool, mfaPolicy, sessionPolicy, accessPolicy, undefined as never))
      .toThrow("BUSINESS_LOGIN_ATTEMPT_CONTROL_REQUIRED");
    expect(() => new BusinessLoginCoordinator(pool, mfaPolicy, sessionPolicy, accessPolicy, {
      policyReference: " ", assertAllowed: mocks.assertAllowed,
    })).toThrow("BUSINESS_LOGIN_ATTEMPT_CONTROL_REQUIRED");
    expect(mocks.authorityCreated).not.toHaveBeenCalled();
  });

  it("checks the attempt gate before beginning password and MFA", async () => {
    const login = make();
    const result = await login.begin(beginInput);
    expect(result).toEqual({ challenge: "fixture-challenge" });
    expect(mocks.assertAllowed).toHaveBeenCalledWith("PASSWORD_AND_MFA_BEGIN");
    expect(mocks.begin).toHaveBeenCalledWith(beginInput);
    expect(mocks.assertAllowed.mock.invocationCallOrder[0]).toBeLessThan(mocks.begin.mock.invocationCallOrder[0]!);
  });

  it("fails closed when the begin attempt gate rejects", async () => {
    const login = make();
    mocks.assertAllowed.mockRejectedValueOnce(new Error("DENIED"));
    await expect(login.begin(beginInput)).rejects.toThrow("DENIED");
    expect(mocks.begin).not.toHaveBeenCalled();
  });

  it("fails closed when the completion attempt gate rejects", async () => {
    const login = make();
    mocks.assertAllowed.mockRejectedValueOnce(new Error("DENIED"));
    await expect(login.complete(completion, selection)).rejects.toThrow("DENIED");
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it("does not create a BUSINESS session when MFA is rejected", async () => {
    const login = make();
    mocks.complete.mockResolvedValueOnce(null);
    await expect(login.complete(completion, selection)).resolves.toBeNull();
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it("passes only the internal MFA receipt and selected tenant into session creation", async () => {
    const login = make();
    const receipt = Object.freeze({ kind: "BUSINESS_INITIAL_MFA_RECEIPT" });
    mocks.complete.mockResolvedValueOnce(receipt);
    const result = await login.complete(completion, selection);
    expect(mocks.assertAllowed).toHaveBeenCalledWith("MFA_AND_SESSION_COMPLETE");
    expect(mocks.complete).toHaveBeenCalledWith(completion);
    expect(mocks.open).toHaveBeenCalledOnce();
    expect(mocks.open).toHaveBeenCalledWith({ mfaReceipt: receipt, selection });
    expect(result).toEqual({ kind: "BUSINESS_ACCESS_PREPARATION" });
  });

  it("never reports a session if durable creation rejects", async () => {
    const login = make();
    mocks.open.mockRejectedValueOnce(new Error("DATABASE_UNAVAILABLE"));
    await expect(login.complete(completion, selection)).rejects.toThrow("DATABASE_UNAVAILABLE");
  });

  it("delegates only to the existing trusted access preparation API", async () => {
    const login = make();
    const ref = Object.freeze({ kind: "BUSINESS_ACCESS_PREPARATION" });
    const request = {} as Parameters<BusinessLoginCoordinator["prepareSequence"]>[1];
    await login.resolveCurrent(ref);
    await login.close(ref, "correlation-fixture");
    await login.prepareSequence(ref, request);
    expect(mocks.resolveCurrent).toHaveBeenCalledWith(ref);
    expect(mocks.close).toHaveBeenCalledWith(ref, "correlation-fixture");
    expect(mocks.prepareSequence).toHaveBeenCalledWith(ref, request);
  });
});
