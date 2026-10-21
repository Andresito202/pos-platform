import { createHash } from "node:crypto";
import type { LocalDatabase } from "@pos-platform/database-sqlite";
import { HardwareProfileSchema,type HardwareProfile,type HardwareJobState } from "@pos-platform/contracts";
import type { SyncScope } from "../sync/durable-sync-store.js";

export interface HardwareActor {readonly userId:string;readonly sessionId:string}
export interface HardwareJob {
  id:string;binding_id:string;kind:"PRINT_TEST"|"PRINT_RECEIPT"|"DRAWER_OPEN"|"CUT";sale_id:string|null;
  reason:string;state:HardwareJobState;result_code:string;request_checksum:string;
}
export class HardwareStore {
  constructor(private readonly database:LocalDatabase){}
  recoverInterrupted():void {
    this.database.native.transaction(()=>{
      const interrupted=this.database.native.prepare("SELECT id,actor_id,session_id FROM hardware_jobs WHERE state='DISPATCHING'").all() as {id:string;actor_id:string;session_id:string}[];
      for(const job of interrupted){
        this.database.native.prepare("UPDATE hardware_jobs SET state='UNKNOWN',result_code='RESTART_REQUIRES_RECONCILIATION',updated_at=? WHERE id=?").run(new Date().toISOString(),job.id);
        this.audit(job.id,{userId:job.actor_id,sessionId:job.session_id},"INTERRUPTED","RESTART_REQUIRES_RECONCILIATION");
      }
    }).immediate();
  }
  audit(job:string|null,actor:HardwareActor,event:string,reason:string):void {
    this.database.native.prepare("INSERT INTO hardware_events(job_id,actor_id,session_id,event_code,reason,recorded_at) VALUES (?,?,?,?,?,?)")
      .run(job,actor.userId,actor.sessionId,event,reason,new Date().toISOString());
  }
  list(scope:SyncScope):{bindings:unknown[];jobs:HardwareJob[]} {
    return {bindings:this.database.native.prepare("SELECT id,cash_register_id,device_id,profile_json FROM hardware_bindings WHERE tenant_id=? AND company_id=? AND branch_id=?").all(scope.tenantId,scope.companyId,scope.branchId),
      jobs:this.database.native.prepare("SELECT id,binding_id,kind,sale_id,reason,state,result_code,request_checksum FROM hardware_jobs WHERE tenant_id=? AND company_id=? AND branch_id=? ORDER BY created_at DESC LIMIT 100").all(scope.tenantId,scope.companyId,scope.branchId) as HardwareJob[]};
  }
  associate(scope:SyncScope,actor:HardwareActor,id:string,register:string,device:string,profile:HardwareProfile):void {
    this.database.native.transaction(()=>{
      const cash=this.database.native.prepare("SELECT id FROM cash_register WHERE id=? AND tenant_id=? AND company_id=? AND branch_id=? AND status='ACTIVE'").get(register,scope.tenantId,scope.companyId,scope.branchId);
      if(!cash)throw new Error("HARDWARE_REGISTER_OUT_OF_SCOPE");
      this.database.native.prepare("INSERT INTO hardware_bindings(id,tenant_id,company_id,branch_id,cash_register_id,device_id,profile_json,created_at) VALUES (?,?,?,?,?,?,?,?)")
        .run(id,scope.tenantId,scope.companyId,scope.branchId,register,device,JSON.stringify(HardwareProfileSchema.parse(profile)),new Date().toISOString());
      this.audit(null,actor,"ASSOCIATED",id);
    }).immediate();
  }
  binding(scope:SyncScope,id:string):{id:string;device_id:string;profile:HardwareProfile}|null {
    const row=this.database.native.prepare("SELECT id,device_id,profile_json FROM hardware_bindings WHERE id=? AND tenant_id=? AND company_id=? AND branch_id=?").get(id,scope.tenantId,scope.companyId,scope.branchId) as {id:string;device_id:string;profile_json:string}|undefined;
    return row?{id:row.id,device_id:row.device_id,profile:HardwareProfileSchema.parse(JSON.parse(row.profile_json))}:null;
  }
  enqueue(scope:SyncScope,actor:HardwareActor,input:{job_id:string;binding_id:string;kind:HardwareJob["kind"];sale_id:string|null;reason:string}):HardwareJob {
    const checksum=createHash("sha256").update(JSON.stringify(input)).digest("hex");
    return this.database.native.transaction(()=>{
      const existing=this.job(scope,input.job_id);
      if(existing){if(existing.request_checksum!==checksum)throw new Error("HARDWARE_IDEMPOTENCY_CONFLICT");return existing;}
      if(!this.binding(scope,input.binding_id))throw new Error("HARDWARE_BINDING_NOT_FOUND");
      const at=new Date().toISOString();
      this.database.native.prepare("INSERT INTO hardware_jobs(id,tenant_id,company_id,branch_id,binding_id,kind,sale_id,reason,actor_id,session_id,request_checksum,state,result_code,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,'PENDING','QUEUED',?,?)")
        .run(input.job_id,scope.tenantId,scope.companyId,scope.branchId,input.binding_id,input.kind,input.sale_id,input.reason,actor.userId,actor.sessionId,checksum,at,at);
      this.audit(input.job_id,actor,"QUEUED",input.reason);return this.job(scope,input.job_id)!;
    }).immediate();
  }
  job(scope:SyncScope,id:string):HardwareJob|null {
    return this.database.native.prepare("SELECT id,binding_id,kind,sale_id,reason,state,result_code,request_checksum FROM hardware_jobs WHERE id=? AND tenant_id=? AND company_id=? AND branch_id=?").get(id,scope.tenantId,scope.companyId,scope.branchId) as HardwareJob|undefined??null;
  }
  claim(scope:SyncScope,actor:HardwareActor,id:string):boolean {
    return this.database.native.transaction(()=>{
      const changed=this.database.native.prepare("UPDATE hardware_jobs SET state='DISPATCHING',updated_at=? WHERE id=? AND tenant_id=? AND company_id=? AND branch_id=? AND state='PENDING'")
        .run(new Date().toISOString(),id,scope.tenantId,scope.companyId,scope.branchId).changes;
      if(changed===1)this.audit(id,actor,"DISPATCHING","AUTHORIZED_EXPLICIT_DISPATCH");return changed===1;
    }).immediate();
  }
  finish(scope:SyncScope,actor:HardwareActor,id:string,state:HardwareJobState,code:string):void {
    this.database.native.transaction(()=>{
      const changed=this.database.native.prepare("UPDATE hardware_jobs SET state=?,result_code=?,updated_at=? WHERE id=? AND tenant_id=? AND company_id=? AND branch_id=? AND state='DISPATCHING'")
        .run(state,code,new Date().toISOString(),id,scope.tenantId,scope.companyId,scope.branchId).changes;
      if(changed!==1)throw new Error("HARDWARE_JOB_STATE_CONFLICT");this.audit(id,actor,state,code);
    }).immediate();
  }
}
