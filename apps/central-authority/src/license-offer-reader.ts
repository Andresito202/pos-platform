import { LicenseOfferDraftSchema } from "@pos-platform/contracts";
import type { PoolClient } from "@pos-platform/database-postgres";

/** Licensing-owned read inside the consumer's transaction. A quote freezes the
 * actual plan version and feature catalog, without changing either aggregate. */
export async function readPublishedLicenseOffer(c:PoolClient,planId:string,version:number){
  const row=(await c.query("SELECT * FROM licensing.plans WHERE id=$1 AND version=$2 AND status='ACTIVE' AND offer_profile='CAMACHO_LICENSE_OFFER_V1' FOR SHARE",[planId,version])).rows[0];
  if(!row)throw Error("SUBSCRIPTION_PUBLISHED_PLAN_REQUIRED");
  const offer=LicenseOfferDraftSchema.parse({id:row.id,code:row.code,name:row.name,billing_model:row.billing_model,deployment_mode:row.deployment_mode,
    currency_code:row.currency_code,price_minor:Number(row.price_minor),included_registers:row.included_registers,
    additional_register_price_minor:Number(row.additional_register_price_minor),support_price_minor:Number(row.support_price_minor),
    support_charge:row.support_charge,policy_reference:row.offer_policy_reference});
  const features=(await c.query("SELECT capability_code,enabled,limit_type,limit_value::text FROM licensing.plan_entitlements WHERE plan_id=$1 ORDER BY capability_code FOR SHARE",[planId])).rows;
  return {offer,features};
}
