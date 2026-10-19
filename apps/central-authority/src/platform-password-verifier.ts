import { randomBytes } from "node:crypto";
import { argon2id, hash, verify } from "argon2";
import {
  PlatformPasswordKdfProfiles,
  isSupportedPlatformPasswordVerifier,
  type PlatformPasswordKdfProfile,
} from "@pos-platform/contracts";

export { isSupportedPlatformPasswordVerifier } from "@pos-platform/contracts";
export type { PlatformPasswordKdfProfile } from "@pos-platform/contracts";

/**
 * Trusted Central Authority only. No production KDF policy is selected here:
 * a caller must explicitly pass a benchmarked profile after approval.
 * The local POS PIN and account-recovery tokens are not password verifiers.
 */
function paramsFor(profile: PlatformPasswordKdfProfile) {
  const params = Object.prototype.hasOwnProperty.call(PlatformPasswordKdfProfiles, profile)
    ? PlatformPasswordKdfProfiles[profile] : undefined;
  if (!params) throw new Error("PLATFORM_PASSWORD_KDF_PROFILE_NOT_APPROVED");
  return params;
}

/** Only the trusted central service may invoke this with an approved policy. */
export async function createPlatformPasswordVerifier(
  password: string,
  profile: PlatformPasswordKdfProfile,
): Promise<string> {
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("PLATFORM_PASSWORD_EMPTY");
  }
  const verifier = await hash(password, {
    ...paramsFor(profile), type: argon2id, hashLength: 32, salt: randomBytes(16),
  });
  if (!isSupportedPlatformPasswordVerifier(verifier)) {
    throw new Error("PLATFORM_PASSWORD_VERIFIER_INVALID");
  }
  return verifier;
}

/** Fail closed on corrupt, unsupported or weak verifiers without logging them. */
export async function verifyPlatformPasswordVerifier(
  password: string,
  verifier: string,
): Promise<boolean> {
  if (typeof password !== "string" || !isSupportedPlatformPasswordVerifier(verifier)) return false;
  try {
    return await verify(verifier, password);
  } catch {
    return false;
  }
}
