import { generateKeyPairSync, verify } from "node:crypto";
import { expect, it } from "vitest";
import { unsignedAuthorizationTrustCandidateBytes } from "@pos-platform/contracts";
import { signIsolatedAuthorizationTrust } from "../src/isolated-authorization-trust.js";

it("Central signs the entire DEC-011 laboratory candidate and refuses a production profile or public signer", () => {
  const root = generateKeyPairSync("ed25519"), key = generateKeyPairSync("ed25519");
  const claims = { profile: "DEC011_LAB_CANDIDATE_1", mode: "ISOLATED_VALIDATION", schema_version: 1,
    purpose: "AUTHORIZATION_SNAPSHOT", environment: "isolated-validation", issuer: "https://business.example.test", authority_id: "SAS_LAB_ROOT", generation: 1, complete: true,
    issued_at: "2026-10-25T12:00:00.000Z", valid_from: "2026-10-25T12:00:00.000Z", valid_until: "2026-10-25T13:00:00.000Z",
    keys: [{ key_id: "SAS_TEST_A", purpose: "AUTHORIZATION_SNAPSHOT", status: "ACTIVE", version: 1,
      public_key_pem: key.publicKey.export({ type: "spki", format: "pem" }).toString(), valid_from: "2026-10-25T12:00:00.000Z", valid_until: "2026-10-25T14:00:00.000Z" }] };
  const bundle = signIsolatedAuthorizationTrust(claims, root.privateKey);
  expect(verify(null, unsignedAuthorizationTrustCandidateBytes(bundle.claims), root.publicKey, Buffer.from(bundle.signature, "base64url"))).toBe(true);
  bundle.claims.generation++;
  expect(verify(null, unsignedAuthorizationTrustCandidateBytes(bundle.claims), root.publicKey, Buffer.from(bundle.signature, "base64url"))).toBe(false);
  expect(() => signIsolatedAuthorizationTrust({ ...claims, mode: "PRODUCTION" }, root.privateKey)).toThrow();
  expect(() => signIsolatedAuthorizationTrust(claims, root.publicKey)).toThrow("SAS_ROOT_PRIVATE_ED25519_REQUIRED");
  const privateMaterial = key.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  for (const public_key_pem of [privateMaterial, claims.keys[0]!.public_key_pem + privateMaterial])
    expect(() => signIsolatedAuthorizationTrust({ ...claims, keys: [{ ...claims.keys[0]!, public_key_pem }] }, root.privateKey)).toThrow();
  expect(() => signIsolatedAuthorizationTrust({ ...claims, keys: [{ ...claims.keys[0]!,
    public_key_pem: generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ type: "spki", format: "pem" }).toString() }] }, root.privateKey))
    .toThrow("SAS_OPERATIONAL_PUBLIC_SET_REQUIRED");
});
