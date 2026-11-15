import { createHash } from "node:crypto";
import { createActor,createOperationScope,evaluatePermission,toRoleAssignments } from "@pos-platform/application";
import { CanonicalPermission } from "@pos-platform/contracts";
import { canonicalJson } from "../channel/canonical-json.js";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import type { SqliteInventoryStore } from "./sqlite-inventory-store.js";

function authorized(scope:SyncScope,snapshot:StoredAuthorizationSnapshot,permission:string,at:Date):boolean{
  return evaluatePermission({
    actor:createActor("USER",snapshot.claims.user_id),
    permission,scope:createOperationScope(scope.tenantId,scope.companyId,scope.branchId),
    at,assignments:toRoleAssignments(snapshot.claims),
  }).allowed;
}
function checksum(value:unknown):string{
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/** The approving operator must hold BOTH catalog-write and inventory-adjust. */
export class ApprovePresentationConversionUseCase{
  constructor(private readonly inventory:SqliteInventoryStore){}
  execute(scope:SyncScope,sessionId:string,snapshot:StoredAuthorizationSnapshot,request:{
    sourcePresentationId:string;targetPresentationId:string;
    numerator:string;denominator:string;version:number;
    idempotencyKey:string;correlationId:string;causationId:string|null;
  },at:Date=new Date()){
    if(!authorized(scope,snapshot,CanonicalPermission.CATALOG_PRODUCT_REGISTER,at)||
       !authorized(scope,snapshot,CanonicalPermission.INVENTORY_STOCK_ADJUST,at))
      return {kind:"UNAUTHORIZED" as const,ruleId:undefined};
    const actorId=snapshot.claims.user_id;
    const requestChecksum=checksum({
      tenant_id:scope.tenantId,company_id:scope.companyId,
      source_presentation_id:request.sourcePresentationId,
      target_presentation_id:request.targetPresentationId,
      numerator:request.numerator,denominator:request.denominator,version:request.version,
      actor_id:actorId,idempotency_key:request.idempotencyKey,
    });
    return this.inventory.approveConversionRule({
      scope,sessionId,actorId,requestChecksum,...request,
    });
  }
}

/** Only an authorized stock-adjust operation can consume ingredients or convert lots. */
export class ConvertPresentationUseCase{
  constructor(private readonly inventory:SqliteInventoryStore){}
  execute(scope:SyncScope,sessionId:string,snapshot:StoredAuthorizationSnapshot,request:{
    ruleId:string;sourceLotId:string;quantity:string;reasonCode:string;businessDate:string;
    idempotencyKey:string;correlationId:string;causationId:string|null;
  },at:Date=new Date()){
    if(!authorized(scope,snapshot,CanonicalPermission.INVENTORY_STOCK_ADJUST,at))
      return {kind:"UNAUTHORIZED" as const};
    const actorId=snapshot.claims.user_id;
    const requestChecksum=checksum({
      tenant_id:scope.tenantId,company_id:scope.companyId,branch_id:scope.branchId,
      rule_id:request.ruleId,source_lot_id:request.sourceLotId,
      quantity:request.quantity,reason_code:request.reasonCode,
      business_date:request.businessDate,actor_id:actorId,
      idempotency_key:request.idempotencyKey,
    });
    return this.inventory.convertPresentation({scope,sessionId,actorId,requestChecksum,...request});
  }
}
