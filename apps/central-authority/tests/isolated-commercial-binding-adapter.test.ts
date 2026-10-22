import { beforeEach, describe, expect, it, vi } from "vitest";
import { BusinessAccessPreparation } from "../src/business-access-preparation.js";
import { createIsolatedCommercialBindingPrerequisite } from "../src/isolated-commercial-binding-adapter.js";

const mocks = vi.hoisted(() => ({ verifyAndConsume: vi.fn(), resolveCurrent: vi.fn(), audit: vi.fn() }));
vi.mock("@pos-platform/database-postgres", async importOriginal => {
  const original = await importOriginal<typeof import("@pos-platform/database-postgres")>();
  return {
    ...original,
    PostgresDeviceProofReplayVerifier: class {
      verifyAndConsume = mocks.verifyAndConsume;
    },
  };
});

const identity = {sessionId:"session-a",userId:"user",tenantId:"tenant-a",tenantMembershipId:"membership"};
const device = {deviceId:"device",installationId:"installation",tenantId:"tenant-a",companyId:"company",credentialId:"credential"};
const ref=Object.freeze({kind:"BUSINESS_ACCESS_PREPARATION"}), request = {
  body:JSON.stringify({session_id:"session-a"}),authorization:"signed-only-by-real-verifier",
  requestId:"fixture-request",correlationId:"fixture-correlation",
};
function make() {
  const prep=Object.create(BusinessAccessPreparation.prototype) as BusinessAccessPreparation;
  prep.resolveCurrent=mocks.resolveCurrent;
  return createIsolatedCommercialBindingPrerequisite(
    prep, {} as never, {authorityReference:"trusted-audit",record:mocks.audit});
}
describe("isolated binding adapter — exact session selector and replay-owner delegation",()=>{
  beforeEach(()=>{
    vi.resetAllMocks();
    mocks.resolveCurrent.mockResolvedValue({...identity,authenticatedAt:"2026-10-22T00:00:00Z",expiresAt:"2026-10-22T01:00:00Z"});
    mocks.verifyAndConsume.mockResolvedValue(device);
    mocks.audit.mockResolvedValue(undefined);
  });
  it("joins the existing current BUSINESS session and verified device owner",async()=>{
    const result=await make().establish(ref,request);
    expect(result).toEqual({identity,device});
    expect(mocks.resolveCurrent).toHaveBeenCalledTimes(2);
    expect(mocks.verifyAndConsume).toHaveBeenCalledOnce();
    expect(mocks.audit).toHaveBeenCalledOnce();
  });
  it("rejects a signed selector for another session before consuming nonce",async()=>{
    expect(await make().establish(ref,{...request,body:JSON.stringify({session_id:"session-b"})})).toBeNull();
    expect(mocks.verifyAndConsume).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("rejects tampered body shape before verifying device",async()=>{
    expect(await make().establish(ref,{...request,body:'{"session_id":"session-a","admin":true}'})).toBeNull();
    expect(mocks.verifyAndConsume).not.toHaveBeenCalled();
  });
  it("fails closed if session is revoked during device proof verification",async()=>{
    mocks.resolveCurrent.mockResolvedValueOnce(identity).mockResolvedValueOnce(null);
    expect(await make().establish(ref,request)).toBeNull();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("rejects cross-tenant verified device even if signature succeeded",async()=>{
    mocks.verifyAndConsume.mockResolvedValueOnce({...device,tenantId:"tenant-b"});
    expect(await make().establish(ref,request)).toBeNull();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("rejects replay when the canonical verifier declines it",async()=>{
    mocks.verifyAndConsume.mockResolvedValueOnce(null);
    expect(await make().establish(ref,request)).toBeNull();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("propagates failure of the required audit persistence",async()=>{
    mocks.audit.mockRejectedValueOnce(new Error("AUDIT_DOWN"));
    await expect(make().establish(ref,request)).rejects.toThrow("AUDIT_DOWN");
  });
});
