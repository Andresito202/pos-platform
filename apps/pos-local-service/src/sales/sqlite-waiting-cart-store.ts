import type { CreateSaleResult } from "./create-sale-use-case.js";
import { createHash } from "node:crypto";
import type { LocalDatabase } from "@pos-platform/database-sqlite";
import { WaitingCartPayloadSchema, type WaitingCart, type WaitingCartPayload } from "@pos-platform/contracts";
import type { SyncScope } from "../sync/durable-sync-store.js";
import { canonicalJson } from "../channel/canonical-json.js";

type Owner = SyncScope & { operatorId: string };
interface Row { id:string; version:number; state:string; payload_json:string; updated_at:string; last_save_key:string; last_save_checksum:string; sale_key:string|null; sale_checksum:string|null; sale_result_json:string|null }
const ownerWhere = "tenant_id=? AND company_id=? AND branch_id=? AND device_id=? AND operator_id=?";
const params = (o:Owner) => [o.tenantId,o.companyId,o.branchId,o.deviceId,o.operatorId];
const checksum = (value:unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const project = (row:Row):WaitingCart => {
  const payload=WaitingCartPayloadSchema.parse(JSON.parse(row.payload_json));
  return {id:row.id,version:row.version,updated_at:row.updated_at,line_count:payload.lines.length,payload};
};

/** Caller must verify current SALES_SALE_CREATE authority before every call. */
export class SqliteWaitingCartStore {
  constructor(private readonly db:LocalDatabase,private readonly now:()=>Date=()=>new Date()) {}
  private read(owner:Owner,id:string):Row|undefined {
    return this.db.native.prepare(`SELECT * FROM sales_waiting_carts WHERE ${ownerWhere} AND id=?`).get(...params(owner),id) as Row|undefined;
  }
  list(owner:Owner) {
    const rows=this.db.native.prepare(`SELECT * FROM sales_waiting_carts WHERE ${ownerWhere} AND state='WAITING' ORDER BY updated_at,id LIMIT 51`).all(...params(owner)) as Row[];
    return {outcome:"FOUND" as const,carts:rows.slice(0,50).map(row=>{const cart=project(row);return {...cart,payload:{...cart.payload,lines:[]}};}),has_more:rows.length>50};
  }
  get(owner:Owner,id:string) {
    const row=this.read(owner,id);
    if(row?.state!=="WAITING") return {outcome:"NOT_FOUND",carts:[],has_more:false};
    const cart=project(row);
    // Recover only an already-open shift belonging to this operator/device.
    // This read never opens/reopens a shift or bypasses payment permissions.
    const active=this.db.native.prepare(`SELECT id AS shift_id,version FROM cash_shift
      WHERE tenant_id=? AND company_id=? AND branch_id=? AND origin_device_id=? AND opened_by_actor_id=?
        AND cash_register_id=? AND status='OPEN'`).get(...params(owner),cart.payload.cash_register_id) as {shift_id:string;version:number}|undefined;
    return {outcome:"FOUND",carts:[{...cart,active_shift:active??null}],has_more:false};
  }
  discard(owner:Owner,id:string,version:number) {
    return this.db.native.transaction(()=>{
      const row=this.read(owner,id);
      if(!row) return {outcome:"NOT_FOUND",carts:[],has_more:false};
      if(row.version!==version || row.state==="CONSUMED") return {outcome:"VERSION_CONFLICT",carts:[],has_more:false};
      this.db.native.prepare(`UPDATE sales_waiting_carts SET state='DISCARDED',updated_at=? WHERE ${ownerWhere} AND id=?`).run(this.now().toISOString(),...params(owner),id);
      return {outcome:"DISCARDED",carts:[],has_more:false};
    })();
  }
  save(owner:Owner,id:string,version:number,key:string,input:WaitingCartPayload) {
    const payload=WaitingCartPayloadSchema.parse(input);
    const digest=checksum({id,version,payload});
    return this.db.native.transaction(()=>{
      const row=this.read(owner,id);
      const reject=(outcome:string)=>({outcome,carts:[] as WaitingCart[],has_more:false});
      if(row && row.state!=='WAITING') return reject("VERSION_CONFLICT");
      if(row?.last_save_key===key) return row.last_save_checksum===digest
        ? {outcome:"SAVED",carts:[project(row)],has_more:false}:reject("IDEMPOTENCY_CONFLICT");
      if(row ? row.version!==version : version!==0) return reject("VERSION_CONFLICT");
      // A foreign ID is never overwritten and never reveals its owner.
      if(!row && this.db.native.prepare("SELECT 1 FROM sales_waiting_carts WHERE id=?").get(id)) return reject("NOT_FOUND");
      if(!row && (this.db.native.prepare(`SELECT count(*) AS n FROM sales_waiting_carts WHERE ${ownerWhere} AND state='WAITING'`).get(...params(owner)) as {n:number}).n>=50) return reject("CART_LIMIT");
      const timestamp=this.now().toISOString();
      if(row) this.db.native.prepare(`UPDATE sales_waiting_carts SET version=version+1,payload_json=?,cash_register_id=?,last_save_key=?,last_save_checksum=?,updated_at=? WHERE ${ownerWhere} AND id=?`).run(JSON.stringify(payload),payload.cash_register_id,key,digest,timestamp,...params(owner),id);
      else this.db.native.prepare(`INSERT INTO sales_waiting_carts (id,tenant_id,company_id,branch_id,device_id,operator_id,cash_register_id,version,state,payload_json,last_save_key,last_save_checksum,updated_at) VALUES (?,?,?,?,?,?,?,1,'WAITING',?,?,?,?)`).run(id,...params(owner),payload.cash_register_id,JSON.stringify(payload),key,digest,timestamp);
      return {outcome:"SAVED",carts:[project(this.read(owner,id)!)],has_more:false};
    })();
  }
  /** Sale creation and consumption share the same SQLite transaction. */
  consume(owner:Owner,id:string,version:number,key:string,payload:unknown,registerId:string|null,create:()=>CreateSaleResult): CreateSaleResult | {kind:"WAITING_CART_NOT_FOUND"|"WAITING_CART_CONFLICT"} {
    return this.db.native.transaction(()=>{
      const row=this.read(owner,id);
      if(!row) return {kind:"WAITING_CART_NOT_FOUND" as const};
      const digest=checksum(payload);
      if(row.state==='CONSUMED') {
        if(row.sale_key!==key || row.sale_checksum!==digest) return {kind:"IDEMPOTENCY_CONFLICT" as const};
        const saved=JSON.parse(row.sale_result_json!) as Extract<CreateSaleResult,{kind:"CREATED"|"IDEMPOTENT"}>;
        return {...saved,kind:"IDEMPOTENT" as const};
      }
      if(row.state!=="WAITING" || row.version!==version || project(row).payload.cash_register_id!==registerId) return {kind:"WAITING_CART_CONFLICT" as const};
      const result=create();
      if(result.kind==='CREATED'||result.kind==='IDEMPOTENT') this.db.native.prepare(`UPDATE sales_waiting_carts SET state='CONSUMED',sale_key=?,sale_checksum=?,sale_result_json=?,updated_at=? WHERE ${ownerWhere} AND id=?`).run(key,digest,JSON.stringify(result),this.now().toISOString(),...params(owner),id);
      return result;
    })();
  }
}
