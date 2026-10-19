import type { Pool, PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { PostgresPlatformWebAuthnMaterialRepository } from "../src/index.js";

const USER = "018f0000-0000-7000-8000-0000000000b4";
const FACTOR = "018f0000-0000-7000-8000-0000000000d4";
const MATERIAL = "018f0000-0000-7000-8000-0000000000a4";
const REF = "webauthn:v1:" + MATERIAL;

function fixture(found = true) {
  const query = vi.fn(async (_sql: string, _params?: unknown[]) => ({
    rows: found ? [{
      material_id: MATERIAL, user_id: USER, factor_id: FACTOR, secret_reference: REF,
      credential_id: "Y".repeat(43), public_key_cose_base64url: "Y".repeat(130),
      counter: "1", version: "3", backup_eligible: true, backed_up: false,
    }] : [],
  }));
  return {
    query,
    repo: new PostgresPlatformWebAuthnMaterialRepository({ query } as unknown as Pool),
  };
}

describe("central WebAuthn public material (not a second factor)", () => {
  it("reads only from one-to-one reference bound to active canonical factor", async () => {
    const t = fixture();
    const item = await t.repo.findVerifiedMaterial(USER, FACTOR);
    expect(item).toMatchObject({
      userId: USER, factorId: FACTOR, materialId: MATERIAL, secretReference: REF,
      schemaVersion: 1, counter: 1, version: 3,
    });
    expect(t.query).toHaveBeenCalledOnce();
    const [sql, params] = t.query.mock.calls[0]!;
    expect(params).toEqual([FACTOR, USER]);
    for (const criterion of [
      "identity.mfa_factors", "identity.users", "u.status = 'ACTIVE'",
      "f.status = 'ACTIVE'", "f.verified_at IS NOT NULL", "f.revoked_at IS NULL",
      "f.secret_reference = 'webauthn:v1:' || m.id::text",
    ]) expect(sql).toContain(criterion);
  });

  it("fails closed on missing material or invalid user and factor IDs", async () => {
    const t = fixture(false);
    expect(await t.repo.findVerifiedMaterial(USER, FACTOR)).toBeNull();
    await expect(t.repo.findVerifiedMaterial("not-uuid", FACTOR)).rejects.toThrow();
    await expect(t.repo.findVerifiedMaterial(USER, "not-uuid")).rejects.toThrow();
    expect(t.query).toHaveBeenCalledTimes(1);
  });

  it("requires optimistic counter and version CAS scoped to same factor/user", async () => {
    const query = vi.fn(async () => ({ rows: [{ id: MATERIAL }] }));
    const repo = fixture().repo;
    const client = { query } as unknown as PoolClient;
    const result = await repo.advanceCounterCas(client, {
      userId: USER, factorId: FACTOR, materialId: MATERIAL,
      expectedCounter: 1, newCounter: 2, expectedVersion: 3, backedUp: false,
    });
    expect(result).toBe(true);
    const [sql, args] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(args).toEqual([MATERIAL, FACTOR, 1, 2, 3, false, USER]);
    expect(sql).toContain("m.counter = $3 AND m.version = $5");
    expect(sql).toContain("f.secret_reference = 'webauthn:v1:' || m.id::text");
    expect(sql).toContain("version = version + 1");
  });

  it("rejects replay, invalid counter and version before SQL", async () => {
    const query = vi.fn();
    const repo = fixture().repo;
    const client = { query } as unknown as PoolClient;
    const basis = {
      userId: USER, factorId: FACTOR, materialId: MATERIAL,
      expectedCounter: 1, newCounter: 1, expectedVersion: 3, backedUp: false,
    };
    expect(await repo.advanceCounterCas(client, basis)).toBe(false);
    for (const input of [
      { ...basis, expectedCounter: -1 },
      { ...basis, newCounter: 0xffffffff + 1 },
      { ...basis, expectedVersion: 0 },
    ]) await expect(repo.advanceCounterCas(client, input)).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it("allows counterless passkey CAS only with a fresh version", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ id: MATERIAL }] })
      .mockResolvedValueOnce({ rows: [] });
    const repo = fixture().repo;
    const client = { query } as unknown as PoolClient;
    const input = {
      userId: USER, factorId: FACTOR, materialId: MATERIAL,
      expectedCounter: 0, newCounter: 0, expectedVersion: 3, backedUp: false,
    };
    expect(await repo.advanceCounterCas(client, input)).toBe(true);
    expect(await repo.advanceCounterCas(client, input)).toBe(false);
  });
});
