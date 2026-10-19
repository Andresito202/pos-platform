import { describe, expect, it, vi } from "vitest";
import type { PostgresPlatformWebAuthnAssertionTransaction } from "@pos-platform/database-postgres";
import { commitPlatformWebAuthnProof } from "../src/platform-webauthn-assertion-commit.js";
import { verifyPlatformWebAuthnAssertion } from "../src/platform-webauthn-assertion-verifier.js";

vi.mock("../src/platform-webauthn-assertion-verifier.js", () => ({
  verifyPlatformWebAuthnAssertion: vi.fn(),
}));

const USER = "018f0000-0000-7000-8000-0000000000b4";
const FACTOR = "018f0000-0000-7000-8000-0000000000d4";
const SESSION = "018f0000-0000-7000-8000-0000000000e4";
const REF = "webauthn:v1:018f0000-0000-7000-8000-0000000000a4";
const RP = { rpId: "admin.example.test", origin: "https://admin.example.test" };
const response = { type: "public-key" as const, id: "fixture", rawId: "fixture",
  clientExtensionResults: {}, response: { clientDataJSON: "", authenticatorData: "", signature: "" } };
const request = { userId: USER, factorId: FACTOR, sessionId: SESSION,
  challenge: Buffer.alloc(32, 1).toString("base64url"),
  purpose: "REAUTHENTICATE" as const, response };

function fixture() {
  const verifyAndCommit = vi.fn(async (_query, callback) => callback({
    challenge: { challenge: request.challenge, userId: USER, factorId: FACTOR,
      sessionId: SESSION, purpose: "REAUTHENTICATE", rpId: RP.rpId, expectedOrigin: RP.origin },
    material: { schemaVersion: 1, userId: USER, factorId: FACTOR, materialId: REF.slice(11),
      secretReference: REF, credentialId: "fixture", publicKeyCoseBase64url: "fixture",
      counter: 0, version: 1, backupEligible: false, backedUp: false },
  }));
  return { verifyAndCommit, coordinator: { verifyAndCommit } as unknown as PostgresPlatformWebAuthnAssertionTransaction };
}

describe("trusted Central Authority atomic WebAuthn proof boundary", () => {
  it("passes only server-stored factor material and trusted RP to crypto verifier", async () => {
    const f = fixture();
    vi.mocked(verifyPlatformWebAuthnAssertion).mockResolvedValueOnce({
      newCounter: 4, userVerified: true, credentialBackedUp: false,
      credentialDeviceType: "singleDevice",
    });
    const proof = await commitPlatformWebAuthnProof(f.coordinator, request, RP);
    expect(proof).toEqual({ userVerified: true, newCounter: 4, credentialBackedUp: false });
    expect(f.verifyAndCommit).toHaveBeenCalledOnce();
    expect(vi.mocked(verifyPlatformWebAuthnAssertion)).toHaveBeenCalledWith(expect.objectContaining({
      response, rp: RP, factor: { userId: USER, factorId: FACTOR, secretReference: REF },
    }));
  });

  it("does not produce a proof if cryptographic verification rejects the assertion", async () => {
    const f = fixture();
    vi.mocked(verifyPlatformWebAuthnAssertion).mockResolvedValueOnce(null);
    expect(await commitPlatformWebAuthnProof(f.coordinator, request, RP)).toBeNull();
    expect(f.verifyAndCommit).toHaveBeenCalledOnce();
  });
});
