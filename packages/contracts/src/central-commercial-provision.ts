import * as z from "zod";
import {UuidSchema,UtcDateTimeSchema} from "./primitives.js";
import {AuthorizationTrustRecipientSchema} from "./authorization-trust.js";
const path=z.string().min(1).max(4096),ms=z.number().int().positive().max(2_147_483_647),hash=z.string().regex(/^[a-f0-9]{64}$/);
export const CentralCommercialProvisionSchema=z.strictObject({
  profile:z.literal("CAMACHO_CENTRAL_COMMERCIAL_V2"),environment:z.enum(["PREPRODUCTION","PRODUCTION"]),
  expected_database:z.string().min(1),schema_checksums:z.record(z.string(),hash),policy_reference:z.string().min(1).max(128),
  registration:z.strictObject({clientId:z.string(),redirectUri:z.string(),authorizationOrigin:z.string(),platform:z.literal("ELECTRON")}),
  rp_id:z.string(),recipient:AuthorizationTrustRecipientSchema,factor_id:UuidSchema,membership_id:UuidSchema,
  rejection_verifier_file:path,
  access:z.strictObject({private_key_file:path,public_key_file:path,key_id:z.string().min(1).max(128),audience:z.string().min(1).max(128),valid_from:UtcDateTimeSchema,valid_until:UtcDateTimeSchema}),
  ssa:z.strictObject({private_key_file:path,root_public_key_file:path,root_spki_sha256:hash,operational_key_file:path}),
  sas:z.strictObject({private_key_file:path,root_public_key_file:path,root_spki_sha256:hash,trust_bundle_file:path,authority_id:z.string().min(1),key_id:z.string().min(1)}),
  limits:z.strictObject({session_ms:ms,mfa_age_ms:ms,reauthentication_ms:ms,context_age_ms:ms,mfa_challenge_ms:ms,handoff_ms:ms,
    browser_ms:ms,browser_idle_ms:ms,refresh_family_ms:ms,access_ms:ms,proof_skew_ms:ms.max(120000),rotation_window_ms:ms,maximum_rotations:ms,
    native_challenge_ms:ms,native_request_ms:ms,native_code_ms:ms,maximum_challenges_per_minute:ms,maximum_login_attempts:ms,
    http_maximum_body_bytes:ms,http_requests_per_minute:ms,sas_ms:ms,ssa_claim_age_ms:ms,ssa_offline_ms:ms,sql_lock_timeout_ms:ms}),
}).superRefine((p,c)=>{
  if(p.limits.mfa_age_ms>p.limits.session_ms||p.limits.reauthentication_ms>p.limits.session_ms||p.limits.browser_idle_ms>p.limits.browser_ms||
    p.limits.access_ms>p.limits.refresh_family_ms||Date.parse(p.access.valid_until)<=Date.parse(p.access.valid_from))c.addIssue({code:"custom",message:"Invalid explicit commercial policy ordering"});
});
