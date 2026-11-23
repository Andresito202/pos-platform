import {lstatSync,readFileSync} from "node:fs";
import {isAbsolute} from "node:path";
import {
  SubscriptionFulfillmentProvisionSchema,
  type SubscriptionFulfillmentProvision,
} from "@pos-platform/contracts";
import type {Pool} from "@pos-platform/database-postgres";
import {SubscriptionLicenseFulfillment} from "./subscription-license-fulfillment.js";
import type {FulfillmentPolicyReferences} from "./subscription-license-contracts.js";
import type {SubscriptionFactusPayGateway} from "./subscription-factus-pay-gateway.js";

function managed(path:string,max:number):string{
  if(!isAbsolute(path))throw Error("SUBSCRIPTION_FULFILLMENT_MANAGED_ABSOLUTE_FILE_REQUIRED");
  const s=lstatSync(path);
  if(!s.isFile()||s.isSymbolicLink()||s.size>max||process.platform!=="win32"&&(s.mode&0o077)!==0){
    throw Error("SUBSCRIPTION_FULFILLMENT_MANAGED_FILE_REJECTED");
  }
  return new TextDecoder("utf-8",{fatal:true}).decode(readFileSync(path));
}

/** Opt-in autonomous fulfillment. CI green alone never enables this path. */
export async function prepareSubscriptionFulfillmentRuntime(input:{
  pool:Pool;
  provisionFile:string;
  approvedPolicies:readonly FulfillmentPolicyReferences[];
  factusPay?:SubscriptionFactusPayGateway|null;
}):Promise<{fulfillment:SubscriptionLicenseFulfillment;provision:SubscriptionFulfillmentProvision;stopWorker:()=>void}>{
  const provision=SubscriptionFulfillmentProvisionSchema.parse(JSON.parse(managed(input.provisionFile,16384)));
  const found=(await input.pool.query(`SELECT current_database() AS db,current_user='pos_platform_app' AND NOT rolsuper AND NOT rolbypassrls
    AND NOT pg_has_role(current_user,'pos_schema_owner','MEMBER') AS eligible FROM pg_roles WHERE rolname=current_user`)).rows[0];
  if(found?.db!==provision.expected_database||found?.eligible!==true){
    throw Error("SUBSCRIPTION_FULFILLMENT_REGISTERED_DATABASE_REQUIRED");
  }
  const ledger=(await input.pool.query(
    `SELECT encode(checksum,'hex') AS checksum FROM platform.target_migration_executions
     WHERE migration_id='035_subscription_license_fulfillment' AND status='APPLIED'`,
  )).rows;
  if(ledger.length!==1||ledger[0].checksum!==provision.migration_checksum){
    throw Error("SUBSCRIPTION_FULFILLMENT_REGISTERED_SCHEMA_REQUIRED");
  }
  if(!input.approvedPolicies.length)throw Error("LICENSING_FULFILLMENT_POLICY_REQUIRED");

  const fulfillment=new SubscriptionLicenseFulfillment(
    input.pool,
    provision,
    input.approvedPolicies,
    input.factusPay??null,
  );
  const stopWorker=fulfillment.startBackgroundWorker();
  return {fulfillment,provision,stopWorker};
}
