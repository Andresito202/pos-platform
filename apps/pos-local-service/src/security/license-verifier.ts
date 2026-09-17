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
  /** Optional lifecycle window used by trust domains that rotate operational keys. */
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
    private readonly trustedSigningKeys: ReadonlyMap<string, TrustedSigningKey>,
    private readonly trustedClock: TrustedClockGuard,
    private readonly now: () => Date = () => new Date(),
  ) {}

  verify(input: unknown, binding: LicenseBinding): LicenseVerificationResult {
    const evaluatedAt = this.now();
    this.trustedClock.accept(evaluatedAt);
    const at = evaluatedAt.toISOString();
    const signed = SignedLicenseSchema.parse(input);
    const claims = LicenseClaimsSchema.parse(signed.claims);
    const trustedKey = this.trustedSigningKeys.get(claims.key_id);
    if (!trustedKey) return { decision: "SIGNATURE_INVALID", claims: null, evaluatedAt: at };
    if (trustedKey.status === "REVOKED") return { decision: "SIGNING_KEY_REVOKED", claims: null, evaluatedAt: at };

    let valid = false;
    try {
      valid = verify(
        null,
        Buffer.from(canonicalJson(claims)),
        trustedKey.key,
        Buffer.from(signed.signature, "base64url"),
      );
    } catch {
      valid = false;
    }
    if (!valid) return { decision: "SIGNATURE_INVALID", claims: null, evaluatedAt: at };

    if (claims.installation_id !== binding.installationId || claims.device_id !== binding.deviceId) {
      return { decision: "BINDING_MISMATCH", claims, evaluatedAt: at };
    }
    return { decision: "VALID", claims, evaluatedAt: at };
  }
}

export function unsignedLicenseBytes(claims: LicenseClaims): Buffer {
  return Buffer.from(canonicalJson(LicenseClaimsSchema.parse(claims)));
}
export type { SignedLicense };
