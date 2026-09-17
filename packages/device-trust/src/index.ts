import { createPublicKey, verify, type KeyObject } from "node:crypto";
import {
  DeviceTrustChallengeSchema,
  DeviceTrustCredentialClaimsSchema,
  DeviceTrustOperationalKeyClaimsSchema,
  DeviceTrustProofSchema,
  SignedDeviceTrustCredentialSchema,
  SignedDeviceTrustOperationalKeySchema,
  type DeviceTrustChallenge,
  type DeviceTrustCredentialClaims,
  type DeviceTrustOperationalKeyClaims,
} from "@pos-platform/contracts";

export interface DeviceTrustClock {
  now(): Date;
  accept(now: Date): void;
}

export interface DeviceTrustBinding {
  readonly tenantId: string;
  readonly companyId: string;
  readonly installationId: string;
  readonly deviceId: string;
}

export interface TrustedDeviceTrustKey {
  readonly key: KeyObject;
  readonly status: "ACTIVE" | "VERIFY_ONLY" | "REVOKED";
  readonly validFrom: string;
}

export type DeviceTrustDecision =
  | "VALID" | "UNKNOWN_KEY" | "KEY_REVOKED" | "KEY_NOT_YET_VALID"
  | "KEY_PURPOSE_MISMATCH" | "CREDENTIAL_SIGNATURE_INVALID"
  | "CREDENTIAL_BINDING_MISMATCH" | "CREDENTIAL_NOT_YET_VALID"
  | "CREDENTIAL_EXPIRED" | "PROOF_SIGNATURE_INVALID"
  | "CHALLENGE_BINDING_MISMATCH" | "CHALLENGE_EXPIRED";

export interface DeviceTrustVerificationResult<T> {
  readonly decision: DeviceTrustDecision;
  readonly value: T | null;
  readonly evaluatedAt: string;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite numbers are not valid trust payloads");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  throw new Error("unsupported trust payload value");
}

export function unsignedDeviceTrustOperationalKeyBytes(claims: DeviceTrustOperationalKeyClaims): Buffer {
  return Buffer.from(canonicalJson(DeviceTrustOperationalKeyClaimsSchema.parse(claims)));
}

export function unsignedDeviceTrustCredentialBytes(claims: DeviceTrustCredentialClaims): Buffer {
  return Buffer.from(canonicalJson(DeviceTrustCredentialClaimsSchema.parse(claims)));
}

export function unsignedDeviceTrustChallengeBytes(challenge: DeviceTrustChallenge): Buffer {
  return Buffer.from(canonicalJson(DeviceTrustChallengeSchema.parse(challenge)));
}

export class DeviceTrustVerifier {
  constructor(
    private readonly rootTrustAnchor: KeyObject,
    private readonly operationalKeys: ReadonlyMap<string, TrustedDeviceTrustKey>,
    private readonly clock: DeviceTrustClock,
  ) {}

  verifyOperationalKey(input: unknown): DeviceTrustVerificationResult<DeviceTrustOperationalKeyClaims> {
    const evaluatedAt = this.evaluatedAt();
    const signed = SignedDeviceTrustOperationalKeySchema.parse(input);
    const claims = signed.claims;
    if (claims.key_purpose !== "DEVICE_TRUST") return this.result("KEY_PURPOSE_MISMATCH", null, evaluatedAt);
    if (claims.status === "REVOKED") return this.result("KEY_REVOKED", null, evaluatedAt);
    if (evaluatedAt.getTime() < Date.parse(claims.valid_from)) return this.result("KEY_NOT_YET_VALID", null, evaluatedAt);
    if (!verify(null, unsignedDeviceTrustOperationalKeyBytes(claims), this.rootTrustAnchor, Buffer.from(signed.signature, "base64url"))) {
      return this.result("CREDENTIAL_SIGNATURE_INVALID", null, evaluatedAt);
    }
    return this.result("VALID", claims, evaluatedAt);
  }

  verifyCredential(input: unknown, binding: DeviceTrustBinding): DeviceTrustVerificationResult<DeviceTrustCredentialClaims> {
    const evaluatedAt = this.evaluatedAt();
    const signed = SignedDeviceTrustCredentialSchema.parse(input);
    const claims = signed.claims;
    const operationalKey = this.operationalKeys.get(claims.key_id);
    if (!operationalKey) return this.result("UNKNOWN_KEY", null, evaluatedAt);
    if (operationalKey.status === "REVOKED") return this.result("KEY_REVOKED", null, evaluatedAt);
    if (evaluatedAt.getTime() < Date.parse(operationalKey.validFrom)) return this.result("KEY_NOT_YET_VALID", null, evaluatedAt);
    if (!verify(null, unsignedDeviceTrustCredentialBytes(claims), operationalKey.key, Buffer.from(signed.signature, "base64url"))) {
      return this.result("CREDENTIAL_SIGNATURE_INVALID", null, evaluatedAt);
    }
    if (claims.tenant_id !== binding.tenantId || claims.company_id !== binding.companyId || claims.installation_id !== binding.installationId || claims.device_id !== binding.deviceId) {
      return this.result("CREDENTIAL_BINDING_MISMATCH", claims, evaluatedAt);
    }
    const time = evaluatedAt.getTime();
    if (time < Date.parse(claims.not_before)) return this.result("CREDENTIAL_NOT_YET_VALID", claims, evaluatedAt);
    if (claims.expires_at !== null && time > Date.parse(claims.expires_at)) return this.result("CREDENTIAL_EXPIRED", claims, evaluatedAt);
    return this.result("VALID", claims, evaluatedAt);
  }

  verifyProof(credentialInput: unknown, challengeInput: unknown, proofInput: unknown, binding: DeviceTrustBinding): DeviceTrustVerificationResult<DeviceTrustCredentialClaims> {
    const evaluatedAt = this.evaluatedAt();
    const credential = this.verifyCredential(credentialInput, binding);
    if (credential.decision !== "VALID" || !credential.value) return this.result(credential.decision, credential.value, evaluatedAt);
    const challenge = DeviceTrustChallengeSchema.parse(challengeInput);
    const proof = DeviceTrustProofSchema.parse(proofInput);
    const claims = credential.value;
    if (challenge.tenant_id !== binding.tenantId || challenge.installation_id !== binding.installationId || challenge.device_id !== binding.deviceId || proof.credential_id !== claims.credential_id || proof.key_id !== claims.key_id || proof.challenge_id !== challenge.challenge_id) {
      return this.result("CHALLENGE_BINDING_MISMATCH", claims, evaluatedAt);
    }
    const time = evaluatedAt.getTime();
    if (time < Date.parse(challenge.issued_at) || time > Date.parse(challenge.expires_at)) return this.result("CHALLENGE_EXPIRED", claims, evaluatedAt);
    const devicePublicKey = createPublicKey(claims.device_public_key_pem);
    if (!verify(null, unsignedDeviceTrustChallengeBytes(challenge), devicePublicKey, Buffer.from(proof.signature, "base64url"))) {
      return this.result("PROOF_SIGNATURE_INVALID", claims, evaluatedAt);
    }
    return this.result("VALID", claims, evaluatedAt);
  }

  private evaluatedAt(): Date {
    const value = this.clock.now();
    this.clock.accept(value);
    return value;
  }

  private result<T>(decision: DeviceTrustDecision, value: T | null, evaluatedAt: Date): DeviceTrustVerificationResult<T> {
    return { decision, value, evaluatedAt: evaluatedAt.toISOString() };
  }
}
