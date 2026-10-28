import type {PoolClient} from "pg";
import {createHash} from "node:crypto";
import {canonicalSessionTrustJson,uuidV7} from "@pos-platform/contracts";

/** Sync-owned writer on the existing 001 Operation/Outbox pair. No delivery,
 * entitlement or routing is inferred by persisting a financial event. */
export class PostgresSubscriptionPaymentOutbox {
  async publish(c:PoolClient,input:{operation:"RESERVED"|"CONFIRMED";tenantId:string;companyId:string;branchId:string;
    paymentId:string;quoteId:string;buyerTenantId:string;buyerCompanyId:string;amount:string;providerReference:string;correlationId:string}){
    const operationId=uuidV7(),type="SUBSCRIPTION_PAYMENT_"+input.operation;
    const payload=canonicalSessionTrustJson({schema_version:1,payment_id:input.paymentId,quote_id:input.quoteId,
      buyer_tenant_id:input.buyerTenantId,buyer_company_id:input.buyerCompanyId,amount:input.amount,currency_code:"COP",
      provider_reference:input.providerReference,status:input.operation==="CONFIRMED"?"CONFIRMED":"PENDING"});
    const checksum=createHash("sha256").update(payload).digest();
    await c.query(`INSERT INTO sync.sync_operations(id,tenant_id,company_id,branch_id,source_kind,actor_type,aggregate_type,aggregate_id,
      operation_type,idempotency_key,authority_policy,correlation_id,schema_version,payload,payload_checksum,sync_status,received_at_server,committed_at_server)
      VALUES($1,$2,$3,$4,'CENTRAL_SERVICE','SYSTEM','Payment',$5,$6,$7,$8,$9,1,$10::jsonb,$11,'READY_TO_SYNC',clock_timestamp(),clock_timestamp())`,
      [operationId,input.tenantId,input.companyId,input.branchId,input.paymentId,type,type+":"+input.paymentId,
        input.operation==="CONFIRMED"?"EXTERNAL_PROVIDER_AUTHORITATIVE":"SERVER_AUTHORITATIVE",input.correlationId,payload,checksum]);
    await c.query(`INSERT INTO sync.outbox_entries(id,tenant_id,operation_id,operation_type,schema_version,payload_checksum,correlation_id,
      sync_status,created_at,available_at,updated_at) VALUES($1,$2,$3,$4,1,$5,$6,'READY_TO_SYNC',clock_timestamp(),clock_timestamp(),clock_timestamp())`,
      [uuidV7(),input.tenantId,operationId,type,checksum,input.correlationId]);
    return operationId;
  }
}
