import {generateKeyPairSync,verify} from "node:crypto";
import {describe,expect,it,vi} from "vitest";
import type {Pool} from "@pos-platform/database-postgres";
import {canonicalJson} from "@pos-platform/local-channel";
import {CentralMerchantDestinationPublisher} from "../src/merchant-destination-snapshot-publisher.js";
import {DestinationSnapshotSchema} from "@pos-platform/domain";

const A="11111111-1111-4111-8111-111111111111",C="33333333-3333-4333-8333-333333333333";
const now=new Date();
const {privateKey,publicKey}=generateKeyPairSync("ed25519");
function setup(rows:Record<string,unknown>[]=[],cursor="3"){
 const queries:{sql:string;params?:unknown[]}[]=[];
 const client={
  release:vi.fn(),
  query:vi.fn(async(sql:string,params?:unknown[])=>{
   queries.push({sql,...(params?{params}:{})});
   if(sql.includes("FROM payments.merchant_destination_sequences"))return {rowCount:1,rows:[{sequence:cursor,now}]};
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
  const qrId="77777777-7777-4777-8777-777777777777";
  const rows=[
    {kind:"NEQUI_BUSINESS_QR",label:"QR Negocios",destination_reference:"@tienda",
     qr_asset_id:qrId,qr_sha256:"a".repeat(64),version:"4"},
    {kind:"NEQUI_NUMBER",label:"Nequi",destination_reference:"3001234567",
     qr_asset_id:null,qr_sha256:null,version:"1"},
  ];
  const {issuer,queries,client}=setup(rows);
  const signed=await issuer.issueForPreauthorizedInstallation({tenantId:A,companyId:C});
  expect(signed.claims.snapshot.destination?.kind).toBe("NEQUI_BUSINESS_QR");
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
 it("requires an authoritative company sequence",async()=>{
  const {issuer}=setup([],"0");
  await expect(issuer.issueForPreauthorizedInstallation({tenantId:A,companyId:C})).rejects.toThrow("QR001_INVALID_SEQUENCE");
 });
});
