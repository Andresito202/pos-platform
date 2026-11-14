import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import type { LockedPlatformWebAuthnChallenge } from "@pos-platform/database-postgres";
import { describe, expect, it } from "vitest";
import { verifyPlatformWebAuthnRegistration } from "../src/platform-webauthn-registration-verifier.js";

const USER = "018f0000-0000-7000-8000-0000000000b4";
const SESSION = "018f0000-0000-7000-8000-0000000000e4";
const RP = { rpId: "admin.example.test", origin: "https://admin.example.test" };
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest();

function registrationFixture(options: { flags?: number; clientOrigin?: string } = {}) {
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = keys.publicKey.export({ format: "jwk" });
  if (!jwk.x || !jwk.y) throw new Error("TEST_MISSING_EC_COORDINATES");
  const publicKey = Buffer.concat([
    Buffer.from("a5010203262001215820", "hex"), Buffer.from(jwk.x, "base64url"),
    Buffer.from("225820", "hex"), Buffer.from(jwk.y, "base64url"),
  ]);
  const credentialId = randomBytes(32).toString("base64url");
  const challengeValue = randomBytes(32).toString("base64url");
  const authData = Buffer.alloc(55);
  hash(RP.rpId).copy(authData);
  authData[32] = options.flags ?? 0x45; // UP + UV + AT
  authData.writeUInt16BE(Buffer.from(credentialId, "base64url").length, 53);
  const attestationObject = isoCBOR.encode(new Map<string, string | Map<string, string> | Uint8Array>([
    ["fmt", "none"], ["attStmt", new Map()],
    ["authData", new Uint8Array(Buffer.concat([
      authData, Buffer.from(credentialId, "base64url"), publicKey,
    ]))],
  ]));
  const response: RegistrationResponseJSON = {
    id: credentialId, rawId: credentialId, type: "public-key",
    clientExtensionResults: {},
    response: {
      clientDataJSON: Buffer.from(JSON.stringify({
        type: "webauthn.create", challenge: challengeValue,
        origin: options.clientOrigin ?? RP.origin,
      })).toString("base64url"),
      attestationObject: Buffer.from(attestationObject).toString("base64url"),
    },
  };
  const challenge: LockedPlatformWebAuthnChallenge = {
    challenge: challengeValue, userId: USER, factorId: null, sessionId: SESSION,
    purpose: "ENROLL", rpId: RP.rpId, expectedOrigin: RP.origin,
  };
  return { response, challenge, trustedRp: RP, credentialId, publicKey };
}

describe("trusted WebAuthn registration verification; no factor enrollment side effect", () => {
  it("verifies a real none-attestation ES256 registration and returns only public material", async () => {
    const f = registrationFixture();
    const result = await verifyPlatformWebAuthnRegistration(f);
    expect(result).toMatchObject({
      credentialId: f.credentialId, counter: 0,
      backupEligible: false, backedUp: false, userVerified: true,
    });
    expect(result?.publicKeyCoseBase64url).toBe(f.publicKey.toString("base64url"));
    expect(Object.keys(result ?? {})).not.toContain("status");
    expect(Object.keys(result ?? {})).not.toContain("secretReference");
  });

  it("rejects challenge, server origin, RP ID and authenticator origin mismatches", async () => {
    const f = registrationFixture();
    expect(await verifyPlatformWebAuthnRegistration({
      ...f, challenge: { ...f.challenge, challenge: randomBytes(32).toString("base64url") },
    })).toBeNull();
    expect(await verifyPlatformWebAuthnRegistration({
      ...f, trustedRp: { ...f.trustedRp, origin: "https://other.example.test" },
    })).toBeNull();
    expect(await verifyPlatformWebAuthnRegistration({
      ...f, trustedRp: { ...f.trustedRp, rpId: "other.example.test" },
    })).toBeNull();
    expect(await verifyPlatformWebAuthnRegistration(registrationFixture({
      clientOrigin: "https://other.example.test",
    }))).toBeNull();
  });

  it("rejects registration without authenticator user verification", async () => {
    expect(await verifyPlatformWebAuthnRegistration(registrationFixture({ flags: 0x41 }))).toBeNull();
  });

  it("rejects ENROLL without bound global-session identifier and prevents mismatched purposes", async () => {
    const f = registrationFixture();
    expect(await verifyPlatformWebAuthnRegistration({
      ...f, challenge: { ...f.challenge, sessionId: null },
    })).toBeNull();
    expect(await verifyPlatformWebAuthnRegistration({
      ...f, challenge: { ...f.challenge, factorId: USER },
    })).toBeNull();
    expect(await verifyPlatformWebAuthnRegistration({
      ...f, challenge: { ...f.challenge, purpose: "AUTHENTICATE" },
    })).toBeNull();
  });

  it("rejects malformed attestation and noncanonical challenges", async () => {
    const f = registrationFixture();
    expect(await verifyPlatformWebAuthnRegistration({
      ...f, response: { ...f.response, response: { ...f.response.response, attestationObject: "bad!" } },
    })).toBeNull();
    expect(await verifyPlatformWebAuthnRegistration({
      ...f, challenge: { ...f.challenge, challenge: "malformed" },
    })).toBeNull();
  });
});
