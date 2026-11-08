import type {Pool,PoolClient} from "@pos-platform/database-postgres";
import type {VerifiedMerchantScope} from "./merchant-destination-postgres-store.js";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export interface VerifiedMerchantInstallation extends VerifiedMerchantScope{
 readonly installationId:string;
}
function ensureIds(s:VerifiedMerchantInstallation):void{
 if(!UUID.test(s.tenantId)||!UUID.test(s.companyId)||!UUID.test(s.installationId))
   throw Error("QR001_INVALID_INSTALLATION_SCOPE");
}
function safeSequence(value:unknown):number{
 const v=Number(value);
 if(!Number.isSafeInteger(v)||v<1)throw Error("QR001_INVALID_SEQUENCE");
 return v;
}
/**
 * Central persisted acknowledgement floors, migration 024.
 *
 * IMPORTANT: verifiedScope must be derived from a commercial/device-bound
 * authenticated backend operation; this repository does not validate bearer
 * tokens or possession proof. Only call acknowledge() after the installed POS
 * has actually committed an authenticated signed snapshot.
 */
export class PostgresMerchantDestinationAcknowledgements{
 constructor(private readonly pool:Pool){}
 private async withInstallation<T>(
  scope:VerifiedMerchantInstallation,
  readonlyTransaction:boolean,
  work:(client:PoolClient)=>Promise<T>,
 ):Promise<T>{
  ensureIds(scope);
  const c=await this.pool.connect();let begun=false;
  try{
   await c.query(readonlyTransaction?"BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY":"BEGIN ISOLATION LEVEL SERIALIZABLE");
   begun=true;
   await c.query("SELECT set_config('app.tenant_id',$1,true)",[scope.tenantId]);
   await c.query("SELECT set_config('app.company_id',$1,true)",[scope.companyId]);
   const valid=await c.query(`SELECT 1 FROM identity.device_registry
    WHERE installation_id=$1 AND tenant_id=$2 AND company_id=$3 AND status='ACTIVE'
    ${readonlyTransaction?'':'FOR SHARE'}`,[scope.installationId,scope.tenantId,scope.companyId]);
   if(valid.rowCount!==1)throw Error("QR001_INSTALLATION_NOT_ACTIVE_IN_COMPANY");
   const result=await work(c);
   await c.query("COMMIT");begun=false;return result;
  }catch(error){if(begun)await c.query("ROLLBACK").catch(()=>undefined);throw error;}
  finally{c.release();}
 }
 async floorForPreauthorizedInstallation(scope:VerifiedMerchantInstallation):Promise<number|null>{
  return this.withInstallation(scope,true,async c=>{
   const r=await c.query(`SELECT sequence::text AS sequence
     FROM payments.merchant_destination_acknowledgements
     WHERE tenant_id=$1 AND company_id=$2 AND installation_id=$3`,
     [scope.tenantId,scope.companyId,scope.installationId]);
   if(r.rowCount===0)return null;
   if(r.rowCount!==1)throw Error("QR001_ACKNOWLEDGEMENT_INVALID");
   return safeSequence(r.rows[0]?.sequence);
  });
 }
 async acknowledgePreauthorizedInstallation(scope:VerifiedMerchantInstallation,sequence:number):Promise<number>{
  const desired=safeSequence(sequence);
  return this.withInstallation(scope,false,async c=>{
   // Lock central maximum sequence to prevent an acknowledgement for a
   // configuration that was never generated/published by Central.
   const central=await c.query(`SELECT sequence::text AS sequence
     FROM payments.merchant_destination_sequences
     WHERE tenant_id=$1 AND company_id=$2 FOR SHARE`,[scope.tenantId,scope.companyId]);
   if(central.rowCount!==1||desired>safeSequence(central.rows[0]?.sequence))
     throw Error("QR001_ACK_EXCEEDS_CENTRAL_SEQUENCE");
   const result=await c.query(`INSERT INTO payments.merchant_destination_acknowledgements
     (tenant_id,company_id,installation_id,sequence,acknowledged_at)
     VALUES($1,$2,$3,$4,clock_timestamp())
     ON CONFLICT(tenant_id,company_id,installation_id) DO UPDATE SET
       sequence=EXCLUDED.sequence,acknowledged_at=clock_timestamp()
     WHERE EXCLUDED.sequence>payments.merchant_destination_acknowledgements.sequence
     RETURNING sequence::text AS sequence`,
     [scope.tenantId,scope.companyId,scope.installationId,desired]);
   if(result.rowCount===1)return safeSequence(result.rows[0]?.sequence);
   const existing=await c.query(`SELECT sequence::text AS sequence
     FROM payments.merchant_destination_acknowledgements
     WHERE tenant_id=$1 AND company_id=$2 AND installation_id=$3`,
     [scope.tenantId,scope.companyId,scope.installationId]);
   if(existing.rowCount!==1)throw Error("QR001_ACKNOWLEDGEMENT_LOST");
   const acknowledged=safeSequence(existing.rows[0]?.sequence);
   if(acknowledged<desired)throw Error("QR001_ACKNOWLEDGEMENT_REGRESSED");
   return acknowledged;
  });
 }
}
