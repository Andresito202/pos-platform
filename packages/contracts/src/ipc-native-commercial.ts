import * as z from "zod";
import {createRequestEnvelopeSchema,createResponseEnvelopeSchema} from "./envelope.js";
import {UuidV7Schema} from "./primitives.js";

// Privileged main↔Service only. Deliberately absent from the renderer allowlist.
const opaque=z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const metadata={request_id:UuidV7Schema,correlation_id:UuidV7Schema};
function request<T extends z.ZodType>(payload:T){return createRequestEnvelopeSchema(payload).superRefine((value,context)=>{
  for(const key of ["tenant_id","company_id","branch_id","device_id","actor_id","operation_id","idempotency_key","expected_version"] as const)
    if(value[key]!==undefined)context.addIssue({code:"custom",path:[key],message:"Native authority derives context from trusted provisioning"});
});}
export const NativeCommercialBeginRequestSchema=request(z.strictObject({
  code_challenge:opaque,state:opaque,
})).safeExtend({...metadata,message_type:z.literal("commercial.native.begin")});
export const NativeCommercialCompleteRequestSchema=request(z.strictObject({
  attempt_id:opaque,code:z.string().regex(/^[A-Za-z0-9._~-]{16,512}$/),
  code_verifier:z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),state:opaque,
})).safeExtend({...metadata,message_type:z.literal("commercial.native.complete")});
export const NativeCommercialCancelRequestSchema=request(z.strictObject({attempt_id:opaque}))
  .safeExtend({...metadata,message_type:z.literal("commercial.native.cancel")});
export const NativeCommercialCommitRequestSchema=request(z.strictObject({attempt_id:opaque}))
  .safeExtend({...metadata,message_type:z.literal("commercial.native.commit")});
export const NativeCommercialLogoutRequestSchema=request(z.strictObject({}))
  .safeExtend({...metadata,message_type:z.literal("commercial.native.logout")});
export const NativeCommercialResponseSchema=createResponseEnvelopeSchema(z.strictObject({
  outcome:z.enum(["PREPARED","VERIFIED","ACTIVATED","CANCELLED","SIGNED_OUT","SIGNED_OUT_LOCAL","DENIED"]),
  attempt_id:opaque.nullable(),authorization_url:z.url().startsWith("https://").max(2048).nullable(),
}));
export const NativeCommercialRequestSchema=z.discriminatedUnion("message_type",[
  NativeCommercialBeginRequestSchema,NativeCommercialCompleteRequestSchema,NativeCommercialCancelRequestSchema,NativeCommercialCommitRequestSchema,
  NativeCommercialLogoutRequestSchema,
]);
export type NativeCommercialRequest=z.infer<typeof NativeCommercialRequestSchema>;
