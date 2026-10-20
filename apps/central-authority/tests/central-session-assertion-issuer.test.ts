import { generateKeyPairSync, sign, verify } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  canonicalSessionTrustJson,
  unsignedSessionAssertionOperationalKeyBytes,
  type SessionAssertionClaims,
  type SessionAssertionOperationalKeyClaims,
  type SignedSessionAssertionOperationalKey,
} from "@pos-platform/contracts";
import {
  CentralSessionAssertionIssuer,
  type TrustedSessionAssertionIssuance,
} from "../src/central-session-assertion-issuer.js";

const NOW = new Date("2026-10-20T10:00:00.000Z");
const USER = "018f0000-0000-7000-8000-0000000000a1";
const SESSION = "018f0000-0000-7000-8000-0000000000a2";
const MEMBERSHIP = "018f0000-0000-7000-8000-0000000000a3";
const INSTALLATION = "018f0000-0000-7000-8000-0000000000a4";
const DEVICE = "018f0000-0000-7000-8000-0000000000a5";
const rootKeys = generateKeyPairSync("ed25519");
const operationalKeys = generateKeyPairSync("ed25519");

function claims(overrides: Partial<SessionAssertionClaims> = {}): SessionAssertionClaims {
  return {
    session_id: SESSION, user_id: USER, tenant_membership_id: MEMBERSHIP,
    installation_id: INSTALLATION, device_id: DEVICE,
    issued_at: "2026-10-20T09:59:59.000Z",
    offline_valid_until: "2026-10-20T10:59:59.000Z",
    sequence: 7, key_id: "ssa-2026-10",
    ...overrides,
  };
}
function certificate(
  overrides: Partial<SessionAssertionOperationalKeyClaims> = {},
  rootPrivateKey = rootKeys.privateKey,
): SignedSessionAssertionOperationalKey {
  const keyClaims: SessionAssertionOperationalKeyClaims = {
    key_id: "ssa-2026-10", key_purpose: "SESSION_ASSERTION",
    environment: "production", status: "ACTIVE",
    public_key_pem: operationalKeys.publicKey.export({ format: "pem", type: "spki" }) as string,
    valid_from: "2026-10-20T09:00:00.000Z",
    valid_until: "2026-10-20T12:00:00.000Z",
    version: 1,
    ...overrides,
  };
  return {
    claims: keyClaims,
    signature: sign(null, unsignedSessionAssertionOperationalKeyBytes(keyClaims), rootPrivateKey)
      .toString("base64url"),
  };
}
function fixture(
  changes: Partial<TrustedSessionAssertionIssuance> = {},
  acceptedProof = "opaque-trusted-session-proof",
) {
  const resolved: TrustedSessionAssertionIssuance = {
    claims: claims(), signedOperationalKey: certificate(), ...changes,
  };
  const resolver = vi.fn(async (proof: string) =>
    proof === acceptedProof ? resolved : null);
  const issuer = new CentralSessionAssertionIssuer(
    operationalKeys.privateKey,
    rootKeys.publicKey,
    resolver,
    "production",
    { maximumClaimAgeMs: 60_000, maximumOfflineLifetimeMs: 3_600_000 },
    () => NOW,
  );
  return { issuer, resolver };
}

