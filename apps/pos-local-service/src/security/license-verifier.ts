import { verify, type KeyObject } from "node:crypto";
import { LicenseClaimsSchema, SignedLicenseSchema, type LicenseClaims, type SignedLicense } from "@pos-platform/contracts";
import { canonicalJson } from "../channel/canonical-json.js";

export type LicenseDecision = "VALID" | "VALID_OFFLINE_GRACE" | "NOT_YET_VALID" | "EXPIRED" | "BINDING_MISMATCH" | "SIGNATURE_INVALID";
export interface LicenseBinding { readonly installationId:string; readonly deviceId:string; }

export class LicenseVerifier {
  constructor(private readonly keys:ReadonlyMap<string,KeyObject>){}
  verify(input:unknown,binding:LicenseBinding,now:Date,online:boolean):{decision:LicenseDecision;claims:LicenseClaims|null}{
    const signed=SignedLicenseSchema.parse(input); const claims=LicenseClaimsSchema.parse(signed.claims);
    const key=this.keys.get(claims.key_id); if(!key)return{decision:"SIGNATURE_INVALID",claims:null};
    const valid=verify(null,Buffer.from(canonicalJson(claims)),key,Buffer.from(signed.signature,"base64url"));
    if(!valid)return{decision:"SIGNATURE_INVALID",claims:null};
    if(claims.installation_id!==binding.installationId||claims.device_id!==binding.deviceId)return{decision:"BINDING_MISMATCH",claims};
    const time=now.getTime(); if(time<Date.parse(claims.not_before))return{decision:"NOT_YET_VALID",claims};
    if(claims.expires_at===null||time<=Date.parse(claims.expires_at))return{decision:"VALID",claims};
    if(!online&&claims.offline_grace_until!==null&&time<=Date.parse(claims.offline_grace_until))return{decision:"VALID_OFFLINE_GRACE",claims};
    return{decision:"EXPIRED",claims};
  }
}
export function unsignedLicenseBytes(claims:LicenseClaims):Buffer{return Buffer.from(canonicalJson(LicenseClaimsSchema.parse(claims)));}
export type { SignedLicense };
