import { argon2id, hash, verify } from "argon2";

/**
 * Trusted Central Authority only. No production KDF policy is selected here:
 * a caller must explicitly pass one of the benchmarked profiles after approval.
 * The local POS PIN and account-recovery tokens are not password verifiers.
 */
export type PlatformPasswordKdfProfile = "owasp-19m-t2-p1" | "candidate-64m-t3-p1";

const PROFILES = {
  "owasp-19m-t2-p1": { memoryCost: 19456, timeCost: 2, parallelism: 1 },
  "candidate-64m-t3-p1": { memoryCost: 65536, timeCost: 3, parallelism: 1 },
} as const;

function paramsFor(profile: PlatformPasswordKdfProfile) {
  const params = Object.prototype.hasOwnProperty.call(PROFILES, profile)
    ? PROFILES[profile] : undefined;
  if (!params) throw new Error("PLATFORM_PASSWORD_KDF_PROFILE_NOT_APPROVED");
  return params;
}

/** Accept only versioned Argon2id PHC with one of the evaluated profiles. */
export function isSupportedPlatformPasswordVerifier(value: string): boolean {
  if (typeof value !== "string" || value.length > 256) return false;
  const fields = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(value);
  if (!fields) return false;
  const [, memory, time, parallel, salt, digest] = fields;
  const recognized = Object.values(PROFILES).some(p =>
    Number(memory) === p.memoryCost && Number(time) === p.timeCost && Number(parallel) === p.parallelism);
  if (!recognized || !salt || !digest) return false;
  return Buffer.from(salt, "base64").length >= 16 && Buffer.from(digest, "base64").length === 32;
}

/** Only the central trusted service may invoke this with a selected policy. */
export async function createPlatformPasswordVerifier(
  password: string,
  profile: PlatformPasswordKdfProfile,
): Promise<string> {
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("PLATFORM_PASSWORD_EMPTY");
  }
  const verifier = await hash(password, {
    ...paramsFor(profile), type: argon2id, hashLength: 32, saltLength: 16,
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
