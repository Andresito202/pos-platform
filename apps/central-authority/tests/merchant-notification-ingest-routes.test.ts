import {afterEach,describe,expect,it,vi} from "vitest";
import type {Pool} from "@pos-platform/database-postgres";
import {PostgresMerchantNotificationDeviceProofVerifier} from "@pos-platform/database-postgres";
import {MerchantNotificationIngestRoutes} from "../src/merchant-notification-ingest-routes.js";

const scope={
  tenantId:"11111111-1111-4111-8111-111111111111",
  companyId:"33333333-3333-4333-8333-333333333333",
  installationId:"55555555-5555-4555-8555-555555555555",
  deviceId:"66666666-6666-4666-8666-666666666666",
  credentialId:"77777777-7777-4777-8777-777777777777",
  credentialExpiresAt:"2027-11-07T12:00:00Z",
  requestId:"88888888-8888-4888-8888-888888888888",
  correlationId:"99999999-9999-4999-8999-999999999999",
};
const event={
  source:"NEQUI_NEGOCIOS_SHARED_SMS",
  message_sha256:"a".repeat(64),
  observed_at:new Date().toISOString(),
  received_at:new Date().toISOString(),
  sender_label:"SMS compartido",
};
function fakePool(consented:boolean){
  const sql:string[]=[],release=vi.fn();
  const client={
    release,
    query:vi.fn(async(q:string)=>{
      sql.push(q);
      if(q.includes("FROM payments.merchant_notification_bridge_consents c"))
        return {rowCount:consented?1:0,rows:consented?[{ok:true}]:[]};
      if(q.includes("FROM payments.merchant_payment_notification_inbox n"))
        return {rowCount:1,rows:[{
          id:"01900000-0000-7000-8000-000000000031",
          received_at:new Date("2026-11-07T12:00:00Z"),
          reported_amount_cop:"4500",payer_display:"Juan Pérez",
          status:"UNVERIFIED",bank_confirmed:false,sale_confirmed:false,
        }]};
      if(q.includes("INSERT INTO payments.merchant_payment_notification_inbox"))
        return {rowCount:1,rows:[{id:"test"}]};
      return {rowCount:0,rows:[]};
    }),
  };
  return {pool:{connect:async()=>client} as unknown as Pool,sql,release};
}
const proof=(payload:unknown)=>({
  authorization:"signed-binary-placeholder",
  requestId:scope.requestId,correlationId:scope.correlationId,
  body:JSON.stringify(payload),
});
afterEach(()=>vi.restoreAllMocks());

describe("QR-002 authenticated, consent-gated notification ingestion boundary",()=>{
  it("is permanently closed to malformed input before allocating any DB connection",async()=>{
    const x=fakePool(true);
    const route=new MerchantNotificationIngestRoutes(x.pool);
    for(const invalid of [
      {...event,tenant_id:scope.tenantId},
      {...event,payment_id:scope.requestId},
      {...event,bank_confirmed:true},
      {...event,text_preview:"private banking sms"},
      {...event,source:"NEQUI_PERSONAL_P2P"},
      {...event,message_sha256:"not-a-digest"},
    ])expect(await route.handle(proof(invalid))).toBeNull();
    expect(x.sql).toHaveLength(0);
  });
  it("requires a fresh verified native device proof; an unsigned SMS cannot insert",async()=>{
    const x=fakePool(true);
    const verifier=vi.spyOn(PostgresMerchantNotificationDeviceProofVerifier.prototype,
      "verifyIngestAndConsume").mockResolvedValue(null);
    const route=new MerchantNotificationIngestRoutes(x.pool);
    expect(await route.handle(proof(event))).toBeNull();
    expect(verifier).toHaveBeenCalledOnce();
    expect(x.sql).toHaveLength(0);
  });
  it("checks active company+installation consent under row lock before inserting any notice",async()=>{
    const x=fakePool(false);
    vi.spyOn(PostgresMerchantNotificationDeviceProofVerifier.prototype,
      "verifyIngestAndConsume").mockResolvedValue(scope);
    const route=new MerchantNotificationIngestRoutes(x.pool);
    await expect(route.handle(proof(event))).rejects.toThrow("QR002_BRIDGE_NOT_AUTHORIZED_OR_CONSENT_REVOKED");
    expect(x.sql.some(q=>q.includes("FOR SHARE OF c"))).toBe(true);
    expect(x.sql.some(q=>q.includes("INSERT INTO payments.merchant_payment_notification_inbox"))).toBe(false);
    expect(x.sql.at(-1)).toBe("ROLLBACK");
  });
  it("records only a company-scoped UNVERIFIED observation and no sale payment",async()=>{
    const x=fakePool(true);
    vi.spyOn(PostgresMerchantNotificationDeviceProofVerifier.prototype,
      "verifyIngestAndConsume").mockResolvedValue(scope);
    const route=new MerchantNotificationIngestRoutes(x.pool);
    const outcome=await route.handle(proof(event));
    expect(outcome).toEqual({accepted:true,inserted:true});
    expect(x.sql.some(q=>q.includes("FOR SHARE OF c"))).toBe(true);
    expect(x.sql.some(q=>q.includes("INSERT INTO payments.merchant_payment_notification_inbox"))).toBe(true);
    expect(x.sql.some(q=>/payment.transfer.confirm|UPDATE payments.sales|UPDATE payments.payments/.test(q))).toBe(false);
    expect(x.sql.at(-1)).toBe("COMMIT");
  });
  it("returns company-scoped SMS-asserted value to a signed register, never a bank-confirmed payment",async()=>{
    const x=fakePool(true);
    vi.spyOn(PostgresMerchantNotificationDeviceProofVerifier.prototype,
      "verifyRecentAndConsume").mockResolvedValue(scope);
    const route=new MerchantNotificationIngestRoutes(x.pool);
    const result=await route.recent(proof({}));
    expect(result).toEqual({notices:[{
      id:"01900000-0000-7000-8000-000000000031",
      received_at:"2026-11-07T12:00:00.000Z",
      reported_amount_cop:4500,payer_display:"Juan Pérez",status:"UNVERIFIED",
      bank_confirmed:false,sale_confirmed:false,
    }]});
    const sql=x.sql.find(q=>q.includes("FROM payments.merchant_payment_notification_inbox n"));
    expect(sql).toContain("LIMIT 25");
    expect(sql).toContain("n.tenant_id=$1 AND n.company_id=$2");
    expect(sql).toContain("c.revoked_at IS NULL");
    expect(x.sql.at(-1)).toBe("COMMIT");
  });
  it("rejects client selected company and unsigned register read before tenant SQL",async()=>{
    const x=fakePool(true);
    const route=new MerchantNotificationIngestRoutes(x.pool);
    expect(await route.recent(proof({company_id:scope.companyId}))).toBeNull();
    vi.spyOn(PostgresMerchantNotificationDeviceProofVerifier.prototype,
      "verifyRecentAndConsume").mockResolvedValue(null);
    expect(await route.recent(proof({}))).toBeNull();
    expect(x.sql).toHaveLength(0);
  });

});
