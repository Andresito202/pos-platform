import * as z from "zod";
import {SessionTrustCodeSchema} from "./session-trust.js";
import {UtcDateTimeSchema} from "./primitives.js";

const KeySchema=z.strictObject({
  key_id:SessionTrustCodeSchema,purpose:z.literal("AUTHORIZATION_SNAPSHOT"),
  public_key_pem:z.string().min(80).max(4096).regex(/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\r?\n?$/),
  status:z.enum(["ACTIVE","VERIFY_ONLY","REVOKED"]),version:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  valid_from:UtcDateTimeSchema,valid_until:UtcDateTimeSchema,
}).refine(k=>Date.parse(k.valid_until)>Date.parse(k.valid_from),"invalid key window");

/** Shared primitives, not a LAB or deployment profile. */
export const authorizationTrustFields={
  schema_version:z.literal(1),purpose:z.literal("AUTHORIZATION_SNAPSHOT"),
  issuer:z.url().refine(value=>{const url=new URL(value);return url.protocol==="https:"&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==="/";},"exact HTTPS issuer required"),
  authority_id:SessionTrustCodeSchema,generation:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),complete:z.literal(true),
  issued_at:UtcDateTimeSchema,valid_from:UtcDateTimeSchema,valid_until:UtcDateTimeSchema,keys:z.array(KeySchema).min(1).max(128),
};
export function validateAuthorizationTrustSet(c:{valid_from:string;valid_until:string;issued_at:string;keys:{key_id:string}[]},ctx:z.RefinementCtx){
  if(Date.parse(c.valid_until)<=Date.parse(c.valid_from)||Date.parse(c.issued_at)>Date.parse(c.valid_from))
    ctx.addIssue({code:"custom",message:"invalid bundle window"});
  if(new Set(c.keys.map(k=>k.key_id)).size!==c.keys.length)
    ctx.addIssue({code:"custom",message:"duplicate key identifier"});
}
