import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { describe, expect, it } from "vitest";
import { verifyPlatformWebAuthnAssertion } from "../src/platform-webauthn-assertion-verifier.js";

const USER = "018f0000-0000-7000-8000-0000000000b4";
const FACTOR = "018f0000-0000-7000-8000-0000000000d4";
const SESSION = "018f0000-0000-7000-8000-0000000000e4";
const MATERIAL_REF = "webauthn:v1:018f0000-0000-7000-8000-0000000000a4";
const rpId = "admin.example.test";
const origin = "https://admin.example.test";
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest();

function signedFixture(options: { flags?: number; authenticatorCounter?: number; clientOrigin?: string } = {}) {
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = keys.publicKey.export({ format: "jwk" });
  if (!jwk.x || !jwk.y) throw new Error("TEST_EC_KEY_UNEXPECTED");
  const coseKey = Buffer.concat([
    Buffer.from("a5010203262001215820", "hex"), Buffer.from(jwk.x, "base64url"),
    Buffer.from("225820", "hex"), Buffer.from(jwk.y, "base64url"),
  ]);
  const credentialId = randomBytes(32).toString("base64url");
  const challengeValue = randomBytes(32).toString("base64url");
  const client = Buffer.from(JSON.stringify({
    type: "webauthn.get", challenge: challengeValue,
    origin: options.clientOrigin ?? origin, crossOrigin: false,
  }));
  const authenticatorData = Buffer.alloc(37);
  sha(rpId).copy(authenticatorData);
  authenticatorData[32] = options.flags ?? 0x05;
  authenticatorData.writeUInt32BE(options.authenticatorCounter ?? 1, 33);
  const signed = sign("sha256", Buffer.concat([authenticatorData, sha(client)]), keys.privateKey);
  const response: AuthenticationResponseJSON = {
    id: credentialId, rawId: credentialId, type: "public-key",
    clientExtensionResults: {},
    response: {
      clientDataJSON: client.toString("base64url"),
      authenticatorData: authenticatorData.toString("base64url"),
      signature: signed.toString("base64url"),
    },
  };
  const challenge = {
    challenge: challengeValue, userId: USER, factorId: FACTOR, sessionId: SESSION,
    purpose: "REAUTHENTICATE" as const, rpId, expectedOrigin: origin,
  };
  const factor = { userId: USER, factorId: FACTOR, secretReference: MATERIAL_REF };
  const material = {
    schemaVersion: 1 as const, secretReference: MATERIAL_REF, credentialId,
    publicKeyCoseBase64url: coseKey.toString("base64url"), counter: 0,
  };
  return { response, challenge, factor, material, rp: { rpId, origin } };
}

describe("platform trusted WebAuthn assertion verification (no session issuance)", () => {
  it("validates a real P-256 signature, challenge, RP and user verification", async () => {
    const result = await verifyPlatformWebAuthnAssertion(signedFixture());
    expect(result).toMatchObject({ newCounter: 1, userVerified: true });
  });

  it("fails closed for a modified ECDSA signature", async () => {
    const fixture = signedFixture();
    const bytes = Buffer.from(fixture.response.response.signature, "base64url");
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
    fixture.response.response.signature = bytes.toString("base64url");
    expect(await verifyPlatformWebAuthnAssertion(fixture)).toBeNull();
  });

  it("rejects incorrect server challenge, origin and RP without accepting client claims", async () => {
    const fixture = signedFixture();
    expect(await verifyPlatformWebAuthnAssertion({
      ...fixture, challenge: { ...fixture.challenge, challenge: randomBytes(32).toString("base64url") },
    })).toBeNull();
    expect(await verifyPlatformWebAuthnAssertion({
      ...fixture, rp: { ...fixture.rp, rpId: "other.example.test" },
    })).toBeNull();
    expect(await verifyPlatformWebAuthnAssertion({
      ...fixture, rp: { ...fixture.rp, origin: "https://other.example.test" },
    })).toBeNull();
    expect(await verifyPlatformWebAuthnAssertion(signedFixture({
      clientOrigin: "https://other.example.test",
    }))).toBeNull();
  });

  it("rejects an assertion without the authenticator user-verified flag", async () => {
    expect(await verifyPlatformWebAuthnAssertion(signedFixture({ flags: 0x01 }))).toBeNull();
  });

  it("rejects a replayed non-increasing authenticator counter", async () => {
    const fixture = signedFixture({ authenticatorCounter: 1 });
    expect(await verifyPlatformWebAuthnAssertion({
      ...fixture, material: { ...fixture.material, counter: 1 },
    })).toBeNull();
  });

  it("rejects cross-account factors, incorrect factor ID and untrusted material references", async () => {
    const fixture = signedFixture();
    expect(await verifyPlatformWebAuthnAssertion({
      ...fixture, factor: { ...fixture.factor, userId: "018f0000-0000-7000-8000-0000000000f4" },
    })).toBeNull();
    expect(await verifyPlatformWebAuthnAssertion({
      ...fixture, challenge: { ...fixture.challenge, factorId: "018f0000-0000-7000-8000-0000000000f4" },
    })).toBeNull();
    expect(await verifyPlatformWebAuthnAssertion({
      ...fixture, material: { ...fixture.material, secretReference: "webauthn:v1:018f0000-0000-7000-8000-0000000000f4" },
    })).toBeNull();
    expect(await verifyPlatformWebAuthnAssertion({
      ...fixture, factor: { ...fixture.factor, secretReference: "https://attacker.invalid/factor" },
    })).toBeNull();
  });

  it("rejects unknown material version, corrupt COSE key and wrong credential ID", async () => {
    const fixture = signedFixture();
    expect(await verifyPlatformWebAuthnAssertion({
      ...fixture, material: { ...fixture.material, schemaVersion: 2 as never },
    })).toBeNull();
    expect(await verifyPlatformWebAuthnAssertion({
      ...fixture, material: { ...fixture.material, publicKeyCoseBase64url: "!!" },
    })).toBeNull();
    expect(await verifyPlatformWebAuthnAssertion({
      ...fixture, material: { ...fixture.material, credentialId: randomBytes(32).toString("base64url") },
    })).toBeNull();
    expect(await verifyPlatformWebAuthnAssertion({
      ...fixture, material: { ...fixture.material, counter: -1 },
    })).toBeNull();
  });

  it("permits counterless passkey verification but does not grant MFA or update stored counter", async () => {
    const result = await verifyPlatformWebAuthnAssertion(signedFixture({ authenticatorCounter: 0 }));
    expect(result).toMatchObject({ newCounter: 0, userVerified: true });
    expect(Object.keys(result ?? {})).not.toContain("mfaStatus");
    expect(Object.keys(result ?? {})).not.toContain("supportVerified");
  });
});
