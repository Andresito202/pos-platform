import { timingSafeEqual } from "node:crypto";
import { validateNativeClientRegistration, type NativeClientRegistration } from "./native-authorization-constraints.js";

/**
 * Pre-exchange desktop callback validation only.
 * Caller MUST keep expectedState in a privileged native host, use a verified
 * loopback listener, and consume that state at most once in its own durable
 * or single-process state machine. This function neither consumes a state
 * nor validates an authorization code with a central identity server.
 */
export interface TrustedNativeCallbackExpectation {
  readonly registration: NativeClientRegistration;
  readonly state: string;
}

export interface NativeAuthorizationCodeCandidate {
  readonly code: string;
  readonly clientId: string;
}

function equalSecrets(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function inspectNativeAuthorizationCallback(
  callbackUrl: string,
  expectation: TrustedNativeCallbackExpectation,
): NativeAuthorizationCodeCandidate | null {
  const registration = validateNativeClientRegistration(expectation?.registration);
  if (typeof expectation.state !== "string" ||
      !/^[A-Za-z0-9_-]{32,256}$/.test(expectation.state)) {
    throw new Error("NATIVE_CALLBACK_STATE_POLICY_REQUIRED");
  }
  if (typeof callbackUrl !== "string" || callbackUrl.length > 4096) return null;
  let actual: URL;
  try { actual = new URL(callbackUrl); }
  catch { return null; }
  if (actual.origin !== new URL(registration.redirectUri).origin ||
      actual.pathname !== "/callback" || actual.hash ||
      actual.username || actual.password) return null;
  const params = [...actual.searchParams.entries()];
  if (params.length !== 2 || params.some(([key]) => key !== "code" && key !== "state")) return null;
  const code = actual.searchParams.getAll("code");
  const state = actual.searchParams.getAll("state");
  if (code.length !== 1 || state.length !== 1) return null;
  if (!/^[A-Za-z0-9._~-]{16,512}$/.test(code[0]!) ||
      !/^[A-Za-z0-9_-]{32,256}$/.test(state[0]!) ||
      !equalSecrets(state[0]!, expectation.state)) return null;
  // No raw code is logged, serialized into a redirect, or regarded as access.
  return Object.freeze({ code: code[0]!, clientId: registration.clientId });
}
