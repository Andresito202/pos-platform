import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { FactusPayIngressProvisionSchema } from "@pos-platform/contracts";
import { PostgresFactusPayWebhookInboxRepository, type Pool } from "@pos-platform/database-postgres";
import { FixedWindowRateLimiter } from "./fixed-window-rate-limiter.js";
import { createFactusPayWebhookHandler } from "./factus-pay-webhook-handler.js";


/** Opt-in mounting in the existing HTTPS server, with explicit operational
 * limits and exact 018 ledger. No provider secret enters this configuration. */
export async function prepareFactusPayRuntime(pool:Pool,path:string){
  if(!isAbsolute(path))throw Error("FACTUS_PAY_MANAGED_FILE_REQUIRED");
  const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16384)throw Error("FACTUS_PAY_MANAGED_FILE_REJECTED");
  const p=FactusPayIngressProvisionSchema.parse(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(readFileSync(path))));
  const ledger=await pool.query(`SELECT encode(checksum,'hex') AS checksum FROM platform.target_migration_executions
    WHERE migration_id='018_factus_pay_webhook_inbox' AND status='APPLIED'`);
  if(ledger.rows.length!==1||ledger.rows[0].checksum!==p.migration_checksum)throw Error("FACTUS_PAY_REGISTERED_SCHEMA_REQUIRED");
  const role=await pool.query(`SELECT current_user='pos_platform_app' AND NOT rolsuper AND NOT rolbypassrls
    AND NOT pg_has_role(current_user,'pos_schema_owner','MEMBER') AS eligible FROM pg_roles WHERE rolname=current_user`);
  if(role.rows[0]?.eligible!==true)throw Error("FACTUS_PAY_CENTRAL_ROLE_REQUIRED");
  const limiter=new FixedWindowRateLimiter(p.rate_limit.maximum,p.rate_limit.buckets,p.rate_limit.window_ms);
  const handler=createFactusPayWebhookHandler({inbox:new PostgresFactusPayWebhookInboxRepository({pool,
    lockTimeoutMs:p.lock_timeout_ms,statementTimeoutMs:p.statement_timeout_ms}),maxBodyBytes:p.max_body_bytes});
  return (request:Parameters<typeof handler>[0],response:Parameters<typeof handler>[1])=>{
    if(!limiter.allow(request.socket.remoteAddress??"unknown")){
      response.writeHead(429,{"cache-control":"no-store","content-length":"0"});response.end();return Promise.resolve();
    }
    return handler(request,response);
  };
}