describe("D3 SSA central signing primitive — not a login endpoint", () => {
  it("signs a resolved session with a root-certified active operational key", async () => {
    const { issuer, resolver } = fixture();
    const signed = await issuer.issue("opaque-trusted-session-proof");
    expect(resolver).toHaveBeenCalledOnce();
    expect(signed?.claims).toEqual(claims());
    expect(signed && verify(
      null,
      Buffer.from(canonicalSessionTrustJson(signed.claims)),
      operationalKeys.publicKey,
      Buffer.from(signed.signature, "base64url"),
    )).toBe(true);
    expect(signed?.claims).not.toHaveProperty("permissions");
    expect(signed?.claims).not.toHaveProperty("roles");
  });

  it("never signs when the trusted resolver rejects a proof", async () => {
    const { issuer } = fixture();
    expect(await issuer.issue("forged")).toBeNull();
  });

  it("rejects blank authorization before calling the resolver", async () => {
    const { issuer, resolver } = fixture();
    expect(await issuer.issue("  ")).toBeNull();
    expect(resolver).not.toHaveBeenCalled();
  });

  it("refuses an operational certificate signed by another root", async () => {
    const outsider = generateKeyPairSync("ed25519");
    const { issuer } = fixture({ signedOperationalKey: certificate({}, outsider.privateKey) });
    await expect(issuer.issue("opaque-trusted-session-proof"))
      .rejects.toThrow("SSA_ISSUER_ROOT_SIGNATURE_INVALID");
  });

  it("refuses a root-signed certificate for another signing private key", async () => {
    const outsider = generateKeyPairSync("ed25519");
    const { issuer } = fixture({ signedOperationalKey: certificate({
      public_key_pem: outsider.publicKey.export({ format: "pem", type: "spki" }) as string,
    }) });
    await expect(issuer.issue("opaque-trusted-session-proof"))
      .rejects.toThrow("SSA_ISSUER_PRIVATE_KEY_MISMATCH");
  });

  it.each(["REVOKED", "VERIFY_ONLY"] as const)(
    "will not create new assertions using a %s key", async (status) => {
      const { issuer } = fixture({ signedOperationalKey: certificate({ status }) });
      await expect(issuer.issue("opaque-trusted-session-proof"))
        .rejects.toThrow("SSA_ISSUER_OPERATIONAL_KEY_NOT_ACTIVE");
    },
  );

  it("does not allow cross-environment or mismatched key identifiers", async () => {
    const rejectedCases: Partial<TrustedSessionAssertionIssuance>[] = [
      { signedOperationalKey: certificate({ environment: "staging" }) },
      { claims: claims({ key_id: "ssa-another-key" }) },
    ];
    for (const changes of rejectedCases) {
      const { issuer } = fixture(changes);
      await expect(issuer.issue("opaque-trusted-session-proof"))
        .rejects.toThrow("SSA_ISSUER_OPERATIONAL_KEY_NOT_ACTIVE");
    }
  });

  it("rejects claims containing any frontend-provided role or permission fields", async () => {
    const polluted = { ...claims(), permissions: ["PLATFORM_ROOT"] };
    const { issuer } = fixture({ claims: polluted as unknown as SessionAssertionClaims });
    await expect(issuer.issue("opaque-trusted-session-proof")).rejects.toThrow();
  });

  const temporalCases: Array<{ description: string; overrides: Partial<SessionAssertionClaims> }> = [
    { description: "future issuance", overrides: { issued_at: "2026-10-20T10:00:01.000Z" } },
    { description: "stale issuance", overrides: { issued_at: "2026-10-20T09:58:00.000Z" } },
    { description: "too long offline", overrides: { offline_valid_until: "2026-10-20T13:00:00.000Z" } },
    { description: "already expired", overrides: { offline_valid_until: "2026-10-20T09:59:59.500Z" } },
  ];
  it.each(temporalCases)("fails closed for $description", async ({ overrides }) => {
    const { issuer } = fixture({ claims: claims(overrides) });
    await expect(issuer.issue("opaque-trusted-session-proof"))
      .rejects.toThrow("SSA_ISSUER_VALIDITY_POLICY_REJECTED");
  });

  it("does not issue an SSA whose offline lifetime outlives the certified signing key", async () => {
    const { issuer } = fixture({
      signedOperationalKey: certificate({ valid_until: "2026-10-20T10:30:00.000Z" }),
    });
    await expect(issuer.issue("opaque-trusted-session-proof"))
      .rejects.toThrow("SSA_ISSUER_VALIDITY_POLICY_REJECTED");
  });

  it("requires explicit positive issuance policies and Ed25519 keys", () => {
    const { resolver } = fixture();
    expect(() => new CentralSessionAssertionIssuer(
      operationalKeys.privateKey, rootKeys.publicKey, resolver, "production",
      { maximumClaimAgeMs: 0, maximumOfflineLifetimeMs: 1000 },
    )).toThrow("SSA_ISSUER_POLICY_INVALID");
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
    expect(() => new CentralSessionAssertionIssuer(
      rsa.privateKey, rootKeys.publicKey, resolver, "production",
      { maximumClaimAgeMs: 1000, maximumOfflineLifetimeMs: 1000 },
    )).toThrow("SSA_ISSUER_KEY_TYPE_INVALID");
  });
});
