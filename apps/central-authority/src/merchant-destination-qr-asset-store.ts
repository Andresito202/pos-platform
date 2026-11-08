import {uuidV7} from "@pos-platform/contracts";
import type {Pool} from "@pos-platform/database-postgres";
import {validateOfficialQrPng} from "./merchant-destination-qr-asset.js";
import type {VerifiedMerchantScope} from "./merchant-destination-postgres-store.js";

/**
 * Central-only QR asset custody: bytes are stored in Payments (migration 024),
 * never served through a public URL or written to filesystem/CDN.
 *
 * The caller MUST first prove business-session identity, the admin config
 * grant, and recent reauthentication. This class is a DB port, not an HTTP
 * endpoint or a security boundary for browser requests.
 */
export interface StoredMerchantQrAsset {
  readonly id:string;
  readonly sha256:string;
  readonly png:Buffer;
  readonly contentType:"image/png";
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function assertScope(scope:VerifiedMerchantScope,actorId?:string):void {
  if(!UUID.test(scope.tenantId)||!UUID.test(scope.companyId)||
     (actorId!==undefined&&!UUID.test(actorId)))throw new Error("QR001_INVALID_AUTHENTICATED_SCOPE");
}
export class PostgresMerchantQrAssetRepository {
  constructor(private readonly pool:Pool,private readonly scope:VerifiedMerchantScope){
    assertScope(scope);
  }
  private async withScope<T>(write:boolean,work:(query:Pool["query"])=>Promise<T>):Promise<T>{
    const client=await this.pool.connect();
    let started=false;
    try {
      await client.query(write?"BEGIN ISOLATION LEVEL SERIALIZABLE":"BEGIN READ ONLY");
      started=true;
      await client.query("SELECT set_config('app.tenant_id',$1,true)",[this.scope.tenantId]);
      await client.query("SELECT set_config('app.company_id',$1,true)",[this.scope.companyId]);
      const result=await work(client.query.bind(client) as Pool["query"]);
      await client.query("COMMIT");
      started=false;
      return result;
    }catch(error){
      if(started)await client.query("ROLLBACK").catch(()=>undefined);
      throw error;
    }finally{client.release();}
  }
  async uploadPreauthorized(actorId:string,bytes:Buffer):Promise<StoredMerchantQrAsset>{
    assertScope(this.scope,actorId);
    const checked=validateOfficialQrPng(bytes);
    const id=uuidV7();
    await this.withScope(true,async query=>{
      const r=await query(`INSERT INTO payments.merchant_qr_assets
        (id,tenant_id,company_id,sha256,png_bytes,content_type,created_by,created_at)
        VALUES($1,$2,$3,$4,$5,'image/png',$6,clock_timestamp()) RETURNING id`,
        [id,this.scope.tenantId,this.scope.companyId,checked.sha256,checked.bytes,actorId]);
      if(r.rowCount!==1)throw new Error("QR001_ASSET_NOT_STORED");
    });
    return {id,sha256:checked.sha256,png:checked.bytes,contentType:"image/png"};
  }
  async readPreauthorized(id:string):Promise<StoredMerchantQrAsset|null>{
    if(!UUID.test(id))throw new Error("QR001_INVALID_ASSET_ID");
    return this.withScope(false,async query=>{
      const r=await query(`SELECT id,sha256,png_bytes,content_type
        FROM payments.merchant_qr_assets WHERE tenant_id=$1 AND company_id=$2 AND id=$3`,
        [this.scope.tenantId,this.scope.companyId,id]);
      if(r.rowCount===0)return null;
      if(r.rowCount!==1)throw new Error("QR001_ASSET_DUPLICATED");
      const row=r.rows[0] as {id:string;sha256:string;png_bytes:Buffer;content_type:string};
      if(row.content_type!=="image/png")throw new Error("QR001_ASSET_CORRUPTED");
      const verified=validateOfficialQrPng(row.png_bytes);
      if(verified.sha256!==row.sha256)throw new Error("QR001_ASSET_CORRUPTED");
      return {id:row.id,sha256:verified.sha256,png:verified.bytes,contentType:"image/png"};
    });
  }
}
