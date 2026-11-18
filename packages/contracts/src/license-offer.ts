import * as z from "zod";
import {UuidV7Schema,StableCodeSchema} from "./primitives.js";
const minor=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
/** Backend-owned draft pricing only. This is neither a payable quote nor an
 * activation, tax result, invoice or delivery confirmation. */
const fields={
  id:UuidV7Schema,code:StableCodeSchema,name:z.string().trim().min(1).max(160),
  billing_model:z.enum(["MONTHLY","ANNUAL","PERPETUAL"]),deployment_mode:z.enum(["HYBRID","LOCAL_PERPETUAL"]),
  currency_code:z.string().regex(/^[A-Z]{3}$/),price_minor:minor,
  included_registers:z.literal(1),additional_register_price_minor:minor,support_price_minor:minor,
  support_charge:z.literal("OPTIONAL_SAME_TERM"),policy_reference:z.string().trim().min(1).max(128),
};
const legacy=z.strictObject(fields).refine(p=>p.billing_model!=="PERPETUAL"||p.deployment_mode==="LOCAL_PERPETUAL","Perpetual offer requires explicit local perpetual mode");
export const LicenseOfferV2Schema=z.strictObject({...fields,profile:z.literal("CAMACHO_LICENSE_OFFER_V2"),currency_code:z.literal("COP"),currency_exponent:z.literal(2),
  publication_scope:z.literal("PREPRODUCTION"),support_charge:z.enum(["OPTIONAL_SAME_TERM","OPTIONAL_12_MONTHS"]),support_term_months:z.number().int().min(1).max(12),
}).refine(p=>p.billing_model==="PERPETUAL"?p.deployment_mode==="LOCAL_PERPETUAL"&&p.support_charge==="OPTIONAL_12_MONTHS"&&p.support_term_months===12:
  p.deployment_mode==="HYBRID"&&p.support_charge==="OPTIONAL_SAME_TERM"&&p.support_term_months===(p.billing_model==="MONTHLY"?1:12),"Offer term/support model mismatch");
export const LicenseOfferDraftSchema=z.union([legacy,LicenseOfferV2Schema]);
export const PublicLicenseOfferSchema=LicenseOfferV2Schema.safeExtend({version:z.number().int().positive(),published_at:z.iso.datetime(),status:z.literal("ACTIVE"),tax_status:z.literal("PENDING"),purchase_enabled:z.literal(false)});
export const PublicLicenseCatalogSchema=z.strictObject({profile:z.literal("CAMACHO_PUBLIC_LICENSE_CATALOG_V1"),offers:z.array(PublicLicenseOfferSchema).max(256)});
export type PublicLicenseOffer=z.infer<typeof PublicLicenseOfferSchema>;
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
    ...("profile" in p?{currency_exponent:p.currency_exponent,term_months:p.billing_model==="MONTHLY"?1:p.billing_model==="ANNUAL"?12:null,support_term_months:p.support_term_months}:{}),
    tax_status:"NOT_CALCULATED" as const,payment_status:"NOT_REQUESTED" as const,activation_status:"NOT_ACTIVATED" as const};
}
/** Exact COP input/display; separators are presentation, arithmetic is BigInt. */
export function parseCopPesos(value:string):number{
  if(!/^(?:0|[1-9][0-9]*|[1-9][0-9]{0,2}(?:\.[0-9]{3})+)(?:,[0-9]{1,2})?$/.test(value))throw Error("Indica pesos COP válidos; usa coma para centavos.");
  const [whole,fraction=""]=value.replace(/\./g,"").split(","),minor=BigInt(whole!)*100n+BigInt(fraction.padEnd(2,"0"));
  if(minor>BigInt(Number.MAX_SAFE_INTEGER))throw Error("Importe COP fuera de rango.");return Number(minor);
}
export function formatCopPesos(minor:number):string{
  if(!Number.isSafeInteger(minor)||minor<0)throw Error("Invalid COP minor amount");const amount=BigInt(minor),fraction=amount%100n;
  return new Intl.NumberFormat("es-CO").format(amount/100n)+(fraction===0n?"":","+fraction.toString().padStart(2,"0"));
}
/** Versioned calendar terms use UTC persistence, clamping the last day. */
export function addLicenseCalendarMonths(start:string,months:number):string{
  const at=new Date(start);if(!Number.isFinite(at.getTime())||!Number.isInteger(months)||months<1||months>120)throw Error("Explicit calendar term required");
  const day=at.getUTCDate();at.setUTCDate(1);at.setUTCMonth(at.getUTCMonth()+months);const end=new Date(at);end.setUTCMonth(end.getUTCMonth()+1);end.setUTCDate(0);
  at.setUTCDate(Math.min(day,end.getUTCDate()));return at.toISOString();
}

export type PublicLicenseCatalog=z.infer<typeof PublicLicenseCatalogSchema>;
