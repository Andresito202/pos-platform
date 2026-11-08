import type {Pool} from "@pos-platform/database-postgres";
import {uuidV7} from "@pos-platform/contracts";
import {MerchantDestinationCommands,MerchantDestinationDraftSchema,type MerchantDestinationRevision} from "@pos-platform/domain";
import {PostgresMerchantDestinationStore} from "./merchant-destination-postgres-store.js";
import {PostgresMerchantQrAssetRepository} from "./merchant-destination-qr-asset-store.js";
import {assertMerchantAdminDuringWrite} from "./merchant-destination-admin-authorization.js";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type MerchantBusinessSession={sessionId:string;userId:string;tenantId:string;tenantMembershipId:string};
export interface MerchantBusinessRequest{
  readonly session:MerchantBusinessSession;
  readonly action:"list"|"upload"|"create"|"publish"|"revoke"|"asset"|"notices";
  readonly payload:unknown;
}
function object(value:unknown):Record<string,unknown>{
 if(!value||typeof value!=="object"||Array.isArray(value))throw Error("QR001_INVALID_REQUEST");
 return value as Record<string,unknown>;
}
function only(value:Record<string,unknown>,keys:readonly string[]):void{
 if(Object.keys(value).length!==keys.length||!keys.every(k=>Object.hasOwn(value,k)))
   throw Error("QR001_INVALID_REQUEST");
}
function id(value:unknown):string{
 if(typeof value!=="string"||!UUID.test(value))throw Error("QR001_INVALID_REQUEST");
 return value;
}
function expectedVersion(value:unknown):number{
 if(typeof value!=="number"||!Number.isSafeInteger(value)||value<1)throw Error("QR001_INVALID_REQUEST");
 return value;
}
/**
 * Central BUSINESS operations. Only the already verified browser-cookie/CSRF
 * session may be supplied here, from a trusted server-side inspect() result.
 *
 * Deliberately restricted: a company ADMIN role assignment must be active,
 * explicit and unambiguous. No generic transfer-confirm permissions, spoofed
 * frontend roles, foreign company ids, or tenant-wide implicit assignment.
 */
