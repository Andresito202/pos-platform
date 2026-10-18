import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { argon2id, hash, verify, type HashOptions } from "argon2";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
  type WebAuthnCredential,
} from "@simplewebauthn/server";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import { describe, expect, it } from "vitest";

// Compatibility evidence only. No production credential format, session,
// challenge store, RP deployment or MFA secret_reference is selected here.
describe("D3 Argon2id native-library compatibility", () => {
  const candidate = { type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1, hashLength: 32 } satisfies HashOptions;

  it("round-trips a versioned PHC verifier and rejects the wrong password", async () => {
    const password = "D3 test only — contraseña 🔐";
    const verifier = await hash(password, candidate);
    expect(verifier).toMatch(/^\$argon2id\$v=19\$[^$]+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/);
    const [, , , parameters, salt, digest] = verifier.split("$");
    expect(Object.fromEntries(parameters!.split(",").map(part => part.split("=")))).toEqual({ m: "19456", t: "2", p: "1" });
    expect(Buffer.from(salt!, "base64").length).toBeGreaterThanOrEqual(16);
    expect(Buffer.from(digest!, "base64").length).toBe(32);
    expect(await verify(verifier, password)).toBe(true);
    expect(await verify(verifier, `${password}!`)).toBe(false);
  });

  it("generates independent salts for the same password", async () => {
    const first = await hash("test-only-same-password", candidate);
    const second = await hash("test-only-same-password", candidate);
    expect(first.split("$")[4]).not.toBe(second.split("$")[4]);
    expect(await verify(first, "test-only-same-password")).toBe(true);
    expect(await verify(second, "test-only-same-password")).toBe(true);
  });

  it("does not accept a malformed verifier", async () => {
    await expect(verify("not-a-PHC-verifier", "test-only")).rejects.toThrow();
  });
});

const rpID = "admin.example.test";
const origin = `https://${rpID}`;
const sha256 = (value: string | Uint8Array): Buffer => createHash("sha256").update(value).digest();

// Software authenticator fixture: its private key lives only in this test.
// This does not establish browser/hardware compatibility or durable replay protection.
function authenticatorFixture(options: { flags?: number; counter?: number } = {}) {
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = keys.publicKey.export({ format: "jwk" });
  if (!jwk.x || !jwk.y) throw new Error("Missing fixture EC coordinates");
  // COSE EC2 / ES256 / P-256 map with x and y coordinates, each 32 bytes.
  const publicKey = Buffer.concat([
    Buffer.from("a5010203262001215820", "hex"), Buffer.from(jwk.x, "base64url"),
    Buffer.from("225820", "hex"), Buffer.from(jwk.y, "base64url"),
  ]);
  const id = randomBytes(32).toString("base64url");
  const challenge = randomBytes(32).toString("base64url");
  const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge, origin, crossOrigin: false }));
  const authenticatorData = Buffer.alloc(37);
  sha256(rpID).copy(authenticatorData);
  authenticatorData[32] = options.flags ?? 0x05; // User present and user verified.
  authenticatorData.writeUInt32BE(options.counter ?? 1, 33);
  const signature = sign("sha256", Buffer.concat([authenticatorData, sha256(clientDataJSON)]), keys.privateKey);
  const response: AuthenticationResponseJSON = {
    id, rawId: id, type: "public-key", clientExtensionResults: {},
    response: {
      clientDataJSON: clientDataJSON.toString("base64url"),
      authenticatorData: authenticatorData.toString("base64url"),
      signature: signature.toString("base64url"),
    },
  };
  const credential: WebAuthnCredential = { id, publicKey: new Uint8Array(publicKey), counter: 0 };
  return { response, expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: rpID, credential, requireUserVerification: true };
}

