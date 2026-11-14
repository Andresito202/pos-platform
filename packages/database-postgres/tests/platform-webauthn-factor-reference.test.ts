import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { PostgresPlatformWebAuthnFactorReferenceRepository } from "../src/index.js";

const USER = "018f0000-0000-7000-8000-0000000000b4";
const FACTOR = "018f0000-0000-7000-8000-0000000000d4";
const REF = "webauthn:v1:018f0000-0000-7000-8000-0000000000a4";

function fixture(reference: string | null = REF, present = true) {
  const query = vi.fn().mockResolvedValue({
    rows: present ? [{ user_id: USER, factor_id: FACTOR, secret_reference: reference }] : [],
  });
  return { query, repository: new PostgresPlatformWebAuthnFactorReferenceRepository({ query } as unknown as Pool) };
}

describe("canonical WebAuthn factor reference lookup", () => {
  it("accepts only verified ACTIVE WEBAUTHN factor for the matching active platform identity", async () => {
    const t = fixture();
    expect(await t.repository.findVerifiedFactor(USER, FACTOR)).toEqual({
      userId: USER, factorId: FACTOR, secretReference: REF,
    });
    expect(t.query).toHaveBeenCalledOnce();
    const [sql, params] = t.query.mock.calls[0] as [string, string[]];
    expect(params).toEqual([FACTOR, USER]);
    for (const requirement of [
      "u.status = 'ACTIVE'", "f.user_id = $2", "f.id = $1",
      "f.factor_type = 'WEBAUTHN'", "f.status = 'ACTIVE'",
      "f.verified_at IS NOT NULL", "f.revoked_at IS NULL",
    ]) expect(sql).toContain(requirement);
  });

  it("rejects missing factors, absent or noncanonical references without fallback", async () => {
    expect(await fixture(REF, false).repository.findVerifiedFactor(USER, FACTOR)).toBeNull();
    for (const ref of [null, "", "https://example.test", "webauthn:v2:018f0000-0000-7000-8000-0000000000a4", "webauthn:v1:../../secrets"]) {
      expect(await fixture(ref).repository.findVerifiedFactor(USER, FACTOR)).toBeNull();
    }
  });

  it("rejects invalid identity and factor IDs without database access", async () => {
    const t = fixture();
    await expect(t.repository.findVerifiedFactor("not-uuid", FACTOR)).rejects.toThrow();
    await expect(t.repository.findVerifiedFactor(USER, "not-uuid")).rejects.toThrow();
    expect(t.query).not.toHaveBeenCalled();
  });
});
