import { CanonicalPermission,HardwareCommandSchema,HardwareProfileSchema,type HardwareCommand,type HardwareProfile } from "@pos-platform/contracts";
import { createActor,createOperationScope,evaluatePermission,toRoleAssignments } from "@pos-platform/application";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import type { GetReceiptUseCase } from "../receipts/get-receipt-use-case.js";
import { HardwareStore,type HardwareActor } from "./hardware-store.js";
import { discoverSystemPrinters,requirePhysicalProfile,type HardwareTransport,type DiscoveredPeripheral } from "./adapters.js";
import { cutterCommand,drawerPulse,encodePrinterText,projectPrintableReceipt } from "./receipt-printer.js";
import type { AutomaticDrawerPolicy } from "./platform-transports.js";

export interface RegisteredHardware {readonly transport:HardwareTransport;readonly profile:HardwareProfile}
export class HardwareService {
  constructor(private readonly store:HardwareStore,private readonly receipts:GetReceiptUseCase,
    private readonly registry:ReadonlyMap<string,RegisteredHardware>=new Map(),
    private readonly discover:()=>Promise<DiscoveredPeripheral[]>=discoverSystemPrinters,
    private readonly automaticPolicy:AutomaticDrawerPolicy|null=null){}
  async afterConfirmedCashPayment(scope:SyncScope,snapshot:StoredAuthorizationSnapshot,actor:HardwareActor,paymentId:string):Promise<void> {
    if(!this.automaticPolicy)return;
    try {
      if(actor.userId!==snapshot.claims.user_id)throw new Error("HARDWARE_ACTOR_CONTEXT_MISMATCH");
      const decision=evaluatePermission({actor:createActor("USER",snapshot.claims.user_id),permission:CanonicalPermission.HARDWARE_DRAWER_OPEN,
        scope:createOperationScope(scope.tenantId,scope.companyId,scope.branchId),at:new Date(),assignments:toRoleAssignments(snapshot.claims)});
      if(!decision.allowed){this.store.audit(null,actor,"AUTOMATIC_DRAWER_DENIED",decision.reason);return;}
      const job=this.store.enqueueConfirmedCashDrawer(scope,actor,paymentId,this.automaticPolicy.binding_id,this.automaticPolicy.policy_reference);
      if(job){
        const outcome=await this.execute(scope,snapshot,actor,{action:"dispatch",job_id:job.id});
        if(outcome.kind==="REJECTED"||outcome.kind==="UNAUTHORIZED")this.store.audit(job.id,actor,"AUTOMATIC_DRAWER_INCIDENT",outcome.reason??"RECONCILIATION_REQUIRED");
      }
    }catch{
      try{this.store.audit(null,actor,"AUTOMATIC_DRAWER_INCIDENT","RECONCILIATION_REQUIRED");}catch{/* never roll back a confirmed payment or replay automatically */}
    }
  }
  async execute(scope:SyncScope,snapshot:StoredAuthorizationSnapshot,actor:HardwareActor,input:HardwareCommand):Promise<{kind:string;data:unknown;reason:string|null}> {
    const command=HardwareCommandSchema.parse(input);
    const job=command.action==="dispatch"?this.store.job(scope,command.job_id):null;
    const kind=command.action==="enqueue"?command.kind:job?.kind;
    const permission=command.action==="associate"?CanonicalPermission.HARDWARE_CONFIGURE:
      command.action==="list"||command.action==="diagnose"?CanonicalPermission.HARDWARE_READ:
      kind==="DRAWER_OPEN"?CanonicalPermission.HARDWARE_DRAWER_OPEN:CanonicalPermission.HARDWARE_PRINT;
    const decision=evaluatePermission({actor:createActor("USER",snapshot.claims.user_id),permission,
      scope:createOperationScope(scope.tenantId,scope.companyId,scope.branchId),at:new Date(),assignments:toRoleAssignments(snapshot.claims)});
    if(actor.userId!==snapshot.claims.user_id)throw new Error("HARDWARE_ACTOR_CONTEXT_MISMATCH");
    if(!decision.allowed){
      if(kind==="DRAWER_OPEN")this.store.audit(null,actor,"DENIED_MANUAL_DRAWER",decision.reason);
      return {kind:"UNAUTHORIZED",data:null,reason:decision.reason};
    }
    try {
      if(command.action==="diagnose")return {kind:"DIAGNOSED",data:{devices:await this.discover(),profiles:[...this.registry.values()].map(value=>value.profile),physical_confirmation:"NOT_OBSERVED"},reason:null};
      if(command.action==="list")return {kind:"FOUND",data:this.store.list(scope),reason:null};
      if(command.action==="associate"){
        const selected=this.registry.get(command.device_id);
        if(!selected||selected.profile.id!==command.profile_id)throw new Error("HARDWARE_MODEL_ADAPTER_NOT_CONFIGURED");
        this.store.associate(scope,actor,command.binding_id,command.cash_register_id,command.device_id,HardwareProfileSchema.parse(selected.profile));
        return {kind:"ASSOCIATED",data:null,reason:null};
      }
      if(command.action==="enqueue"){
        const binding=this.store.binding(scope,command.binding_id);if(!binding)throw new Error("HARDWARE_BINDING_NOT_FOUND");
        if(command.kind==="PRINT_RECEIPT"){
          if(!command.sale_id)throw new Error("HARDWARE_SALE_REQUIRED");
          const receipt=this.receipts.execute(scope,snapshot,command.sale_id);if(receipt.kind!=="FOUND")throw new Error(receipt.kind);
        }else if(command.sale_id!==null)throw new Error("HARDWARE_UNEXPECTED_SALE_REFERENCE");
        if(command.kind==="DRAWER_OPEN" && binding.profile.drawer!=="SUPPORTED")throw new Error("DRAWER_PROFILE_UNSUPPORTED");
        if(command.kind==="CUT" && binding.profile.cut!=="SUPPORTED")throw new Error("PRINTER_HAS_NO_VERIFIED_CUTTER");
        return {kind:"QUEUED",data:this.store.enqueue(scope,actor,command),reason:null};
      }
      if(!job)throw new Error("HARDWARE_JOB_NOT_FOUND");
      if(job.state!=="PENDING")return {kind:job.state,data:job,reason:"NO_AUTOMATIC_RETRY_OR_REPLAY"};
      const binding=this.store.binding(scope,job.binding_id);if(!binding)throw new Error("HARDWARE_BINDING_NOT_FOUND");
      const selected=this.registry.get(binding.device_id);
      if(!selected||JSON.stringify(selected.profile)!==JSON.stringify(binding.profile))throw new Error("HARDWARE_PROFILE_CHANGED_RECONCILE_REQUIRED");
      requirePhysicalProfile(binding.profile,selected.transport);
      let bytes:Uint8Array;
      if(job.kind==="DRAWER_OPEN")bytes=drawerPulse(binding.profile);
      else if(job.kind==="CUT")bytes=cutterCommand(binding.profile);
      else {
        let text="Camacho POS — prueba de impresión\nSin confirmación física\n";
        if(job.kind==="PRINT_RECEIPT"){
          const receipt=this.receipts.execute(scope,snapshot,job.sale_id!);if(receipt.kind!=="FOUND")throw new Error(receipt.kind);
          text=projectPrintableReceipt(receipt.receipt,binding.profile.columns);
        }
        bytes=encodePrinterText(text,binding.profile);
      }
      if(!this.store.claim(scope,actor,job.id))return {kind:"PENDING",data:null,reason:"JOB_ALREADY_CLAIMED"};
      // Claim + audit commit BEFORE I/O. Any exception after this point is uncertain.
      let result:{state:"TRANSPORT_ACCEPTED"|"FAILED"|"UNKNOWN";code:string};
      try {result=await selected.transport.send(bytes);}catch{result={state:"UNKNOWN",code:"TRANSPORT_OUTCOME_UNCERTAIN"};}
      this.store.finish(scope,actor,job.id,result.state,result.code);
      return {kind:result.state,data:this.store.job(scope,job.id),reason:result.code};
    }catch(error){return {kind:"REJECTED",data:null,reason:error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:"HARDWARE_OPERATION_FAILED"};}
  }
}
