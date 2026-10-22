import { describe, expect, it, vi } from "vitest";
import type { Pool } from "@pos-platform/database-postgres";
import { IsolatedBusinessAuditSessionGuard } from "../src/isolated-business-audit-session-guard.js";
const id=(tail:string)=>"018f0000-0000-7000-8000-0000000000"+tail;
const binding={sessionId:id("a1"),userId:id("a2"),tenantId:id("a3"),tenantMembershipId:id("a4")};
function fixture(active=true) {
  const sql:string[]=[];
  const client={query:vi.fn(async(text:string)=>{
    sql.push(text);
    if(text.includes("current_database()")) return {rows:[{allowed:true}]};
    if(text.includes("tenant_id::text")) return {rows:[{tenant_id:binding.tenantId}]};
    if(text.includes("FOR UPDATE")) return {rows:active?[{one:1}]:[]};
    return {rows:[]};
  }),release:vi.fn()};
  const pool={options:{connectionString:"postgres://postgres@127.0.0.1:55433/pos_business_session_test_0123456789abcdef"},connect:vi.fn(async()=>client)} as unknown as Pool;
  return {guard:new IsolatedBusinessAuditSessionGuard(pool),client,sql};
}
describe("isolated audit guard — revocation serialization and atomic audit writer",()=>{
  it("refuses production database host",()=>{
    expect(()=>new IsolatedBusinessAuditSessionGuard({options:{connectionString:"postgres://db.example.com:5432/main"}} as Pool))
      .toThrow("BUSINESS_AUDIT_LOCAL_FIXTURE_REQUIRED");
  });
  it("holds the session row lock while the audit writer executes",async()=>{
    const f=fixture();
    expect(await f.guard.whileActive(binding,async client=>{
      await client.query("INSERT INTO identity.security_events (...) VALUES (...)");
      return "AUDITED";
    })).toBe("AUDITED");
    expect(f.sql.findIndex(s=>s.includes("FOR UPDATE"))).toBeLessThan(f.sql.findIndex(s=>s.startsWith("INSERT")));
    expect(f.sql.at(-1)).toBe("COMMIT");
    expect(f.client.release).toHaveBeenCalledOnce();
  });
  it("refuses a revoked or expired session without writing an audit",async()=>{
    const f=fixture(false),writer=vi.fn();
    expect(await f.guard.whileActive(binding,writer)).toBeNull();
    expect(writer).not.toHaveBeenCalled();
    expect(f.sql.at(-1)).toBe("ROLLBACK");
  });
  it("rolls back audit failures without issuing a successful result",async()=>{
    const f=fixture();
    await expect(f.guard.whileActive(binding,async()=>{throw new Error("AUDIT_FAILED")}))
      .rejects.toThrow("AUDIT_FAILED");
    expect(f.sql.at(-1)).toBe("ROLLBACK");
    expect(f.client.release).toHaveBeenCalledOnce();
  });
});
