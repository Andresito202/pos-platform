import { describe, expect, it } from "vitest";
import {
  PLATFORM_WEBAUTHN_REFERENCE_PREFIX,
  isPlatformWebAuthnCredentialReference,
} from "../src/index.js";

describe("opaque Central Authority WebAuthn credential reference v1", () => {
  it("accepts only exact versioned UUIDv7 handles", () => {
    expect(PLATFORM_WEBAUTHN_REFERENCE_PREFIX).toBe("webauthn:v1:");
    expect(isPlatformWebAuthnCredentialReference("webauthn:v1:018f0000-0000-7000-8000-0000000000a4")).toBe(true);
  });

  it("rejects URLs, paths, malformed IDs and unapproved versions", () => {
    for (const input of [
      null, "", "webauthn:v1:", "webauthn:v1:../../secret",
      "webauthn:v2:018f0000-0000-7000-8000-0000000000a4",
      "https://vault.example.test/credential",
      "webauthn:v1:018f0000-0000-4000-8000-0000000000a4",
      "WEBAUTHN:V1:018f0000-0000-7000-8000-0000000000a4",
    ]) expect(isPlatformWebAuthnCredentialReference(input)).toBe(false);
  });
});
