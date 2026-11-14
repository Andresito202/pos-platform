import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommercialBindingPrerequisite } from "../src/commercial-binding-prerequisite.js";

const identity = Object.freeze({sessionId:"session",userId:"user",tenantId:"tenant-A",tenantMembershipId:"member"});
const device = Object.freeze({deviceId:"device",installationId:"installation",tenantId:"tenant-A",companyId:"company",credentialId:"credential"});
const mocks=vi.hoisted(()=>({inspectSession:vi.fn(),inspectDevice:vi.fn(),audit:vi.fn()}));
const ref=Object.freeze({internal:"reference"}),proof=Object.freeze({signed:"fixture"});
function create(){
  return new CommercialBindingPrerequisite(
    {authorityReference:"canonical-session-inspector",inspect:mocks.inspectSession},
    {authorityReference:"canonical-verified-device-proof",inspect:mocks.inspectDevice},
    {authorityReference:"canonical-durable-security-audit",record:mocks.audit},
  );
}
describe("commercial binding prerequisites — fail closed, not a token issuer",()=>{
  beforeEach(()=>{
    vi.resetAllMocks();
    mocks.inspectSession.mockResolvedValue(identity);
    mocks.inspectDevice.mockResolvedValue(device);
    mocks.audit.mockResolvedValue(undefined);
  });
  it("requires all three trusted owner interfaces",()=>{
    expect(()=>new CommercialBindingPrerequisite(
      {authorityReference:"",inspect:mocks.inspectSession},
      {authorityReference:"device",inspect:mocks.inspectDevice},
      {authorityReference:"audit",record:mocks.audit})).toThrow("COMMERCIAL_TRUSTED_AUTHORITY_REQUIRED");
  });
  it("requires protected session reference and rejects a raw session UUID",async()=>{
    expect(await create().establish("session",proof)).toBeNull();
    expect(mocks.inspectSession).not.toHaveBeenCalled();
  });
  it("rejects an untrusted or revoked session before inspecting the device",async()=>{
    mocks.inspectSession.mockResolvedValueOnce(null);
    expect(await create().establish(ref,proof)).toBeNull();
    expect(mocks.inspectDevice).not.toHaveBeenCalled();
  });
  it("rejects absent device proof and cross-tenant device without auditing",async()=>{
    mocks.inspectDevice.mockResolvedValueOnce(null);
    expect(await create().establish(ref,proof)).toBeNull();
    mocks.inspectDevice.mockResolvedValueOnce({...device,tenantId:"tenant-B"});
    expect(await create().establish(ref,proof)).toBeNull();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("rejects incomplete binding identifiers",async()=>{
    mocks.inspectDevice.mockResolvedValueOnce({...device,credentialId:""});
    expect(await create().establish(ref,proof)).toBeNull();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("records confirmed binding before returning an internal prerequisite",async()=>{
    const result=await create().establish(ref,proof);
    expect(result).toEqual({identity,device});
    expect(Object.isFrozen(result)).toBe(true);
    expect(mocks.audit).toHaveBeenCalledOnce();
    expect(mocks.audit).toHaveBeenCalledWith(result);
    expect(Object.keys(result!)).toEqual(["identity","device"]);
  });
  it("propagates audit persistence failure and never returns a binding",async()=>{
    mocks.audit.mockRejectedValueOnce(new Error("SECURITY_AUDIT_UNAVAILABLE"));
    await expect(create().establish(ref,proof)).rejects.toThrow("SECURITY_AUDIT_UNAVAILABLE");
  });
});