export class MerchantBusinessDestinationOperations {
 constructor(private readonly pool:Pool,private readonly notificationReadEnabled=false){}
 private async adminCompany(session:MerchantBusinessSession):Promise<string>{
  for(const value of [session.sessionId,session.userId,session.tenantId,session.tenantMembershipId])id(value);
  const client=await this.pool.connect();
  let started=false;
  try{
   await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
   started=true;
   await client.query("SELECT set_config('app.tenant_id',$1,true)",[session.tenantId]);
   const r=await client.query<{company_id:string}>(`SELECT DISTINCT a.company_id::text AS company_id
      FROM "authorization".user_role_assignments a
      JOIN "authorization".roles role ON role.id=a.role_id
       AND role.status='ACTIVE' AND role.scope_type='BUSINESS'
       AND role.code IN ('OWNER','GENERAL_ADMIN')
      JOIN organization.companies company ON company.id=a.company_id
       AND company.tenant_id=a.tenant_id AND company.status='ACTIVE'
      JOIN tenancy.tenant_memberships m ON m.id=a.tenant_membership_id
       AND m.tenant_id=a.tenant_id AND m.user_id=$2
       AND m.status='ACTIVE' AND m.revoked_at IS NULL AND m.suspended_at IS NULL
      JOIN identity.sessions s ON s.id=$1 AND s.user_id=$2 AND s.tenant_id=$3
       AND s.tenant_membership_id=$4 AND s.mfa_status='SATISFIED'
       AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()
       AND s.last_reauthenticated_at>clock_timestamp()-interval '10 minutes'
      WHERE a.tenant_id=$3 AND a.tenant_membership_id=$4
       AND a.company_id IS NOT NULL AND a.branch_id IS NULL
       AND a.status='ACTIVE' AND a.revoked_at IS NULL
       AND a.valid_from<=clock_timestamp()
       AND (a.valid_until IS NULL OR a.valid_until>clock_timestamp())`,
       [session.sessionId,session.userId,session.tenantId,session.tenantMembershipId]);
   if(r.rowCount!==1||!r.rows[0]?.company_id)throw Error("QR001_ADMIN_DENIED_OR_AMBIGUOUS_COMPANY");
   await client.query("COMMIT");started=false;
   return r.rows[0].company_id;
  }catch(error){if(started)await client.query("ROLLBACK").catch(()=>undefined);throw error;}
  finally{client.release();}
 }
 async dispatch(request:MerchantBusinessRequest):Promise<unknown>{
  const companyId=await this.adminCompany(request.session);
  const tenantId=request.session.tenantId;
  const userId=request.session.userId;
  const scope={tenantId,companyId};
  const input=object(request.payload);
  const recheck=(client:import("@pos-platform/database-postgres").PoolClient)=>
    assertMerchantAdminDuringWrite(client,request.session,companyId);
  const assets=new PostgresMerchantQrAssetRepository(this.pool,scope,recheck);
  const store=new PostgresMerchantDestinationStore(this.pool,scope,recheck);
  const commands=new MerchantDestinationCommands(store);
  const access={tenantId,companyId,userId,canConfigure:true};
  if(request.action==="upload"){
    only(input,["png_base64"]);
    if(typeof input.png_base64!=="string"||input.png_base64.length>1_400_000||
       !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.png_base64))
      throw Error("QR001_INVALID_QR_BASE64");
    const raw=Buffer.from(input.png_base64,"base64");
    const asset=await assets.uploadPreauthorized(userId,raw);
    return {id:asset.id,sha256:asset.sha256};
  }
  if(request.action==="asset"){
    only(input,["id"]);
    const asset=await assets.readPreauthorized(id(input.id));
    return asset?{id:asset.id,sha256:asset.sha256,png_base64:asset.png.toString("base64")}:null;
  }
  if(request.action==="create"){
    only(input,["draft"]);
    const draft=MerchantDestinationDraftSchema.parse(input.draft);
    return commands.createDraft(access,uuidV7(),draft,new Date().toISOString());
  }
  if(request.action==="publish"||request.action==="revoke"){
    only(input,["id","expected_version"]);
    const identifier=id(input.id),version=expectedVersion(input.expected_version);
    return request.action==="publish"
      ?commands.publish(access,identifier,version,new Date().toISOString())
      :commands.revoke(access,identifier,version,new Date().toISOString());
  }
  if(request.action==="notices"){
    if(!this.notificationReadEnabled)throw Error("QR002_NOTIFICATIONS_NOT_ENABLED");
    only(input,[]);
    const client=await this.pool.connect();let started=false;
    try{
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");started=true;
      await client.query("SELECT set_config('app.tenant_id',$1,true)",[tenantId]);
      await client.query("SELECT set_config('app.company_id',$1,true)",[companyId]);
      await client.query("SET LOCAL statement_timeout='5s'");
      const result=await client.query(`SELECT id,received_at,sender_label,status,
        bank_confirmed,sale_confirmed,requires_independent_reconciliation
        FROM payments.merchant_payment_notification_inbox
        WHERE tenant_id=$1 AND company_id=$2
        ORDER BY received_at DESC,id DESC LIMIT 25`,[tenantId,companyId]);
      await client.query("COMMIT");started=false;
      return {notices:result.rows};
    }catch(error){
      if(started)await client.query("ROLLBACK").catch(()=>undefined);throw error;
    }finally{client.release();}
  }
  if(request.action==="list"){
    only(input,[]);
    const client=await this.pool.connect();
    let started=false;
    try{
     await client.query("BEGIN READ ONLY");started=true;
     await client.query("SELECT set_config('app.tenant_id',$1,true)",[tenantId]);
     await client.query("SELECT set_config('app.company_id',$1,true)",[companyId]);
     const result=await client.query(`SELECT d.id,d.version,d.status,d.kind,d.label,
       d.destination_reference,d.qr_asset_id,a.sha256 AS qr_sha256,
       d.published_at,d.revoked_at
       FROM payments.merchant_destinations d
       LEFT JOIN payments.merchant_qr_assets a ON a.id=d.qr_asset_id
        AND a.tenant_id=d.tenant_id AND a.company_id=d.company_id
       WHERE d.tenant_id=$1 AND d.company_id=$2
       ORDER BY d.created_at DESC LIMIT 100`,[tenantId,companyId]);
     await client.query("COMMIT");started=false;
     return {destinations:result.rows};
    }catch(error){if(started)await client.query("ROLLBACK").catch(()=>undefined);throw error;}
    finally{client.release();}
  }
  throw Error("QR001_UNSUPPORTED_ACTION");
 }
}
