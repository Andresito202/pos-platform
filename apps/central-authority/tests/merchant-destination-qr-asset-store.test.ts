import {describe,expect,it,vi} from "vitest";
import {deflateSync} from "node:zlib";
import {PostgresMerchantQrAssetRepository} from "../src/merchant-destination-qr-asset-store.js";
import type {Pool} from "@pos-platform/database-postgres";

const tenant="11111111-1111-4111-8111-111111111111";
const company="33333333-3333-4333-8333-333333333333";
const actor="55555555-5555-4555-8555-555555555555";
function crc32(b:Buffer){let c=0xffffffff;for(const byte of b){c^=byte;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;}return(c^0xffffffff)>>>0;}
function chunk(name:string,data:Buffer){
 const nameBytes=Buffer.from(name);const len=Buffer.alloc(4);len.writeUInt32BE(data.length);
 const checksum=Buffer.alloc(4);checksum.writeUInt32BE(crc32(Buffer.concat([nameBytes,data])));
 return Buffer.concat([len,nameBytes,data,checksum]);
}
const png=()=>{
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(1,0);ihdr.writeUInt32BE(1,4);ihdr[8]=8;ihdr[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",ihdr),
   chunk("IDAT",deflateSync(Buffer.alloc(5))),chunk("IEND",Buffer.alloc(0))]);
};
function fake(){
 const statements:{sql:string;params?:unknown[]}[]=[];
 let fail=false;
 const client={release:vi.fn(),query:vi.fn(async(sql:string,params?:unknown[])=>{
   statements.push({sql,...(params?{params}:{})});
   if(fail && sql.startsWith("INSERT"))throw Error("WRITE_FAILED");
   return {rowCount:sql.startsWith("SELECT id,sha256")?0:1,rows:sql.includes("RETURNING")?[{id:"returned"}]:[]};
 })};
 const pool={connect:async()=>client} as unknown as Pool;
 return {repo:new PostgresMerchantQrAssetRepository(pool,{tenantId:tenant,companyId:company}),
  statements,client,setFail:(next:boolean)=>{fail=next;}};
}
describe("QR-001 private PNG Central custody",()=>{
 it("stores validated PNG using bound tenant/company and commits",async()=>{
  const f=fake(),saved=await f.repo.uploadPreauthorized(actor,png());
  expect(saved.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(f.statements.some(x=>x.sql.includes("app.tenant_id")&&x.params?.[0]===tenant)).toBe(true);
  expect(f.statements.some(x=>x.sql.includes("app.company_id")&&x.params?.[0]===company)).toBe(true);
  const insert=f.statements.find(x=>x.sql.includes("INSERT INTO payments.merchant_qr_assets"));
  expect(insert?.params?.[1]).toBe(tenant);expect(insert?.params?.[2]).toBe(company);
  expect(f.statements.at(-1)?.sql).toBe("COMMIT");
  expect(f.client.release).toHaveBeenCalledOnce();
 });
 it("rolls back failed private object writes",async()=>{
  const f=fake();f.setFail(true);
  await expect(f.repo.uploadPreauthorized(actor,png())).rejects.toThrow("WRITE_FAILED");
  expect(f.statements.at(-1)?.sql).toBe("ROLLBACK");
  expect(f.client.release).toHaveBeenCalledOnce();
 });
 it("rejects invalid objects before any database connection",async()=>{
  const f=fake();
  await expect(f.repo.uploadPreauthorized(actor,Buffer.from("<svg/>"))).rejects.toThrow("INVALID_OFFICIAL_QR_PNG");
  expect(f.statements).toHaveLength(0);
 });
 it("does not return an object owned by a different company",async()=>{
  const f=fake();
  const result=await f.repo.readPreauthorized("77777777-7777-4777-8777-777777777777");
  expect(result).toBeNull();
  expect(f.statements.some(x=>x.sql.includes("AND company_id=$2")&&x.params?.[1]===company)).toBe(true);
 });
});
