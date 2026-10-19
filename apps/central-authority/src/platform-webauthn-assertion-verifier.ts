import {
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
  type WebAuthnCredential,
} from "@simplewebauthn/server";
import { isPlatformWebAuthnCredentialReference } from "@pos-platform/contracts";
import type {
  LockedPlatformWebAuthnChallenge,
  VerifiedPlatformWebAuthnFactorReference,
} from "@pos-platform/database-postgres";

/**
 * Public material resolved ONLY by the Central Authority's trusted credential
 * storage, never from HTTP JSON. A WebAuthn public key is not a private key.
 *
 * This is a proposed v1 material contract, not yet a deployed secret manager.
 * Its counter must be updated by a trusted compare-and-swap before granting MFA.
 */
export interface PlatformWebAuthnCredentialMaterialV1 {
  readonly schemaVersion: 1;
  readonly secretReference: string;
  readonly credentialId: string;
  readonly publicKeyCoseBase64url: string;
  readonly counter: number;
}

export interface PlatformWebAuthnExpectedRp {
  readonly rpId: string;
  readonly origin: string;
}

export interface VerifiedPlatformWebAuthnAssertion {
  readonly newCounter: number;
  readonly userVerified: true;
  readonly credentialDeviceType: "singleDevice" | "multiDevice";
  readonly credentialBackedUp: boolean;
}

function decodeCanonicalBase64url(value: string, minLength: number, maxLength: number): Uint8Array<ArrayBuffer> | null {
  if (!/^[a-zA-Z0-9_-]+$/.test(value) || value.length > maxLength * 2) return null;
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length < minLength || decoded.length > maxLength
    || decoded.toString("base64url") !== value) return null;
  // WebAuthnCredential expects an ArrayBuffer-backed Uint8Array, not Buffer<ArrayBufferLike>.
  const bytes = new Uint8Array(new ArrayBuffer(decoded.byteLength));
  bytes.set(decoded);
  return bytes;
}

/**
 * Genuine WebAuthn assertion verification against a verified MFA factor and
 * public credential fetched from trusted storage. Never asserts login success,
 * approves recovery, or marks MFA SATISFIED. The caller must atomically commit
 * the returned counter, challenge consumption and security audit before
 * issuing any authenticated administrative context.
 */
export async function verifyPlatformWebAuthnAssertion(input: {
  readonly response: AuthenticationResponseJSON;
  readonly challenge: LockedPlatformWebAuthnChallenge;
  readonly factor: VerifiedPlatformWebAuthnFactorReference;
  readonly material: PlatformWebAuthnCredentialMaterialV1;
  readonly rp: PlatformWebAuthnExpectedRp;
}): Promise<VerifiedPlatformWebAuthnAssertion | null> {
  const { response, challenge, factor, material, rp } = input;
  if (!challenge.factorId || challenge.factorId !== factor.factorId ||
      challenge.userId !== factor.userId ||
      !["AUTHENTICATE", "REAUTHENTICATE", "RECOVERY_APPROVAL"].includes(challenge.purpose) ||
      !isPlatformWebAuthnCredentialReference(factor.secretReference) ||
      material.schemaVersion !== 1 ||
      material.secretReference !== factor.secretReference ||
      typeof rp.rpId !== "string" || typeof rp.origin !== "string" ||
      challenge.rpId !== rp.rpId || challenge.expectedOrigin !== rp.origin) {
    return null;
  }
  const challengeBytes = decodeCanonicalBase64url(challenge.challenge, 32, 32);
  const idBytes = typeof material.credentialId === "string"
    ? decodeCanonicalBase64url(material.credentialId, 16, 1024) : null;
  const keyBytes = typeof material.publicKeyCoseBase64url === "string"
    ? decodeCanonicalBase64url(material.publicKeyCoseBase64url, 32, 2048) : null;
  if (!challengeBytes || !idBytes || !keyBytes ||
      typeof response !== "object" || response === null ||
      response.type !== "public-key" || response.id !== material.credentialId ||
      !Number.isSafeInteger(material.counter) || material.counter < 0 ||
      material.counter > 0xffffffff) {
    return null;
  }
  const credential: WebAuthnCredential = {
    id: material.credentialId,
    publicKey: keyBytes,
    counter: material.counter,
  };
  try {
    const verified = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedRPID: rp.rpId,
      expectedOrigin: rp.origin,
      credential,
      requireUserVerification: true,
    });
    if (!verified.verified || !verified.authenticationInfo.userVerified ||
        !Number.isSafeInteger(verified.authenticationInfo.newCounter) ||
        verified.authenticationInfo.newCounter < 0) return null;
    return {
      newCounter: verified.authenticationInfo.newCounter,
      userVerified: true,
      credentialDeviceType: verified.authenticationInfo.credentialDeviceType,
      credentialBackedUp: verified.authenticationInfo.credentialBackedUp,
    };
  } catch {
    // Wrong signature, origin, RP, challenge, UV, cloned counter or malformed
    // CBOR all fail closed. Do not include the credential or signature in logs.
    return null;
  }
}
