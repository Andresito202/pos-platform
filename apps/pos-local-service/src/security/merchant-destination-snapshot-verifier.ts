import { createHash,verify, type KeyObject } from "node:crypto";
import * as z from "zod";
import { DestinationSnapshotSchema, type DestinationSnapshot, type DestinationProjectionScope } from "@pos-platform/domain";
import { canonicalJson } from "../channel/canonical-json.js";
import type { TrustedClockGuard } from "./trusted-clock.js";

const Uuid = z.string().uuid();
const Environment = z.enum(["PRODUCTION", "STAGING", "SANDBOX"]);
export const MERCHANT_DESTINATION_KEY_PURPOSE = "MERCHANT_DESTINATION_SNAPSHOT" as const;

/**
 * QR-001: signed company-wide destination, NOT a payment receipt.
 * The serialized claims are signed with the same canonicalJson/Ed25519 convention
 * as DEC-013, but with a separate key purpose.
 */
export const MerchantDestinationSignedClaimsSchema = z.strictObject({
  schema_version: z.literal(1),
  key_id: z.string().min(1).max(96).regex(/^[a-zA-Z0-9._-]+$/),
  environment: Environment,
  snapshot: DestinationSnapshotSchema,
});
export const SignedMerchantDestinationSnapshotSchema = z.strictObject({
  claims: MerchantDestinationSignedClaimsSchema,
  signature: z.string().min(80).max(128).regex(/^[A-Za-z0-9_-]+$/),
});
export type MerchantDestinationSignedClaims = z.infer<typeof MerchantDestinationSignedClaimsSchema>;

export interface MerchantDestinationTrustedKey {
  readonly key: KeyObject;
  readonly purpose: string;
  readonly status: "ACTIVE" | "VERIFY_ONLY" | "REVOKED";
  readonly validFrom?: string;
  readonly validUntil?: string | null;
}
export interface MerchantDestinationExpectedScope extends DestinationProjectionScope {
  readonly environment: z.infer<typeof Environment>;
}
export type MerchantDestinationSignatureDecision =
  | "VALID" | "INVALID_SCHEMA" | "UNKNOWN_KEY" | "WRONG_KEY_PURPOSE"
  | "REVOKED_KEY" | "KEY_OUTSIDE_LIFECYCLE" | "INVALID_SIGNATURE"
  | "WRONG_ENVIRONMENT" | "WRONG_SCOPE" | "NOT_YET_VALID" | "EXPIRED";
export type MerchantDestinationSignatureResult =
  | { readonly decision: "VALID"; readonly snapshot: DestinationSnapshot; readonly evaluatedAt: string }
  | { readonly decision: Exclude<MerchantDestinationSignatureDecision, "VALID">; readonly snapshot: null; readonly evaluatedAt: string };

export function unsignedMerchantDestinationBytes(input: MerchantDestinationSignedClaims): Buffer {
  return Buffer.from(canonicalJson(MerchantDestinationSignedClaimsSchema.parse(input)));
}
export class MerchantDestinationSnapshotVerifier {
  constructor(
    private readonly keys: ReadonlyMap<string, MerchantDestinationTrustedKey>,
    private readonly trustedClock: TrustedClockGuard,
    private readonly now: () => Date = () => new Date(),
  ) {}

  verify(input: unknown, scope: MerchantDestinationExpectedScope): MerchantDestinationSignatureResult {
    if (!Uuid.safeParse(scope.tenantId).success || !Uuid.safeParse(scope.companyId).success ||
        !Environment.safeParse(scope.environment).success) throw new Error("INVALID_EXPECTED_SCOPE");
    const date=this.now();
    this.trustedClock.accept(date);
    if (!Number.isFinite(date.getTime())) throw new Error("INVALID_CLOCK");
    const at=date.toISOString();
    const failure=(decision: Exclude<MerchantDestinationSignatureDecision,"VALID">): MerchantDestinationSignatureResult =>
      ({decision,snapshot:null,evaluatedAt:at});
    const parsed=SignedMerchantDestinationSnapshotSchema.safeParse(input);
    if(!parsed.success) return failure("INVALID_SCHEMA");
    const claims=parsed.data.claims;
    const key=this.keys.get(claims.key_id);
    if(!key) return failure("UNKNOWN_KEY");
    if(key.purpose!==MERCHANT_DESTINATION_KEY_PURPOSE) return failure("WRONG_KEY_PURPOSE");
    if(key.status==="REVOKED") return failure("REVOKED_KEY");
    const from=key.validFrom===undefined?null:Date.parse(key.validFrom);
    const until=key.validUntil==null?null:Date.parse(key.validUntil);
    // A corrupted key lifecycle is not an unrestricted permission.
    if ((from!==null && !Number.isFinite(from)) || (until!==null && !Number.isFinite(until)) ||
        (from!==null && until!==null && until<from) ||
        (from!==null && date.getTime()<from) ||
        (until!==null && date.getTime()>until)) return failure("KEY_OUTSIDE_LIFECYCLE");
    let valid=false;
    try {
      valid=verify(null,unsignedMerchantDestinationBytes(claims),key.key,Buffer.from(parsed.data.signature,"base64url"));
    }catch {valid=false;}
    if(!valid)return failure("INVALID_SIGNATURE");
    if(claims.environment!==scope.environment)return failure("WRONG_ENVIRONMENT");
    const snapshot=claims.snapshot;
    if(snapshot.tenant_id!==scope.tenantId || snapshot.company_id!==scope.companyId)return failure("WRONG_SCOPE");
    for(const destination of snapshot.destinations??(snapshot.destination?[snapshot.destination]:[])){
      const encoded=destination.qr_png_base64;
      if(destination.kind==="NEQUI_BUSINESS_QR" && encoded!==undefined){
        const png=Buffer.from(encoded,"base64");
        const pngMagic=Buffer.from([137,80,78,71,13,10,26,10]);
        if(png.length>1_048_576||png.length<57||!png.subarray(0,8).equals(pngMagic)||
           png.toString("base64")!==encoded||
           createHash("sha256").update(png).digest("hex")!==destination.qr_sha256)
          return failure("INVALID_SCHEMA");
      }
      if(destination.kind!=="NEQUI_BUSINESS_QR" && encoded!==undefined)
        return failure("INVALID_SCHEMA");
    }
    if(Date.parse(snapshot.issued_at)>date.getTime())return failure("NOT_YET_VALID");
    if(Date.parse(snapshot.expires_at)<=date.getTime())return failure("EXPIRED");
    return {decision:"VALID",snapshot,evaluatedAt:at};
  }
}
