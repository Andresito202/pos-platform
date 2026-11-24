import { createHash, timingSafeEqual } from "node:crypto";

export {validateNativeClientRegistration} from "@pos-platform/contracts";
export type {NativeClientRegistration} from "@pos-platform/contracts";

const verifierPattern = /^[A-Za-z0-9._~-]{43,128}$/;
const challengePattern = /^[A-Za-z0-9_-]{43}$/;

export function derivePkceS256Challenge(verifier: string): string {
  if (typeof verifier !== "string" || !verifierPattern.test(verifier)) throw new Error("PKCE_VERIFIER_INVALID");
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

/** Use only after a durable single-use code lookup, never as proof of code ownership alone. */
export function matchesPkceS256Challenge(verifier: string, expectedChallenge: string): boolean {
  if (typeof expectedChallenge !== "string" || !challengePattern.test(expectedChallenge)) return false;
  if (typeof verifier !== "string" || !verifierPattern.test(verifier)) return false;
  const actual = Buffer.from(derivePkceS256Challenge(verifier), "ascii");
  const expected = Buffer.from(expectedChallenge, "ascii");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
