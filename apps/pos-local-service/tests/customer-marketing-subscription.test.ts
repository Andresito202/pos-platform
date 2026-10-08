import { mkdtemp } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import type { AuthorizationSnapshotClaims, FiscalCustomer } from "@pos-platform/contracts";
import { DurableSyncStore } from "../src/sync/durable-sync-store.js";
import { SqliteCustomerStore } from "../src/customers/sqlite-customer-store.js";
import { RegisterCustomerUseCase } from "../src/customers/register-customer-use-case.js";
import { CustomerMarketingSubscriptionStore } from "../src/customers/customer-marketing-subscription.js";
import type { StoredAuthorizationSnapshot } from "../src/authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../src/sync/durable-sync-store.js";

const TENANT="018f0000-0000-7000-8000-000000000101";
const COMPANY="018f0000-0000-7000-8000-000000000102";
const BRANCH="018f0000-0000-7000-8000-000000000103";
const DEVICE="018f0000-0000-7000-8000-000000000104";
const INSTALL="018f0000-0000-7000-8000-000000000105";
const USER="018f0000-0000-7000-8000-000000000106";
const SESSION="018f0000-0000-7000-8000-000000000107";
const CORRELATION="018f0000-0000-7000-8000-000000000108";
const NOW=new Date("2026-10-08T12:00:00.000Z");

const scope: SyncScope={tenantId:TENANT,companyId:COMPANY,branchId:BRANCH,deviceId:DEVICE,installationId:INSTALL};
const customer: FiscalCustomer={
  identificationDocumentCode:"13", identification:"1020304051", verificationDigit:null,
  legalOrganizationCode:"2", company:null, names:"Cliente Noticias",
  tributeCode:"ZZ", fiscalResponsibilityCodes:["R-99-PN"], email:"cliente@example.co",
  phone:"3001234567", address:null, countryCode:null, municipalityCode:null,
};
const directories:string[]=[];
const databases:LocalDatabase[]=[];
let key=0;

afterEach(()=>{ for(const db of databases.splice(0)) db.close(); for(const d of directories.splice(0)) rmSync(d,{recursive:true,force:true}); });

function auth(): StoredAuthorizationSnapshot {
  const claims: AuthorizationSnapshotClaims={
    snapshot_id:"018f0000-0000-7000-8000-000000000109",
    user_id:USER, installation_id:INSTALL, device_id:DEVICE, sequence:1,
    issued_at:"2026-10-08T00:00:00.000Z", expires_at:"2026-10-09T00:00:00.000Z",
    key_id:"AUTHZ_KEY_1",
    assignments:[{
      tenant_id:TENANT, company_id:COMPANY, branch_id:BRANCH, status:"ACTIVE",
      valid_from:"2026-10-01T00:00:00.000Z", valid_until:null, role_status:"ACTIVE",
      permissions:[{code:"CUSTOMERS_CUSTOMER_REGISTER",status:"ACTIVE"}],
    }],
  } as AuthorizationSnapshotClaims;
  return {claims,signature:"stub",activatedAt:NOW.toISOString()};
}

async function env(){
  const dir=await mkdtemp(join(tmpdir(),"pos-customer-marketing-")); directories.push(dir);
  const database=LocalDatabase.open({dataDirectory:dir}); databases.push(database);
  const sync=new DurableSyncStore(database);
  const customerStore=new SqliteCustomerStore(database,sync,()=>NOW);
  const registered=new RegisterCustomerUseCase(customerStore).execute(
    scope,SESSION,auth(),{customer,idempotencyKey:"customer-"+(++key),correlationId:CORRELATION,causationId:null},NOW,
  );
  if(registered.kind!=="REGISTERED") throw new Error("customer fixture was not registered");
  return {database,customerId:registered.customerId,marketing:new CustomerMarketingSubscriptionStore(database,()=>NOW)};
}

describe("customer marketing subscription — explicit POS_NEWS opt-in",()=>{
  it("starts without subscription and subscribes with consent evidence",async()=>{
    const {customerId,marketing}=await env();
    expect(marketing.get(scope,customerId)).toBeNull();
    const result=marketing.executeSubscribe({scope,sessionId:SESSION,authSnapshot:auth(),customerId,idempotencyKey:"marketing-1",correlationId:CORRELATION,causationId:null,at:NOW});
    expect(result.kind).toBe("SUBSCRIBED");
    if(result.kind!=="SUBSCRIBED") throw new Error("expected subscription");
    expect(result.subscription.status).toBe("SUBSCRIBED");
    expect(result.subscription.consentVersion).toBe("1.0");
    expect(result.subscription.consentedAt).toBe(NOW.toISOString());
  });

  it("is idempotent and then permits an explicit unsubscribe",async()=>{
    const {customerId,marketing}=await env();
    const input={scope,sessionId:SESSION,authSnapshot:auth(),customerId,idempotencyKey:"marketing-2",correlationId:CORRELATION,causationId:null,at:NOW};
    expect(marketing.executeSubscribe(input).kind).toBe("SUBSCRIBED");
    const retry=marketing.executeSubscribe(input);
    expect(retry.kind).toBe("IDEMPOTENT");
    const unsub=marketing.executeUnsubscribe({...input,idempotencyKey:"marketing-3"});
    expect(unsub.kind).toBe("UNSUBSCRIBED");
    if(unsub.kind!=="UNSUBSCRIBED") throw new Error("expected unsubscribe");
    expect(unsub.subscription.status).toBe("UNSUBSCRIBED");
    expect(unsub.subscription.unsubscribedAt).toBe(NOW.toISOString());
  });

  it("never subscribes a customer without an email address",async()=>{
    const {database,marketing}=await env();
    database.native.prepare("UPDATE customers_customers SET email=NULL WHERE tenant_id=? AND company_id=?").run(TENANT,COMPANY);
    const result=marketing.executeSubscribe({scope,sessionId:SESSION,authSnapshot:auth(),customerId:(database.native.prepare("SELECT id FROM customers_customers LIMIT 1").get() as {id:string}).id,idempotencyKey:"marketing-4",correlationId:CORRELATION,causationId:null,at:NOW});
    expect(result.kind).toBe("EMAIL_REQUIRED");
  });

  it("records the marketing action without copying email or phone into the audit trail",async()=>{
    const {database,customerId,marketing}=await env();
    marketing.executeSubscribe({scope,sessionId:SESSION,authSnapshot:auth(),customerId,idempotencyKey:"marketing-5",correlationId:CORRELATION,causationId:null,at:NOW});
    const audit=database.native.prepare("SELECT action_code,details_json FROM local_operation_audit WHERE action_code='CUSTOMER_MARKETING_SUBSCRIBE'").all() as Array<{action_code:string;details_json:string}>;
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain(customer.email);
    expect(JSON.stringify(audit)).not.toContain(customer.phone);
  });
});
