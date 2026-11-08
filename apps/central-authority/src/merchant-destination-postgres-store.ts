import {uuidV7} from "@pos-platform/contracts";
import type {Pool,PoolClient} from "@pos-platform/database-postgres";
import type {
  DestinationMutationStore, DestinationMutationTransaction, DestinationMutationEvent,
  MerchantDestinationRevision,
} from "@pos-platform/domain";

/**
 * QR-001 physical store for Central Payments migration 024.
 *
 * The constructor MUST be created only AFTER a Central handler has established
 * the signed commercial identity and a backend grant for company configuration.
 * This class does not authenticate an incoming HTTP request and MUST NOT be
 * exposed as a handler. Avoid passing renderer-supplied tenant/company IDs.
 */
export interface VerifiedMerchantScope {
  readonly tenantId:string;
  readonly companyId:string;
}
function assertUuid(value:string):void {
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
    throw new Error("QR001_INVALID_VERIFIED_SCOPE");
}

const projectionColumns=`id,tenant_id,company_id,version,status,kind,label,
destination_reference,qr_asset_id,qr_sha256,created_by_user_id,published_at,revoked_at`;

/**
 * The SQL storage schema uses qr_asset_id as an FK to the binary asset table.
 * The QR digest belongs to that asset; it is joined into the immutable
 * projection and is never taken from browser input as an assertion.
 */
const selectRevisionSql=`SELECT d.id,d.tenant_id,d.company_id,d.version,d.status,
 d.kind,d.label,d.destination_reference,d.qr_asset_id,
 a.sha256 AS qr_sha256,d.created_by AS created_by_user_id,
 d.published_at,d.revoked_at
 FROM payments.merchant_destinations d
 LEFT JOIN payments.merchant_qr_assets a ON a.tenant_id=d.tenant_id
  AND a.company_id=d.company_id AND a.id=d.qr_asset_id
 WHERE d.tenant_id=$1 AND d.company_id=$2 AND d.id=$3 FOR UPDATE OF d`;

type Row=Record<string,unknown>;
function toRevision(row:Row):MerchantDestinationRevision {
  return {
    id:String(row.id),tenant_id:String(row.tenant_id),company_id:String(row.company_id),
    version:Number(row.version),status:row.status as MerchantDestinationRevision["status"],
    kind:row.kind as MerchantDestinationRevision["kind"],
    label:String(row.label),destination_reference:String(row.destination_reference),
    qr_asset_id:row.qr_asset_id===null?null:String(row.qr_asset_id),
    qr_sha256:row.qr_sha256===null?null:String(row.qr_sha256),
    created_by_user_id:String(row.created_by_user_id),
    published_at:row.published_at===null?null:new Date(row.published_at as string|Date).toISOString(),
    revoked_at:row.revoked_at===null?null:new Date(row.revoked_at as string|Date).toISOString(),
  };
}

export class PostgresMerchantDestinationStore implements DestinationMutationStore {
  constructor(private readonly pool:Pool,private readonly scope:VerifiedMerchantScope) {
    assertUuid(scope.tenantId);assertUuid(scope.companyId);
  }

  async transaction<T>(work:(tx:DestinationMutationTransaction)=>Promise<T>):Promise<T> {
    const client:PoolClient=await this.pool.connect();
    let begun=false;
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      begun=true;
      await client.query("SELECT set_config('app.tenant_id',$1,true)",[this.scope.tenantId]);
      await client.query("SELECT set_config('app.company_id',$1,true)",[this.scope.companyId]);
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '10s'");
      const ensureScope=(tenantId:string,companyId:string):void=>{
        if(tenantId!==this.scope.tenantId||companyId!==this.scope.companyId)
          throw new Error("NOT_FOUND");
      };
      const tx:DestinationMutationTransaction={
        getDestination:async(tenantId,companyId,id)=>{
          ensureScope(tenantId,companyId);
          const r=await client.query(selectRevisionSql,[tenantId,companyId,id]);
          return r.rowCount===1?toRevision(r.rows[0] as Row):null;
        },
        createDraft:async record=>{
          ensureScope(record.tenant_id,record.company_id);
          if(record.status!=="DRAFT"||record.version!==1)throw new Error("INVALID_DRAFT");
          if(record.qr_asset_id===null && record.qr_sha256!==null)throw new Error("QR_ASSET_MISMATCH");
          if(record.qr_asset_id!==null){
            const qr=await client.query(`SELECT sha256 FROM payments.merchant_qr_assets
              WHERE tenant_id=$1 AND company_id=$2 AND id=$3 FOR SHARE`,
              [record.tenant_id,record.company_id,record.qr_asset_id]);
            if(qr.rowCount!==1||qr.rows[0]?.sha256!==record.qr_sha256)
              throw new Error("QR_ASSET_MISMATCH");
          }
          await client.query(`INSERT INTO payments.merchant_destinations
          (id,tenant_id,company_id,kind,label,destination_reference,qr_asset_id,
           version,status,created_by,created_at,published_at,revoked_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,1,'DRAFT',$8,clock_timestamp(),NULL,NULL)`,
          [record.id,record.tenant_id,record.company_id,record.kind,record.label,
           record.destination_reference,record.qr_asset_id,record.created_by_user_id]);
        },
        replaceIfVersion:async(record,expectedVersion)=>{
          ensureScope(record.tenant_id,record.company_id);
          const r=await client.query(`UPDATE payments.merchant_destinations
            SET version=$4,status=$5,published_at=$6,revoked_at=$7
            WHERE tenant_id=$1 AND company_id=$2 AND id=$3 AND version=$8`,
            [record.tenant_id,record.company_id,record.id,record.version,
             record.status,record.published_at,record.revoked_at,expectedVersion]);
          return r.rowCount===1;
        },
        appendAuditAndOutbox:async(event:DestinationMutationEvent)=>{
          ensureScope(event.tenant_id,event.company_id);
          const eventId=uuidV7();
          await client.query(`INSERT INTO payments.merchant_destination_events
            (event_id,tenant_id,company_id,destination_id,destination_version,
             event_type,actor_user_id,occurred_at)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
            [eventId,event.tenant_id,event.company_id,event.destination_id,
             event.destination_version,event.type,event.actor_user_id,event.at]);
          await client.query(`INSERT INTO payments.merchant_destination_outbox
            (event_id,tenant_id,company_id,destination_id,destination_version,
             payload_json,recorded_at)
            VALUES($1,$2,$3,$4,$5,$6::jsonb,clock_timestamp())`,
            [eventId,event.tenant_id,event.company_id,event.destination_id,
             event.destination_version,JSON.stringify(event)]);
        },
      };
      const result=await work(tx);
      await client.query("COMMIT");
      begun=false;
      return result;
    }catch(error){
      if(begun)await client.query("ROLLBACK").catch(()=>undefined);
      throw error;
    }finally{client.release();}
  }
}
