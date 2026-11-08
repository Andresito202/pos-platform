import {describe,expect,it} from "vitest";
import {MerchantDestinationCommands, type DestinationMutationEvent, type DestinationMutationStore} from "../src/merchant-destination-commands.js";
import type {MerchantDestinationRevision} from "../src/merchant-destination.js";
import type {MerchantDestinationAccess} from "../src/merchant-destination-policy.js";

const tenant="11111111-1111-4111-8111-111111111111";
const company="33333333-3333-4333-8333-333333333333";
const user="55555555-5555-4555-8555-555555555555";
const id="66666666-6666-4666-8666-666666666666";
const at="2026-11-07T18:00:00.000Z";
const admin:MerchantDestinationAccess={tenantId:tenant,companyId:company,userId:user,canConfigure:true};
const cashier:MerchantDestinationAccess={...admin,canConfigure:false};
const draft={kind:"NEQUI_NUMBER" as const,label:"Nequi",destination_reference:"3001234567",qr_asset_id:null,qr_sha256:null};

/** Test double simulates an all-or-nothing serializable transaction; NOT a production DB adapter. */
class MemoryTransactions implements DestinationMutationStore {
  rows=new Map<string,MerchantDestinationRevision>();
  events: DestinationMutationEvent[]=[];
  failAudit=false;
  key(t:string,c:string,i:string):string {return [t,c,i].join(":");}
  async transaction<T>(work:(tx:any)=>Promise<T>):Promise<T> {
    const staged=new Map(this.rows);
    const audit=[...this.events];
    const tx={
      getDestination:async(t:string,c:string,i:string)=>staged.get(this.key(t,c,i))??null,
      createDraft:async(r:MerchantDestinationRevision)=>{
        const k=this.key(r.tenant_id,r.company_id,r.id);
        if(staged.has(k)) throw new Error("UNIQUE_CONFLICT");
        staged.set(k,r);
      },
      replaceIfVersion:async(r:MerchantDestinationRevision,version:number)=>{
        const k=this.key(r.tenant_id,r.company_id,r.id);
        const current=staged.get(k);
        if(!current||current.version!==version)return false;
        staged.set(k,r);
        return true;
      },
      appendAuditAndOutbox:async(e:DestinationMutationEvent)=>{
        if(this.failAudit)throw new Error("AUDIT_FAILED");
        audit.push(e);
      }
    };
    const result=await work(tx);
    this.rows=staged;
    this.events=audit;
    return result;
  }
}
describe("QR-001 transactional command boundary",()=>{
 it("creates, publishes and revokes while recording three atomic events",async()=>{
  const store=new MemoryTransactions(),commands=new MerchantDestinationCommands(store);
  const created=await commands.createDraft(admin,id,draft,at);
  expect(created.status).toBe("DRAFT");
  const published=await commands.publish(admin,id,1,at);
  expect(published.status).toBe("PUBLISHED");
  const revoked=await commands.revoke(admin,id,2,at);
  expect(revoked.status).toBe("REVOKED");
  expect(store.events.map(x=>x.type)).toEqual(["DESTINATION_DRAFT_CREATED","DESTINATION_PUBLISHED","DESTINATION_REVOKED"]);
  expect(store.events.every(x=>x.tenant_id===tenant&&x.company_id===company)).toBe(true);
 });
 it("denies cashier writes even on direct method invocation",async()=>{
  const store=new MemoryTransactions(),commands=new MerchantDestinationCommands(store);
  await expect(commands.createDraft(cashier,id,draft,at)).rejects.toThrow("FORBIDDEN");
  await expect(commands.publish(cashier,id,1,at)).rejects.toThrow("FORBIDDEN");
  expect(store.events).toHaveLength(0);
 });
 it("hides foreign id from other tenant and company operations",async()=>{
  const store=new MemoryTransactions(),commands=new MerchantDestinationCommands(store);
  await commands.createDraft(admin,id,draft,at);
  await expect(commands.publish({...admin,tenantId:"22222222-2222-4222-8222-222222222222"},id,1,at)).rejects.toThrow("NOT_FOUND");
  await expect(commands.publish({...admin,companyId:"44444444-4444-4444-8444-444444444444"},id,1,at)).rejects.toThrow("NOT_FOUND");
  expect(store.events).toHaveLength(1);
 });
 it("detects stale version and avoids ghost event",async()=>{
  const store=new MemoryTransactions(),commands=new MerchantDestinationCommands(store);
  await commands.createDraft(admin,id,draft,at);
  await commands.publish(admin,id,1,at);
  await expect(commands.revoke(admin,id,1,at)).rejects.toThrow("VERSION_CONFLICT");
  expect(store.events).toHaveLength(2);
 });
 it("does not persist draft without audit and outbox",async()=>{
  const store=new MemoryTransactions();store.failAudit=true;
  const commands=new MerchantDestinationCommands(store);
  await expect(commands.createDraft(admin,id,draft,at)).rejects.toThrow("AUDIT_FAILED");
  expect(store.rows.size).toBe(0);
  expect(store.events).toHaveLength(0);
 });
 it("rejects invalid Nequi numbers and duplicate ids",async()=>{
  const store=new MemoryTransactions(),commands=new MerchantDestinationCommands(store);
  await expect(commands.createDraft(admin,id,{...draft,destination_reference:"invalid"},at)).rejects.toThrow();
  await commands.createDraft(admin,id,draft,at);
  await expect(commands.createDraft(admin,id,draft,at)).rejects.toThrow("ALREADY_EXISTS");
 });
});
