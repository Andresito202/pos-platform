import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import {
  type EnrollPlatformWebAuthnCredential,
  type EnrolledPlatformWebAuthnFactor,
  PostgresPlatformWebAuthnEnrollmentTransaction,
} from "@pos-platform/database-postgres";
import { verifyPlatformWebAuthnRegistration } from "./platform-webauthn-registration-verifier.js";

/**
 * INTERNAL ONLY. No HTTP entry point or authenticator is created here.
 * The transaction's resolver MUST validate control of a genuine, revocable,
 * server-issued session; a UUID or a fixture MFA flag is insufficient.
 * Trusted RP ID/origin come from Central Authority configuration, not JSON.
 */
export async function enrollPlatformWebAuthnWithVerifiedRegistration(
  transaction: PostgresPlatformWebAuthnEnrollmentTransaction,
  input: EnrollPlatformWebAuthnCredential,
  response: RegistrationResponseJSON,
): Promise<EnrolledPlatformWebAuthnFactor | null> {
  return transaction.verifyAndEnroll(input, (challenge) =>
    verifyPlatformWebAuthnRegistration({
      challenge, trustedRp: { rpId: input.rpId, origin: input.expectedOrigin }, response,
    }),
  );
}
