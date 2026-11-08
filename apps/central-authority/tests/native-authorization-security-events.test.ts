import { describe, expect, it } from "vitest";
import { PlatformSecurityEventCode, PlatformSecurityEventWriteSchema, uuidV7 } from "@pos-platform/contracts";

const actor={user_id:uuidV7(),session_id:uuidV7(),tenant_id:uuidV7(),correlation_id:uuidV7(),occurred_at:new Date().toISOString()};
describe("canonical native authorization audit events",()=>{
  it.each([
    ["AUTHORIZATION_CODE_ISSUED","SUCCEEDED"],
    ["AUTHORIZATION_CODE_REDEEMED","SUCCEEDED"],
    ["AUTHORIZATION_CODE_REJECTED","REJECTED"],
    ["ACCESS_ISSUED","SUCCEEDED"],
  ] as const)("accepts %s with result %s", (event,result)=>{
    expect(PlatformSecurityEventWriteSchema.parse({
      ...actor,event_code:PlatformSecurityEventCode[event],result,reason_code:"CANONICAL_SECURITY_EVENT",
    }).event_code).toBe(PlatformSecurityEventCode[event]);
  });
  it("rejects unreviewed payloads such as raw authorization codes or tokens",()=>{
    expect(()=>PlatformSecurityEventWriteSchema.parse({
      ...actor,event_code:PlatformSecurityEventCode.AUTHORIZATION_CODE_ISSUED,
      result:"SUCCEEDED",reason_code:null,authorization_code:"plaintext-secret",
    })).toThrow();
  });
  it("requires a session for tenant-scoped native authorization audit",()=>{
    expect(()=>PlatformSecurityEventWriteSchema.parse({
      ...actor,session_id:null,event_code:PlatformSecurityEventCode.AUTHORIZATION_CODE_REDEEMED,
      result:"SUCCEEDED",reason_code:null,
    })).toThrow();
  });
});
