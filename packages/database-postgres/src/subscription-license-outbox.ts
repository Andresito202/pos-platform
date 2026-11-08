import {createHash} from "node:crypto";
import {canonicalSessionTrustJson,uuidV7} from "@pos-platform/contracts";
import type {PoolClient} from "pg";

/** Sync's existing canonical outbox. A contract event is not signed capacity. */
export class PostgresSubscriptionLicenseOutbox{
  async publish(c:PoolClient,e:{licenseId:string;tenantId:string;companyId:string;paymentId:string;quoteId:string;correlationId:string}){
    const id=uuidV7(),payload=canonicalSessionTrustJson({schema_version:1,license_id:e.licenseId,payment_id:e.paymentId,quote_id:e.quoteId,
      contract_status:"ACTIVE",activation_status:"NOT_ACTIVATED"}),checksum=createHash("sha256").update(payload).digest();
    await c.query(`INSERT INTO sync.sync_operations(id,tenant_id,company_id,source_kind,actor_type,aggregate_type,aggregate_id,operation_type,
      idempotency_key,authority_policy,correlation_id,schema_version,payload,payload_checksum,sync_status,received_at_server,committed_at_server)
      VALUES($1,$2,$3,'CENTRAL_SERVICE','SYSTEM','License',$4,'LICENSE_CONTRACT_ISSUED',$5,'SERVER_AUTHORITATIVE',$6,1,$7::jsonb,$8,'READY_TO_SYNC',clock_timestamp(),clock_timestamp())`,
      [id,e.tenantId,e.companyId,e.licenseId,"LICENSE_CONTRACT_ISSUED:"+e.paymentId,e.correlationId,payload,checksum]);
    await c.query(`INSERT INTO sync.outbox_entries(id,tenant_id,operation_id,operation_type,schema_version,payload_checksum,correlation_id,sync_status,created_at,available_at,updated_at)
      VALUES($1,$2,$3,'LICENSE_CONTRACT_ISSUED',1,$4,$5,'READY_TO_SYNC',clock_timestamp(),clock_timestamp(),clock_timestamp())`,[uuidV7(),e.tenantId,id,checksum,e.correlationId]);
    return id;
  }
}
