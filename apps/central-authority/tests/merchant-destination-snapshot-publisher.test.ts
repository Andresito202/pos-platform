import {createHash,generateKeyPairSync,verify} from "node:crypto";
import {deflateSync} from "node:zlib";
import {describe,expect,it,vi} from "vitest";
import type {Pool} from "@pos-platform/database-postgres";
import {canonicalJson} from "@pos-platform/local-channel";
import {CentralMerchantDestinationPublisher} from "../src/merchant-destination-snapshot-publisher.js";
import {DestinationSnapshotSchema} from "@pos-platform/domain";

function crc32(b:Buffer){let c=0xffffffff;for(const byte of b){c^=byte;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;}return(c^0xffffffff)>>>0;}
function chunk(name:string,data:Buffer){
 const label=Buffer.from(name),length=Buffer.alloc(4),crc=Buffer.alloc(4);
 length.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([label,data])));
 return Buffer.concat([length,label,data,crc]);
}
function samplePng(){
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(1,0);ihdr.writeUInt32BE(1,4);ihdr[8]=8;ihdr[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",ihdr),
  chunk("IDAT",deflateSync(Buffer.alloc(5))),chunk("IEND",Buffer.alloc(0))]);
}
const A="11111111-1111-4111-8111-111111111111",C="33333333-3333-4333-8333-333333333333";
const now=new Date();
const {privateKey,publicKey}=generateKeyPairSync("ed25519");
function setup(rows:Record<string,unknown>[]=[],cursor="3"){
 const queries:{sql:string;params?:unknown[]}[]=[];
 let sequence=Number(cursor);
 const client={
  release:vi.fn(),
  query:vi.fn(async(sql:string,params?:unknown[])=>{
   queries.push({sql,...(params?{params}:{})});
   if(sql.includes("UPDATE payments.merchant_destination_sequences")){
     sequence++;
     return {rowCount:1,rows:[{sequence:String(sequence),now}]};
   }
   if(sql.includes("FROM payments.merchant_destinations"))return {rowCount:rows.length,rows};
   return {rowCount:0,rows:[]};
  }),
 };
 const pool={connect:async()=>client} as unknown as Pool;
 const issuer=new CentralMerchantDestinationPublisher(pool,{
  purpose:"MERCHANT_DESTINATION_SNAPSHOT",environment:"SANDBOX",keyId:"qr001-test",
  privateKey,validFrom:new Date(now.getTime()-60_000).toISOString(),
  validUntil:new Date(now.getTime()+120_000).toISOString(),snapshotLifetimeMs:60_000,
 });
 return {issuer,client,queries};
}
describe("QR-001 Central Ed25519 company issuer",()=>{
 it("signs multiple published methods consistently from one company",async()=>{
  const qrId="77777777-7777-4777-8777-777777777777",png=samplePng();
  const rows=[
    {kind:"NEQUI_BUSINESS_QR",label:"QR Negocios",destination_reference:"@tienda",
     qr_asset_id:qrId,qr_sha256:createHash("sha256").update(png).digest("hex"),qr_png_bytes:png,version:"4"},
    {kind:"NEQUI_NUMBER",label:"Nequi",destination_reference:"3001234567",
     qr_asset_id:null,qr_sha256:null,version:"1"},
  ];
  const {issuer,queries,client}=setup(rows);
  const signed=await issuer.issueForPreauthorizedInstallation({tenantId:A,companyId:C});
  expect(signed.claims.snapshot.destination?.kind).toBe("NEQUI_BUSINESS_QR");
  expect(signed.claims.snapshot.destination?.qr_png_base64).toBe(png.toString("base64"));
  expect(signed.claims.snapshot.destinations?.map(x=>x.kind)).toEqual(["NEQUI_BUSINESS_QR","NEQUI_NUMBER"]);
  expect(DestinationSnapshotSchema.safeParse(signed.claims.snapshot).success).toBe(true);
  expect(verify(null,Buffer.from(canonicalJson(signed.claims)),publicKey,Buffer.from(signed.signature,"base64url"))).toBe(true);
  expect(queries.some(x=>x.sql.includes("app.company_id")&&x.params?.[0]===C)).toBe(true);
  expect(queries.at(-1)?.sql).toBe("COMMIT");
  expect(client.release).toHaveBeenCalledOnce();
 });
 it("creates a signed empty revocation snapshot for a company",async()=>{
  const {issuer}=setup([]);
  const artifact=await issuer.issueForPreauthorizedInstallation({tenantId:A,companyId:C});
  expect(artifact.claims.snapshot.destination).toBeNull();
  expect(artifact.claims.snapshot.destinations).toEqual([]);
 });
 it("rejects duplicated published methods and never emits a signature",async()=>{
  const sample={kind:"NEQUI_NUMBER",label:"Nequi",destination_reference:"3001234567",
    qr_asset_id:null,qr_sha256:null,version:1};
  const {issuer,queries,client}=setup([sample,sample]);
  await expect(issuer.issueForPreauthorizedInstallation({tenantId:A,companyId:C})).rejects.toThrow("QR001_PUBLISHED_METHODS_DUPLICATED");
  expect(queries.at(-1)?.sql).toBe("ROLLBACK");
  expect(client.release).toHaveBeenCalledOnce();
 });
 it("renews the same unchanged static bank QR with strictly increasing sequence",async()=>{
  const sample={kind:"NEQUI_NUMBER",label:"Nequi",destination_reference:"3001234567",
    qr_asset_id:null,qr_sha256:null,version:1};
  const {issuer,queries}=setup([sample],"20");
  const first=await issuer.issueForPreauthorizedInstallation({tenantId:A,companyId:C});
  const second=await issuer.issueForPreauthorizedInstallation({tenantId:A,companyId:C});
  expect(first.claims.snapshot.sequence).toBe(21);
  expect(second.claims.snapshot.sequence).toBe(22);
  expect(first.claims.snapshot.destinations).toEqual(second.claims.snapshot.destinations);
  expect(queries.filter(x=>x.sql.includes("UPDATE payments.merchant_destination_sequences"))).toHaveLength(2);
 });
 it("requires an authoritative company sequence",async()=>{
  const {issuer}=setup([],"-1");
  await expect(issuer.issueForPreauthorizedInstallation({tenantId:A,companyId:C})).rejects.toThrow("QR001_INVALID_SEQUENCE");
 });
});
