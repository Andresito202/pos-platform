import {sign,verify,createPublicKey,type KeyObject} from "node:crypto";
import type {Pool,PoolClient} from "@pos-platform/database-postgres";
import {CashierDestinationSchema,DestinationSnapshotSchema,type CashierDestination} from "@pos-platform/domain";
import {canonicalJson} from "@pos-platform/local-channel";
import {validateOfficialQrPng} from "./merchant-destination-qr-asset.js";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PURPOSE="MERCHANT_DESTINATION_SNAPSHOT" as const;
type Environment="SANDBOX"|"STAGING"|"PRODUCTION";
export interface MerchantPublishedScope {
 readonly tenantId:string;
 readonly companyId:string;
}
export interface MerchantSigningConfiguration {
 readonly purpose:typeof PURPOSE;
 readonly environment:Environment;
 readonly keyId:string;
 readonly privateKey:KeyObject;
 readonly validFrom:string;
 readonly validUntil:string;
 readonly snapshotLifetimeMs:number;
}
export interface SignedMerchantCompanySnapshot {
 readonly claims:{
  readonly schema_version:1;
  readonly key_id:string;
  readonly environment:Environment;
  readonly snapshot:ReturnType<typeof DestinationSnapshotSchema.parse>;
 };
 readonly signature:string;
}
function validateScope(scope:MerchantPublishedScope):void {
 if(!UUID.test(scope.tenantId)||!UUID.test(scope.companyId))throw Error("QR001_INVALID_SCOPE");
}
function validSequence(value:unknown):number {
 const n=Number(value);
 if(!Number.isSafeInteger(n)||n<=0)throw Error("QR001_INVALID_SEQUENCE");
 return n;
}
/**
 * Central-only issuer for the company-wide QR-001 projection.
 * A caller MUST authenticate both the installation and its tenant/company
 * before invoking issueForPreauthorizedInstallation().
 *
 * This class does not expose HTTP, grant read/write permission or send funds.
 * Uses read-only REPEATABLE READ to keep company sequence and published
 * methods consistent at a single database snapshot.
 */
export class CentralMerchantDestinationPublisher {
 constructor(private readonly pool:Pool,private readonly signing:MerchantSigningConfiguration){
  const now=Date.now(),from=Date.parse(signing.validFrom),until=Date.parse(signing.validUntil);
  if(signing.purpose!==PURPOSE||!signing.keyId||!/^[A-Za-z0-9._-]{1,96}$/.test(signing.keyId)||
    signing.privateKey.type!=="private"||signing.privateKey.asymmetricKeyType!=="ed25519"||
    !Number.isFinite(from)||!Number.isFinite(until)||from>=until||now<from||now>=until||
    !Number.isSafeInteger(signing.snapshotLifetimeMs)||signing.snapshotLifetimeMs<60_000||signing.snapshotLifetimeMs>86_400_000)
    throw Error("QR001_SIGNING_CONFIGURATION_REJECTED");
  const probe=Buffer.from("qr001-purpose-separation");
  if(!verify(null,probe,createPublicKey(signing.privateKey),sign(null,probe,signing.privateKey)))
    throw Error("QR001_SIGNING_KEY_PAIR_INVALID");
 }
 async issueForPreauthorizedInstallation(scope:MerchantPublishedScope):Promise<SignedMerchantCompanySnapshot> {
  validateScope(scope);
  const client=await this.pool.connect();
  let begun=false;
  try {
   await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
   begun=true;
   await client.query("SELECT set_config('app.tenant_id',$1,true)",[scope.tenantId]);
   await client.query("SELECT set_config('app.company_id',$1,true)",[scope.companyId]);
   // Read database time and sequence inside the same MVCC snapshot as methods.
   const cursor=await client.query(`SELECT s.sequence::text AS sequence,clock_timestamp() AS now
     FROM payments.merchant_destination_sequences s
     WHERE s.tenant_id=$1 AND s.company_id=$2`,[scope.tenantId,scope.companyId]);
   if(cursor.rowCount!==1)throw Error("QR001_NOT_PUBLISHED");
   const sequence=validSequence(cursor.rows[0]?.sequence);
   const now=cursor.rows[0]?.now as Date;
   if(!(now instanceof Date)||!Number.isFinite(now.getTime()))throw Error("QR001_INVALID_DATABASE_CLOCK");
   const until=Math.min(Date.parse(this.signing.validUntil),now.getTime()+this.signing.snapshotLifetimeMs);
   if(until<=now.getTime())throw Error("QR001_SIGNING_KEY_EXPIRED");
   const result=await client.query(`SELECT d.kind,d.label,d.destination_reference,d.qr_asset_id,
       a.sha256 AS qr_sha256,a.png_bytes AS qr_png_bytes,d.version
     FROM payments.merchant_destinations d
     LEFT JOIN payments.merchant_qr_assets a
       ON a.tenant_id=d.tenant_id AND a.company_id=d.company_id AND a.id=d.qr_asset_id
     WHERE d.tenant_id=$1 AND d.company_id=$2 AND d.status='PUBLISHED'
     ORDER BY CASE d.kind WHEN 'NEQUI_BUSINESS_QR' THEN 0
      WHEN 'BREB_KEY' THEN 1 ELSE 2 END,d.id`,[scope.tenantId,scope.companyId]);
   if(result.rowCount===null||result.rowCount>3)throw Error("QR001_PUBLISHED_METHODS_INVALID");
   const destinations:CashierDestination[]=result.rows.map((r:Record<string,unknown>)=>{
     let image:string|undefined;
     if(r.kind==="NEQUI_BUSINESS_QR"){
       if(!Buffer.isBuffer(r.qr_png_bytes)||typeof r.qr_sha256!=="string")
         throw Error("QR001_QR_IMAGE_MISSING");
       const validated=validateOfficialQrPng(r.qr_png_bytes);
       if(validated.sha256!==r.qr_sha256)throw Error("QR001_QR_IMAGE_HASH_MISMATCH");
       image=validated.bytes.toString("base64");
     }
     return CashierDestinationSchema.parse({
       kind:r.kind,label:r.label,destination_reference:r.destination_reference,
       qr_asset_id:r.qr_asset_id,qr_sha256:r.qr_sha256,version:Number(r.version),
       ...(image===undefined?{}:{qr_png_base64:image}),
     });
   });
   if(new Set(destinations.map(x=>x.kind)).size!==destinations.length)
     throw Error("QR001_PUBLISHED_METHODS_DUPLICATED");
   const snapshot=DestinationSnapshotSchema.parse({
      tenant_id:scope.tenantId,company_id:scope.companyId,sequence,
      issued_at:now.toISOString(),expires_at:new Date(until).toISOString(),
      destination:destinations[0]??null,destinations,
   });
   const claims={schema_version:1 as const,key_id:this.signing.keyId,environment:this.signing.environment,snapshot};
   const signature=sign(null,Buffer.from(canonicalJson(claims)),this.signing.privateKey).toString("base64url");
   await client.query("COMMIT");
   begun=false;
   return {claims,signature};
  }catch(error){
   if(begun)await client.query("ROLLBACK").catch(()=>undefined);
   throw error;
  }finally{client.release();}
 }
}
