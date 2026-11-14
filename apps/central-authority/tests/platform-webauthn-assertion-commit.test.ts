import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import type {
  CommitPlatformWebAuthnAssertion, LockedPlatformWebAuthnProofContext,
  PlatformWebAuthnProofToCommit, PostgresPlatformWebAuthnAssertionTransaction,
} from "@pos-platform/database-postgres";
import { describe, expect, it, vi } from "vitest";
import { commitPlatformWebAuthnProof } from "../src/platform-webauthn-assertion-commit.js";
import { verifyPlatformWebAuthnAssertion } from "../src/platform-webauthn-assertion-verifier.js";

vi.mock("../src/platform-webauthn-assertion-verifier.js", () => ({
  verifyPlatformWebAuthnAssertion: vi.fn(),
}));

const USER = "018f0000-0000-7000-8000-0000000000b4";
const FACTOR = "018f0000-0000-7000-8000-0000000000d4";
const SESSION = "018f0000-0000-7000-8000-0000000000e4";
const MATERIAL_ID = "018f0000-0000-7000-8000-0000000000a4";
const REF = "webauthn:v1:" + MATERIAL_ID;
const RP = { rpId: "admin.example.test", origin: "https://admin.example.test" };
const response: AuthenticationResponseJSON = {
  type: "public-key", id: "fixture", rawId: "fixture", clientExtensionResults: {},
  response: { clientDataJSON: "", authenticatorData: "", signature: "" },
};
const request = {
  userId: USER, factorId: FACTOR, sessionId: SESSION,
  challenge: Buffer.alloc(32, 1).toString("base64url"),
  purpose: "REAUTHENTICATE" as const, response,
};

function fixture() {
  const verifyAndCommit = vi.fn(async (
    _query: CommitPlatformWebAuthnAssertion,
    callback: (ctx: LockedPlatformWebAuthnProofContext) => Promise<PlatformWebAuthnProofToCommit | null>,
  ): Promise<boolean> => {
    const result = await callback({
      challenge: { challenge: request.challenge, userId: USER, factorId: FACTOR,
        sessionId: SESSION, purpose: "REAUTHENTICATE", rpId: RP.rpId, expectedOrigin: RP.origin },
      material: { schemaVersion: 1, userId: USER, factorId: FACTOR, materialId: MATERIAL_ID,
        secretReference: REF, credentialId: "fixture", publicKeyCoseBase64url: "fixture",
        counter: 0, version: 1, backupEligible: false, backedUp: false },
    });
    return result !== null;
  });
  const coordinator = { verifyAndCommit } as unknown as PostgresPlatformWebAuthnAssertionTransaction;
  return { verifyAndCommit, coordinator };
}

describe("Central Authority binds genuine WebAuthn verification to atomic commit", () => {
  it("passes trusted RP and server-locked credential material, returning boolean only", async () => {
    const f = fixture();
    vi.mocked(verifyPlatformWebAuthnAssertion).mockResolvedValueOnce({
      newCounter: 4, userVerified: true, credentialBackedUp: false,
      credentialDeviceType: "singleDevice",
    });
    expect(await commitPlatformWebAuthnProof(f.coordinator, request, RP)).toBe(true);
    expect(f.verifyAndCommit).toHaveBeenCalledOnce();
    expect(f.verifyAndCommit.mock.calls[0]?.[0]).toMatchObject({
      userId: USER, factorId: FACTOR, sessionId: SESSION, rpId: RP.rpId, expectedOrigin: RP.origin,
    });
    expect(vi.mocked(verifyPlatformWebAuthnAssertion)).toHaveBeenCalledWith(expect.objectContaining({
      response, rp: RP, factor: { userId: USER, factorId: FACTOR, secretReference: REF },
    }));
  });

  it("passes a failed cryptographic verification through as false, without making MFA state", async () => {
    const f = fixture();
    vi.mocked(verifyPlatformWebAuthnAssertion).mockResolvedValueOnce(null);
    expect(await commitPlatformWebAuthnProof(f.coordinator, request, RP)).toBe(false);
    expect(f.verifyAndCommit).toHaveBeenCalledOnce();
  });
});
