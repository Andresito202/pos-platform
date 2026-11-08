import {describe,expect,it,vi} from "vitest";
import type {Pool} from "@pos-platform/database-postgres";
import {PostgresMerchantDestinationAcknowledgements} from "../src/merchant-destination-acknowledgements.js";
const tenant="11111111-1111-4111-8111-111111111111";
const company="33333333-3333-4333-8333-333333333333";
const install="77777777-7777-4777-8777-777777777777";
const scope={tenantId:tenant,companyId:company,installationId:install};
function setup(opts:{active?:boolean,central?:number,ack?:number,fail?:boolean}={}){
 const commands:Array<{sql:string;values?:unknown[]}>=[];let acknowledged=opts.ack??null;
 const client={
  release:vi.fn(),
  query:vi.fn(async(sql:string,values?:unknown[])=>{
   commands.push({sql,...(values?{values}:{})});
   if(opts.fail && sql.includes("merchant_destination_sequences"))throw new Error("DB_DOWN");
   if(sql.includes("FROM identity.device_registry"))return {rowCount:opts.active===false?0:1,rows:opts.active===false?[]:[{id:1}]};
   if(sql.includes("AS current_sequence"))return {rowCount:1,rows:[{
     floor:acknowledged===null?null:String(acknowledged),
     current_sequence:String(opts.central??5),
   }]};
   if(sql.includes("FROM payments.merchant_destination_sequences"))return {rowCount:1,rows:[{sequence:String(opts.central??5)}]};
   if(sql.includes("INSERT INTO payments.merchant_destination_acknowledgements")){
    const next=Number(values?.[3]);
    if(acknowledged!==null && next<=acknowledged)return {rowCount:0,rows:[]};
    acknowledged=next;
    return {rowCount:1,rows:[{sequence:String(acknowledged)}]};
   }
   if(sql.includes("FROM payments.merchant_destination_acknowledgements"))return acknowledged===null?
    {rowCount:0,rows:[]}:{rowCount:1,rows:[{sequence:String(acknowledged)}]};
   return {rowCount:0,rows:[]};
  }),
 };
 return {commands,client,store:new PostgresMerchantDestinationAcknowledgements({connect:async()=>client} as unknown as Pool)};
}
describe("QR-001 durable Central acknowledged floor",()=>{
 it("returns null only for active installation without an existing acknowledgement",async()=>{
  const x=setup();
  expect(await x.store.floorForPreauthorizedInstallation(scope)).toBeNull();
  expect(x.commands[0]?.sql).toContain("READ ONLY");
  expect(x.commands.some(q=>q.sql.includes("device_registry")&&q.values?.[0]===install)).toBe(true);
  expect(x.commands.at(-1)?.sql).toBe("COMMIT");
 });
 it("prevents foreign and inactive installation from reading any floor",async()=>{
  const x=setup({active:false});
  await expect(x.store.floorForPreauthorizedInstallation(scope)).rejects.toThrow("QR001_INSTALLATION_NOT_ACTIVE_IN_COMPANY");
  expect(x.commands.some(q=>q.sql.includes("FROM payments.merchant_destination_acknowledgements"))).toBe(false);
  expect(x.commands.at(-1)?.sql).toBe("ROLLBACK");
 });
 it("returns current company publication sequence and per-installation ACK consistently",async()=>{
   const x=setup({central:13,ack:12});
   expect(await x.store.statusForPreauthorizedInstallation(scope))
     .toEqual({floor:12,current_sequence:13});
   expect(x.commands.some(q=>q.sql.includes("AS current_sequence")&&
     q.values?.[0]===tenant&&q.values?.[1]===company&&q.values?.[2]===install)).toBe(true);
   expect(x.commands[0]?.sql).toContain("READ ONLY");
   expect(x.commands.at(-1)?.sql).toBe("COMMIT");
 });
 it("does not reveal company publication status for inactive device",async()=>{
   const x=setup({active:false,central:13,ack:12});
   await expect(x.store.statusForPreauthorizedInstallation(scope))
     .rejects.toThrow("QR001_INSTALLATION_NOT_ACTIVE_IN_COMPANY");
   expect(x.commands.some(q=>q.sql.includes("AS current_sequence"))).toBe(false);
 });
 it("records monotonic ACK bounded by Central publication sequence",async()=>{
  const x=setup({central:5,ack:2});
  expect(await x.store.acknowledgePreauthorizedInstallation(scope,4)).toBe(4);
  expect(await x.store.acknowledgePreauthorizedInstallation(scope,3)).toBe(4);
  expect(await x.store.floorForPreauthorizedInstallation(scope)).toBe(4);
  await expect(x.store.acknowledgePreauthorizedInstallation(scope,6)).rejects.toThrow("QR001_ACK_EXCEEDS_CENTRAL_SEQUENCE");
  expect(x.commands.filter(q=>q.sql==="ROLLBACK")).toHaveLength(1);
 });
 it("rolls back on database error",async()=>{
  const x=setup({fail:true});
  await expect(x.store.acknowledgePreauthorizedInstallation(scope,2)).rejects.toThrow("DB_DOWN");
  expect(x.commands.at(-1)?.sql).toBe("ROLLBACK");
  expect(x.client.release).toHaveBeenCalledOnce();
 });
});
