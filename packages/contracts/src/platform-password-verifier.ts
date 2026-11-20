/**
 * Shared PHC FORMAT contract for Central Authority and PostgreSQL persistence.
 * Profiles are benchmarked candidates, NOT production policy authorization.
 * This parser never attempts password verification or evaluates a caller's
 * identity. The trusted service must select a production profile separately.
 */
export const PlatformPasswordKdfProfiles = Object.freeze({
  "owasp-19m-t2-p1": { memoryCost: 19456, timeCost: 2, parallelism: 1 },
  "candidate-64m-t3-p1": { memoryCost: 65536, timeCost: 3, parallelism: 1 },
} as const);

export type PlatformPasswordKdfProfile = keyof typeof PlatformPasswordKdfProfiles;

function decodedBase64Length(value: string): number {
  // PHC uses unpadded standard base64; a remainder of one is impossible.
  return value.length % 4 === 1 ? -1 : Math.floor(value.length * 3 / 4);
}

/** Enforce Argon2id v19, known costs and minimum salt/digest sizes.
 * PHC parameter order is not semantically significant (node-argon2 writes m,p,t).
 * Duplicate, unknown, negative and oversized cost parameters fail closed.
 */
export function isSupportedPlatformPasswordVerifier(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 256) return false;
  const fields = /^\$argon2id\$v=19\$([^$]+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(value);
  if (!fields) return false;
  const [, encodedParameters, salt, digest] = fields;
  if (!encodedParameters || !salt || !digest) return false;
  const parts = encodedParameters.split(",");
  if (parts.length !== 3) return false;
  const params = new Map<string, string>();
  for (const part of parts) {
    const pair = /^([mtp])=([1-9][0-9]*)$/.exec(part);
    if (!pair || params.has(pair[1]!)) return false;
    params.set(pair[1]!, pair[2]!);
  }
  if (params.size !== 3) return false;
  const supported = Object.values(PlatformPasswordKdfProfiles).some(profile =>
    params.get("m") === String(profile.memoryCost) &&
    params.get("t") === String(profile.timeCost) &&
    params.get("p") === String(profile.parallelism));
  return supported && decodedBase64Length(salt) >= 16 && decodedBase64Length(digest) === 32;
}
