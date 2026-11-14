import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { describe, expect, it, vi } from "vitest";
import type { PostgresPlatformWebAuthnEnrollmentTransaction } from "@pos-platform/database-postgres";
import { enrollPlatformWebAuthnWithVerifiedRegistration } from "../src/platform-webauthn-enrollment-commit.js";
import { verifyPlatformWebAuthnRegistration } from "../src/platform-webauthn-registration-verifier.js";

vi.mock("../src/platform-webauthn-registration-verifier.js", () => ({
  verifyPlatformWebAuthnRegistration: vi.fn(),
}));

const input = {
  authorizationProof: "opaque-session-proof",
  challenge: "6ZCN58mdYr9D-8VZuQ-KWeDYEkIVTJqV6kjWRqp22ck",
  rpId: "admin.example.test",
  expectedOrigin: "https://admin.example.test",
};
const locked = {
  challenge: input.challenge, userId: "018f0000-0000-7000-8000-0000000000b4",
  sessionId: "018f0000-0000-7000-8000-0000000000e4",
  factorId: null, purpose: "ENROLL" as const,
  rpId: input.rpId, expectedOrigin: input.expectedOrigin,
};
const response = { type: "public-key", id: "cred" } as RegistrationResponseJSON;
const material = {
  credentialId: "credential",
  publicKeyCoseBase64url: "material",
  counter: 0, backupEligible: false, backedUp: false, userVerified: true as const,
};

describe("D3-R5.2e.2 internal Central Authority registration binding", () => {
  it("delegates WebAuthn proof to the existing verifier using the locked challenge", async () => {
    vi.mocked(verifyPlatformWebAuthnRegistration).mockResolvedValue(material);
    const enrolled = { userId: locked.userId, factorId: "factor", materialId: "material" };
    const commit = vi.fn(async (_input: unknown, verify: (challenge: typeof locked) => Promise<unknown>) => {
      expect(await verify(locked)).toEqual(material);
      return enrolled;
    });
    const result = await enrollPlatformWebAuthnWithVerifiedRegistration(
      { verifyAndEnroll: commit } as unknown as PostgresPlatformWebAuthnEnrollmentTransaction,
      input, response,
    );
    expect(result).toEqual(enrolled);
    expect(commit).toHaveBeenCalledWith(input, expect.any(Function));
    expect(verifyPlatformWebAuthnRegistration).toHaveBeenCalledWith({
      challenge: locked,
      trustedRp: { rpId: input.rpId, origin: input.expectedOrigin },
      response,
    });
  });

  it("preserves a rejected registration proof as null, without issuing sessions", async () => {
    vi.mocked(verifyPlatformWebAuthnRegistration).mockResolvedValue(null);
    const commit = vi.fn(async (_input: unknown, verify: (challenge: typeof locked) => Promise<unknown>) =>
      await verify(locked));
    const result = await enrollPlatformWebAuthnWithVerifiedRegistration(
      { verifyAndEnroll: commit } as unknown as PostgresPlatformWebAuthnEnrollmentTransaction,
      input, response,
    );
    expect(result).toBeNull();
  });
});
