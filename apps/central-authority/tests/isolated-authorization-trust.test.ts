import {createHash, generateKeyPairSync, verify } from "node:crypto";
import { expect, it } from "vitest";
import { unsignedAuthorizationTrustCandidateBytes,unsignedAuthorizationTrustBytes,unsignedAuthorizationRootTransitionBytes } from "@pos-platform/contracts";
import { signIsolatedAuthorizationTrust,signAuthorizationTrust,signAuthorizationRootTransition } from "../src/isolated-authorization-trust.js";

it("Central signs the entire DEC-011 laboratory candidate and refuses a production profile or public signer", () => {
  const root = generateKeyPairSync("ed25519"), key = generateKeyPairSync("ed25519");
  const claims = { profile: "DEC011_LAB_CANDIDATE_1", mode: "ISOLATED_VALIDATION", schema_version: 1,
    purpose: "AUTHORIZATION_SNAPSHOT", environment: "isolated-validation", issuer: "https://business.example.test", authority_id: "SAS_LAB_ROOT", generation: 1, complete: true,
    issued_at: "2026-10-25T12:00:00.000Z", valid_from: "2026-10-25T12:00:00.000Z", valid_until: "2026-10-25T13:00:00.000Z",
    keys: [{ key_id: "SAS_TEST_A", purpose: "AUTHORIZATION_SNAPSHOT", status: "ACTIVE", version: 1,
      public_key_pem: key.publicKey.export({ type: "spki", format: "pem" }).toString(), valid_from: "2026-10-25T12:00:00.000Z", valid_until: "2026-10-25T14:00:00.000Z" }] };
  const bundle = signIsolatedAuthorizationTrust(claims, root.privateKey);
  const deploymentClaims={...claims,profile:"CAMACHO_SAS_TRUST_V1",mode:"DEPLOYMENT",environment:"PREPRODUCTION",
    recipient:{tenant_id:crypto.randomUUID(),company_id:crypto.randomUUID(),branch_id:crypto.randomUUID(),installation_id:crypto.randomUUID(),device_id:crypto.randomUUID()}};
  const deployment=signAuthorizationTrust(deploymentClaims,root.privateKey);
  expect(verify(null,unsignedAuthorizationTrustBytes(deployment.claims),root.publicKey,Buffer.from(deployment.signature,"base64url"))).toBe(true);
  expect(()=>signIsolatedAuthorizationTrust(deploymentClaims,root.privateKey)).toThrow();
  expect(()=>signAuthorizationTrust(claims,root.privateKey)).toThrow();
  expect(()=>signAuthorizationTrust(deploymentClaims,root.publicKey)).toThrow("SAS_ROOT_PRIVATE_ED25519_REQUIRED");
  const nextRoot=generateKeyPairSync("ed25519"),fp=(key:typeof root.publicKey)=>createHash("sha256").update(key.export({type:"spki",format:"der"})).digest("hex");
  const transitionClaims={profile:"CAMACHO_SAS_ROOT_TRANSITION_V1",purpose:"AUTHORIZATION_TRUST_ROOT_TRANSITION",issuer:deploymentClaims.issuer,authority_id:deploymentClaims.authority_id,
    environment:"PREPRODUCTION",recipient:deploymentClaims.recipient,old_root_spki_sha256:fp(root.publicKey),new_root_spki_sha256:fp(nextRoot.publicKey),new_root_public_key_pem:nextRoot.publicKey.export({type:"spki",format:"pem"}).toString(),next_minimum_generation:2,issued_at:claims.issued_at,expires_at:claims.valid_until};
  const transition=signAuthorizationRootTransition(transitionClaims,root.privateKey,nextRoot.privateKey),bytes=unsignedAuthorizationRootTransitionBytes(transition.claims);
  expect(verify(null,bytes,root.publicKey,Buffer.from(transition.old_signature,"base64url"))).toBe(true);
  expect(verify(null,bytes,nextRoot.publicKey,Buffer.from(transition.new_signature,"base64url"))).toBe(true);
  expect(()=>signAuthorizationRootTransition({...transitionClaims,new_root_spki_sha256:"0".repeat(64)},root.privateKey,nextRoot.privateKey)).toThrow("SAS_ROOT_TRANSITION_SIGNERS_MISMATCH");
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
