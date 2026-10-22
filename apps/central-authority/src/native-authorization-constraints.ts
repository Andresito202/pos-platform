import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Validation primitives for a prospective native authorization-code flow.
 * No code store, issuer, token, callback listener or production endpoint is
 * created here. An exact externally approved deployment policy is required.
 */
export interface NativeClientRegistration {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly authorizationOrigin: string;
}

function canonicalLoopbackRedirect(raw: string): boolean {
  try {
    const uri = new URL(raw);
    if (uri.protocol !== "http:" || uri.hostname !== "127.0.0.1" ||
        uri.username || uri.password || uri.hash || uri.search ||
        !uri.port || Number(uri.port) < 1 || Number(uri.port) > 65535 ||
        uri.pathname !== "/callback") return false;
    return uri.href === raw;
  } catch { return false; }
}

/** Rejects absent, ambiguous, wildcard or client-supplied registration. */
export function validateNativeClientRegistration(value: NativeClientRegistration): NativeClientRegistration {
  if (!value || !/^[A-Za-z0-9._~-]{1,128}$/.test(value.clientId) ||
      !canonicalLoopbackRedirect(value.redirectUri)) throw new Error("NATIVE_CLIENT_REGISTRATION_INVALID");
  let origin: URL;
  try { origin = new URL(value.authorizationOrigin); }
  catch { throw new Error("NATIVE_AUTHORIZATION_ORIGIN_INVALID"); }
  if (origin.protocol !== "https:" || !origin.hostname ||
      origin.username || origin.password || origin.pathname !== "/" ||
      origin.search || origin.hash || origin.origin !== value.authorizationOrigin ||
      origin.hostname === "localhost" || origin.hostname.endsWith(".localhost") ||
      origin.hostname === "127.0.0.1") throw new Error("NATIVE_AUTHORIZATION_ORIGIN_INVALID");
  return Object.freeze({ clientId: value.clientId, redirectUri: value.redirectUri, authorizationOrigin: value.authorizationOrigin });
}

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
