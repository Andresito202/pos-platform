import * as z from "zod";

/** Deployment HTTP V2 metadata. Proprietary possession proof, not OAuth DPoP.
 * The access token is never accepted without its separate fresh signed proof. */
export const CommercialHttpV2=Object.freeze({profile:"CAMACHO_COMMERCIAL_HTTP_V2",accessHeader:"x-commercial-business-access"} as const);

/** Device-bound access V2; a parsed claim is NOT proof of authentication. */
export const CommercialAccessClaimsSchema=z.strictObject({
  ver:z.literal(2),iss:z.string(),aud:z.string(),sub:z.uuid(),sid:z.uuid(),tid:z.uuid(),mid:z.uuid(),did:z.uuid(),iid:z.uuid(),cid:z.uuid(),
  client_id:z.string(),fid:z.uuid(),iat:z.number().int().nonnegative(),exp:z.number().int().positive(),jti:z.uuid(),
  cnf:z.strictObject({jkt:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}),
});
export const CommercialAccessHeaderSchema=z.strictObject({alg:z.literal("EdDSA"),typ:z.literal("at+jwt"),kid:z.string().min(1).max(128)});
export type CommercialAccessClaims=z.infer<typeof CommercialAccessClaimsSchema>;
export const CommercialRefreshRequestSchema=z.strictObject({
  grant_type:z.literal("refresh_token"),client_id:z.string().min(1).max(128),refresh_token:z.string().regex(/^[A-Za-z0-9_-]{64}$/),
});
