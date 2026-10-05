import { verify, type KeyObject } from "node:crypto";
import {
  LicenseClaimsSchema,
  SignedLicenseSchema,
  type LicenseClaims,
  type SignedLicense,
} from "@pos-platform/contracts";
import { canonicalJson } from "../channel/canonical-json.js";
import type { TrustedClockGuard } from "./trusted-clock.js";

export type LicenseDecision =
  | "VALID"
  | "VALID_OFFLINE_GRACE"
  | "NOT_YET_VALID"
  | "EXPIRED"
  | "BINDING_MISMATCH"
  | "SIGNATURE_INVALID"
  | "SIGNING_KEY_REVOKED";

export type TrustedSigningKeyStatus = "ACTIVE" | "VERIFY_ONLY" | "REVOKED";
export interface TrustedSigningKey {
  readonly key: KeyObject;
  readonly status: TrustedSigningKeyStatus;
  /** Optional lifecycle window for trust domains that rotate operational keys. */
  readonly validFrom?: string;
  readonly validUntil?: string | null;
}
export interface LicenseBinding {
  readonly installationId: string;
  readonly deviceId: string;
}

export interface LicenseVerificationResult {
  readonly decision: LicenseDecision;
  readonly claims: LicenseClaims | null;
  readonly evaluatedAt: string;
}

export class LicenseVerifier {
  constructor(
    private readonly keys: ReadonlyMap<string, TrustedSigningKey>,
    private readonly trustedClock: TrustedClockGuard,
    private readonly now: () => Date = () => new Date(),
  ) {}

  verify(input: unknown, binding: LicenseBinding, online: boolean): LicenseVerificationResult {
    const evaluatedAt = this.now();
    this.trustedClock.accept(evaluatedAt);

    const signed = SignedLicenseSchema.parse(input);
    const claims = LicenseClaimsSchema.parse(signed.claims);
    const trustedKey = this.keys.get(claims.key_id);
    if (!trustedKey) {
      return { decision: "SIGNATURE_INVALID", claims: null, evaluatedAt: evaluatedAt.toISOString() };
    }
    if (trustedKey.status === "REVOKED") {
      return { decision: "SIGNING_KEY_REVOKED", claims: null, evaluatedAt: evaluatedAt.toISOString() };
    }

    const valid = verify(
      null,
      Buffer.from(canonicalJson(claims)),
      trustedKey.key,
      Buffer.from(signed.signature, "base64url"),
    );
    if (!valid) {
      return { decision: "SIGNATURE_INVALID", claims: null, evaluatedAt: evaluatedAt.toISOString() };
    }
    if (claims.installation_id !== binding.installationId || claims.device_id !== binding.deviceId) {
      return { decision: "BINDING_MISMATCH", claims, evaluatedAt: evaluatedAt.toISOString() };
    }

    const time = evaluatedAt.getTime();
    if (time < Date.parse(claims.not_before)) {
      return { decision: "NOT_YET_VALID", claims, evaluatedAt: evaluatedAt.toISOString() };
    }
    if (claims.expires_at === null || time <= Date.parse(claims.expires_at)) {
      return { decision: "VALID", claims, evaluatedAt: evaluatedAt.toISOString() };
    }
    if (!online && claims.offline_grace_until !== null && time <= Date.parse(claims.offline_grace_until)) {
      return { decision: "VALID_OFFLINE_GRACE", claims, evaluatedAt: evaluatedAt.toISOString() };
    }
    return { decision: "EXPIRED", claims, evaluatedAt: evaluatedAt.toISOString() };
  }
}

export function unsignedLicenseBytes(claims: LicenseClaims): Buffer {
  return Buffer.from(canonicalJson(LicenseClaimsSchema.parse(claims)));
}
export type { SignedLicense };
