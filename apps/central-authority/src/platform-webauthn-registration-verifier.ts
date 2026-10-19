import { verifyRegistrationResponse, type RegistrationResponseJSON } from "@simplewebauthn/server";
import type { LockedPlatformWebAuthnChallenge } from "@pos-platform/database-postgres";

export interface VerifiedPlatformWebAuthnRegistration {
  readonly credentialId: string;
  readonly publicKeyCoseBase64url: string;
  readonly counter: number;
  readonly backupEligible: boolean;
  readonly backedUp: boolean;
  readonly userVerified: true;
}

/**
 * INTERNAL pure WebAuthn registration verifier.
 * A trusted enrollment service must first lock a live ENROLL challenge with
 * a real, authenticated GLOBAL session for this user. Neither a request
 * userId nor this result grants factor activation or login.
 * No database write, HTTP endpoint or session elevation occurs here.
 */
export async function verifyPlatformWebAuthnRegistration(input: {
  readonly response: RegistrationResponseJSON;
  readonly challenge: LockedPlatformWebAuthnChallenge;
  readonly trustedRp: { readonly rpId: string; readonly origin: string };
}): Promise<VerifiedPlatformWebAuthnRegistration | null> {
  const { response, challenge, trustedRp } = input;
  if (challenge.purpose !== "ENROLL" ||
      challenge.factorId !== null ||
      challenge.sessionId === null ||
      challenge.rpId !== trustedRp.rpId ||
      challenge.expectedOrigin !== trustedRp.origin ||
      typeof challenge.challenge !== "string" ||
      !/^[A-Za-z0-9_-]+$/.test(challenge.challenge)) return null;
  const raw = Buffer.from(challenge.challenge, "base64url");
  if (raw.length !== 32 || raw.toString("base64url") !== challenge.challenge) return null;
  if (typeof response !== "object" || response === null ||
      response.type !== "public-key" ||
      typeof response.id !== "string") return null;

  try {
    const result = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedRPID: trustedRp.rpId,
      expectedOrigin: trustedRp.origin,
      requireUserVerification: true,
      supportedAlgorithmIDs: [-7],
    });
    if (!result.verified || !result.registrationInfo ||
        result.registrationInfo.userVerified !== true) return null;
    const { credential, credentialDeviceType, credentialBackedUp } = result.registrationInfo;
    if (!credential || credential.id !== response.id ||
        !Number.isSafeInteger(credential.counter) ||
        credential.counter < 0 || credential.counter > 0xffffffff) return null;
    const id = Buffer.from(credential.id, "base64url");
    const cose = Buffer.from(credential.publicKey);
    if (id.length < 16 || id.length > 1024 ||
        id.toString("base64url") !== credential.id ||
        cose.length < 32 || cose.length > 2048) return null;
    if (credentialBackedUp && credentialDeviceType !== "multiDevice") return null;
    return {
      credentialId: credential.id,
      publicKeyCoseBase64url: cose.toString("base64url"),
      counter: credential.counter,
      backupEligible: credentialDeviceType === "multiDevice",
      backedUp: credentialBackedUp,
      userVerified: true,
    };
  } catch {
    // Invalid attestation, origin, challenge, RP ID or UV fails closed.
    return null;
  }
}
