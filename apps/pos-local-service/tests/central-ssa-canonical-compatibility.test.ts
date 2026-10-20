import { generateKeyPairSync, sign, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalSessionTrustJson,
  SessionAssertionClaimsSchema,
  type SessionAssertionClaims,
} from "@pos-platform/contracts";
import { unsignedSessionAssertionBytes } from "../src/security/session-assertion-verifier.js";

/**
 * Contract boundary regression: Central Authority's signer serializes with
 * canonicalSessionTrustJson, while the Local Service verifier uses canonicalJson.
 * These MUST produce identical bytes for every schema-valid SSA claim.
 * This verifies wire compatibility; it is NOT a login or issuer E2E test.
 */
const claims: SessionAssertionClaims = {
  session_id: "018f0000-0000-7000-8000-0000000000a2",
  user_id: "018f0000-0000-7000-8000-0000000000a1",
  tenant_membership_id: "018f0000-0000-7000-8000-0000000000a3",
  installation_id: "018f0000-0000-7000-8000-0000000000a4",
  device_id: "018f0000-0000-7000-8000-0000000000a5",
  issued_at: "2026-10-20T09:59:59.000Z",
  offline_valid_until: "2026-10-20T10:59:59.000Z",
  sequence: 7,
  key_id: "ssa-2026-10",
};

describe("SSA canonical wire compatibility: central signer versus Local Service", () => {
  it("produces identical canonical bytes for schema-parsed signed claims", () => {
    const parsed = SessionAssertionClaimsSchema.parse(claims);
    const centralBytes = Buffer.from(canonicalSessionTrustJson(parsed), "utf8");
    const localBytes = unsignedSessionAssertionBytes(parsed);
    expect(centralBytes).toEqual(localBytes);
    expect(centralBytes.toString("utf8")).toContain('"sequence":7');
  });

  it("verifies centrally serialized Ed25519 signatures against the Local Service bytes", () => {
    const key = generateKeyPairSync("ed25519");
    const centralBytes = Buffer.from(canonicalSessionTrustJson(SessionAssertionClaimsSchema.parse(claims)));
    const signature = sign(null, centralBytes, key.privateKey);
    expect(verify(null, unsignedSessionAssertionBytes(claims), key.publicKey, signature)).toBe(true);
    expect(verify(null, unsignedSessionAssertionBytes({ ...claims, sequence: 8 }), key.publicKey, signature)).toBe(false);
  });
});