describe("D3 WebAuthn server-library compatibility", () => {
  it("generates independent challenges and requests user verification", async () => {
    const first = await generateAuthenticationOptions({ rpID, userVerification: "required" });
    const second = await generateAuthenticationOptions({ rpID, userVerification: "required" });
    expect(first.challenge).not.toBe(second.challenge);
    expect(first.userVerification).toBe("required");
    expect(first.rpId).toBe(rpID);
    const registration = await generateRegistrationOptions({
      rpID, rpName: "D3 test fixture", userID: randomBytes(32), userName: "test-only@example.test",
      authenticatorSelection: { userVerification: "required", residentKey: "required" },
    });
    expect(registration.authenticatorSelection?.userVerification).toBe("required");
    expect(registration.authenticatorSelection?.residentKey).toBe("required");
  });

  it("verifies a real P-256 signature and returns the counter for persistence", async () => {
    const result = await verifyAuthenticationResponse(authenticatorFixture());
    expect(result.verified).toBe(true);
    expect(result.authenticationInfo.newCounter).toBe(1);
    expect(result.authenticationInfo.userVerified).toBe(true);
  });

  it("registers a none-attestation credential and verifies its subsequent signature", async () => {
    const input = authenticatorFixture();
    const credentialId = Buffer.from(input.credential.id, "base64url");
    const authData = Buffer.alloc(55);
    sha256(rpID).copy(authData);
    authData[32] = 0x45; // UP, UV, attested credential data; counter and AAGUID zero.
    authData.writeUInt16BE(credentialId.length, 53);
    const attestationObject = isoCBOR.encode(new Map<string, string | Map<string, string> | Uint8Array>([
      ["fmt", "none"], ["attStmt", new Map()],
      ["authData", new Uint8Array(Buffer.concat([authData, credentialId, input.credential.publicKey]))],
    ]));
    const response: RegistrationResponseJSON = {
      id: input.credential.id, rawId: input.credential.id, type: "public-key", clientExtensionResults: {},
      response: {
        clientDataJSON: Buffer.from(JSON.stringify({ type: "webauthn.create", challenge: input.expectedChallenge, origin })).toString("base64url"),
        attestationObject: Buffer.from(attestationObject).toString("base64url"),
      },
    };
    const registration = await verifyRegistrationResponse({
      response, expectedChallenge: input.expectedChallenge, expectedOrigin: origin,
      expectedRPID: rpID, requireUserVerification: true, supportedAlgorithmIDs: [-7],
    });
    expect(registration.verified).toBe(true);
    if (!registration.verified) throw new Error("Fixture registration failed");
    expect(registration.registrationInfo.userVerified).toBe(true);
    expect(registration.registrationInfo.credential.id).toBe(input.credential.id);
    expect((await verifyAuthenticationResponse({ ...input, credential: registration.registrationInfo.credential })).verified).toBe(true);
  });

  it.each([
    { field: "expectedChallenge", value: "different-challenge", reason: /challenge/i },
    { field: "expectedOrigin", value: "https://other.example.test", reason: /origin/i },
    { field: "expectedRPID", value: "other.example.test", reason: /rp.?id/i },
  ] as const)("rejects a different $field", async ({ field, value, reason }) => {
    await expect(verifyAuthenticationResponse({ ...authenticatorFixture(), [field]: value })).rejects.toThrow(reason);
  });

  it("rejects user presence without user verification", async () => {
    await expect(verifyAuthenticationResponse(authenticatorFixture({ flags: 0x01 }))).rejects.toThrow(/user verification/i);
  });

  it("rejects a modified signature", async () => {
    const input = authenticatorFixture();
    const signature = Buffer.from(input.response.response.signature, "base64url");
    signature[signature.length - 1] = (signature[signature.length - 1] ?? 0) ^ 1;
    input.response.response.signature = signature.toString("base64url");
    expect((await verifyAuthenticationResponse(input)).verified).toBe(false);
  });

  it("rejects a non-increasing counter once the caller supplies the persisted counter", async () => {
    const input = authenticatorFixture();
    const first = await verifyAuthenticationResponse(input);
    await expect(verifyAuthenticationResponse({
      ...input, credential: { ...input.credential, counter: first.authenticationInfo.newCounter },
    })).rejects.toThrow(/counter/i);
  });

  it("requires a caller-owned one-use challenge store for counterless passkeys", async () => {
    const input = authenticatorFixture({ counter: 0 });
    // Real counterless passkeys are supported. A stateless crypto verifier cannot
    // prevent replay: the future runtime must atomically consume each challenge.
    expect((await verifyAuthenticationResponse(input)).verified).toBe(true);
    expect((await verifyAuthenticationResponse(input)).verified).toBe(true);
  });
});
