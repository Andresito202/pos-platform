import * as z from "zod";
import {UuidV7Schema,StableCodeSchema} from "./primitives.js";
const minor=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
/** Backend-owned draft pricing only. This is neither a payable quote nor an
 * activation, tax result, invoice or delivery confirmation. */
export const LicenseOfferDraftSchema=z.strictObject({
  id:UuidV7Schema,code:StableCodeSchema,name:z.string().trim().min(1).max(160),
  billing_model:z.enum(["MONTHLY","ANNUAL","PERPETUAL"]),deployment_mode:z.enum(["HYBRID","LOCAL_PERPETUAL"]),
  currency_code:z.string().regex(/^[A-Z]{3}$/),price_minor:minor,
  included_registers:z.literal(1),additional_register_price_minor:minor,support_price_minor:minor,
  support_charge:z.literal("OPTIONAL_SAME_TERM"),policy_reference:z.string().trim().min(1).max(128),
}).refine(p=>p.billing_model!=="PERPETUAL"||p.deployment_mode==="LOCAL_PERPETUAL","Perpetual offer requires explicit local perpetual mode");
export type LicenseOfferDraft=z.infer<typeof LicenseOfferDraftSchema>;
export const LicenseOfferSelectionSchema=z.strictObject({additional_registers:z.number().int().nonnegative().max(10000),support:z.boolean()});
export function previewLicenseOffer(offer:LicenseOfferDraft,selection:unknown,version:number){
  const p=LicenseOfferDraftSchema.parse(offer),s=LicenseOfferSelectionSchema.parse(selection);
  if(!Number.isSafeInteger(version)||version<1)throw Error("LICENSE_OFFER_VERSION_REQUIRED");
  const base=BigInt(p.price_minor),extra=BigInt(p.additional_register_price_minor)*BigInt(s.additional_registers),support=s.support?BigInt(p.support_price_minor):0n,total=base+extra+support;
  if(total>BigInt(Number.MAX_SAFE_INTEGER))throw Error("LICENSE_OFFER_AMOUNT_OVERFLOW");
  return {state:"PRICING_PREVIEW" as const,plan_id:p.id,plan_version:version,currency_code:p.currency_code,billing_model:p.billing_model,
    included_registers:1,additional_registers:s.additional_registers,total_registers:1+s.additional_registers,
    base_minor:Number(base),additional_registers_minor:Number(extra),support_minor:Number(support),subtotal_minor:Number(total),
    tax_status:"NOT_CALCULATED" as const,payment_status:"NOT_REQUESTED" as const,activation_status:"NOT_ACTIVATED" as const};
}
