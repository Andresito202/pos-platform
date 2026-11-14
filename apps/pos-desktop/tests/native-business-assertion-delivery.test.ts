import {generateKeyPairSync,randomUUID,sign} from "node:crypto";
import {describe,it,expect,vi} from "vitest";
import {canonicalSessionTrustJson} from "@pos-platform/contracts";
import {activateNativeBusinessAssertion} from "../src/native-business-login.js";

// Protocol unit fixtures only. These responses do not prove authentication;
// the physical Central -> Electron -> Local Service test covers that boundary.
function assertion(){
  const claims={session_id:randomUUID(),user_id:randomUUID(),tenant_membership_id:randomUUID(),installation_id:randomUUID(),device_id:randomUUID(),
    sequence:1,key_id:"unit-signing",issued_at:new Date().toISOString(),offline_valid_until:new Date(Date.now()+30_000).toISOString()};
  return {claims,signature:sign(null,Buffer.from(canonicalSessionTrustJson(claims)),generateKeyPairSync("ed25519").privateKey).toString("base64url")};
}
function success(request:unknown,sequence=1){
  const r=request as {request_id:string;correlation_id:string};
  return {protocol_version:"1.0.0",request_id:r.request_id,correlation_id:r.correlation_id,operation_id:null,status:"SUCCEEDED",
    result_code:"ACTIVATED",result_schema_version:"1.0.0",server_time:new Date().toISOString(),error:null,
    result:{outcome:"ACTIVATED",sequence,current_sequence:null,decision:null}};
}
describe("native SSA delivery response boundary",()=>{
  it("rejects an identifier in place of an assertion before invoking the channel",async()=>{
    const channel={request:vi.fn(),close:vi.fn()};
    await expect(activateNativeBusinessAssertion(randomUUID(),channel)).rejects.toThrow();
    expect(channel.request).not.toHaveBeenCalled();
  });
  it("rejects an activation response for another request",async()=>{
    const channel={request:vi.fn(async request=>({...success(request),request_id:randomUUID()})),close:vi.fn()};
    await expect(activateNativeBusinessAssertion(assertion(),channel)).rejects.toThrow("CORRELATION_REJECTED");
  });
  it("does not report activation for a different sequence",async()=>{
    const channel={request:vi.fn(async request=>success(request,2)),close:vi.fn()};
    expect(await activateNativeBusinessAssertion(assertion(),channel)).toBe("REJECTED");
  });
  it("propagates a channel failure without manufacturing activation",async()=>{
    const channel={request:vi.fn().mockRejectedValue(Error("CHANNEL_CLOSED")),close:vi.fn()};
    await expect(activateNativeBusinessAssertion(assertion(),channel)).rejects.toThrow("CHANNEL_CLOSED");
  });
});
