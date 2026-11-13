import {UuidSchema,LicenseActivationPolicySchema,SubscriptionQuoteTermsSchema} from "@pos-platform/contracts";
import type {PoolClient} from "@pos-platform/database-postgres";
/** Display state only; never a sale authorization or a renewal command. */
export function companyLicenseTermState(status:string,from:Date,until:Date|null,evaluatedAt:Date,graceDays:3){
  if(graceDays!==3||![from,evaluatedAt,...(until?[until]:[])].every(d=>Number.isFinite(d.getTime())))throw Error("COMPANY_LICENSE_TERM_POLICY_REQUIRED");
  if(status!=='ACTIVE' && status!=='PAST_DUE')return "NOT_CURRENT";
  if(status==='PAST_DUE' && until===null)return "NOT_CURRENT";
  if(evaluatedAt<from)return "NOT_STARTED";
  if(until===null||evaluatedAt<until)return "CURRENT";
  return evaluatedAt.getTime()<until.getTime()+graceDays*86400000?"GRACE":"EXPIRED";
}
/** Internal read projection INSIDE an already-authorized caller transaction.
 * This function is not authentication and is deliberately not mounted as HTTP
 * or IPC until a company-read permission and possession operation are approved.
 * Tenant is exclusively the transaction's trusted RLS context. */
export async function readCompanyLicenseContracts(c:PoolClient,companyId:string,trustedPolicy:unknown){
  UuidSchema.parse(companyId);const policy=LicenseActivationPolicySchema.parse(trustedPolicy);
  const scope=(await c.query("SELECT nullif(current_setting('app.tenant_id',true),'') AS tenant")).rows[0]?.tenant;
  if(!scope)throw Error("COMPANY_LICENSE_TRUSTED_TENANT_REQUIRED");
  if((await c.query("SELECT 1 FROM organization.companies WHERE id=$1 AND tenant_id=$2 AND status='ACTIVE'",[companyId,scope])).rowCount!==1)
    throw Error("COMPANY_LICENSE_SCOPE_REJECTED");
  const rows=(await c.query(`SELECT l.id,l.contract_status,l.not_before,l.expires_at,l.policy_version,q.plan_id,q.plan_version,q.quote_checksum,
      q.total_minor::text,q.currency_code,q.currency_exponent,q.included_registers,q.additional_registers,q.pricing_snapshot,q.terms_snapshot,
      q.created_at,p.confirmed_at,clock_timestamp() AS evaluated_at,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('activationId',a.id,'status',a.activation_status,'licenseVersion',a.license_version,
        'assignments',COALESCE(a.canonical_payload->'cash_register_capacity'->'allocations','[]'::jsonb)) ORDER BY a.license_version)
        FROM licensing.license_activations a WHERE a.license_id=l.id AND a.tenant_id=q.tenant_id AND a.company_id=q.company_id),'[]'::jsonb) AS activation_history
    FROM licensing.licenses l JOIN payments.payments p ON l.commercial_reference='SUBSCRIPTION_PAYMENT:'||p.id::text
    JOIN payments.payment_groups g ON g.id=p.payment_group_id AND g.tenant_id=p.tenant_id
    JOIN subscriptions.license_quotes q ON q.id=g.collection_subject_id
    WHERE l.tenant_id=$1 AND q.tenant_id=$1 AND q.company_id=$2 AND g.collection_subject_type='SUBSCRIPTION_QUOTE'
      AND p.status='CONFIRMED' ORDER BY q.created_at DESC,l.id LIMIT 257`,[scope,companyId])).rows;
  if(rows.length>256)throw Error("COMPANY_LICENSE_HISTORY_PAGINATION_REQUIRED");
  return rows.map(row=>{
    const terms=SubscriptionQuoteTermsSchema.parse(row.terms_snapshot),offer=row.pricing_snapshot.offer,now=(row.evaluated_at as Date).getTime();
    if(!policy.accepted_contract_policy_references.includes(terms.policy_reference))throw Error("COMPANY_LICENSE_CONTRACT_POLICY_REQUIRED");
    const nominal=row.expires_at===null?null:(row.expires_at as Date).getTime();
    const graceUntil=nominal===null?null:new Date(nominal+policy.subscription_grace_days*86400000).toISOString();
    const termState=companyLicenseTermState(String(row.contract_status),row.not_before as Date,row.expires_at as Date|null,new Date(now),policy.subscription_grace_days);
    return {licenseId:String(row.id),planId:String(row.plan_id),planVersion:Number(row.plan_version),billingModel:String(offer.billing_model),
      contractStatus:String(row.contract_status),termState,serviceFrom:(row.not_before as Date).toISOString(),serviceUntil:row.expires_at===null?null:(row.expires_at as Date).toISOString(),
      graceUntil,includedRegisters:Number(row.included_registers),paidAdditionalRegisters:Number(row.additional_registers),
      totalPaidMinor:String(row.total_minor),currencyCode:String(row.currency_code),currencyExponent:Number(row.currency_exponent),
      supportUntil:terms.support_until,supportSelected:terms.support_until!==null,activationHistory:row.activation_history,
      quoteChecksum:String(row.quote_checksum),policyReference:String(row.policy_version),
      renewalStatus:"REQUIRES_CONFIRMED_PAYMENT_AND_APPROVED_TERMS" as const};
  });
}
