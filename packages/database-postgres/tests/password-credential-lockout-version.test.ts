import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { PostgresPasswordCredentialVerificationRepository } from "../src/password-credential-verification-repository.js";

function poolWith(rows: Array<{ user_id: string; credential_id: string; credential_version: string; verifier: string }>, updates: string[]) {
  const client = {
    query: vi.fn(async (sql: string) => {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
      if (sql.includes("FOR UPDATE OF c")) return { rows };
      if (sql.startsWith("UPDATE identity.user_credentials")) {
        updates.push(sql);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return { connect: async () => client, client } as unknown as Pool & { client: typeof client };
}

describe("password credential lockout preserves version", () => {
  it("does not bump version on failed password", async () => {
    const updates: string[] = [];
    const pool = poolWith([{
      user_id: "11111111-1111-7111-8111-111111111111",
      credential_id: "22222222-2222-7222-8222-222222222222",
      credential_version: "7",
      verifier: "stored",
    }], updates);
    const repo = new PostgresPasswordCredentialVerificationRepository(pool);
    const match = await repo.verifyActivePassword("owner@example.test", async () => false);
    expect(match).toBeNull();
    expect(updates).toHaveLength(1);
    expect(updates[0]).toContain("failed_attempt_count");
    expect(updates[0]).not.toMatch(/version\s*=\s*version\s*\+\s*1/);
  });

  it("does not bump version on successful password bookkeeping", async () => {
    const updates: string[] = [];
    const pool = poolWith([{
      user_id: "11111111-1111-7111-8111-111111111111",
      credential_id: "22222222-2222-7222-8222-222222222222",
      credential_version: "7",
      verifier: "stored",
    }], updates);
    const repo = new PostgresPasswordCredentialVerificationRepository(pool);
    const match = await repo.verifyActivePassword("owner@example.test", async (stored) => stored === "stored");
    expect(match).toEqual({
      userId: "11111111-1111-7111-8111-111111111111",
      credentialId: "22222222-2222-7222-8222-222222222222",
      credentialVersion: "7",
    });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toContain("failed_attempt_count = 0");
    expect(updates[0]).not.toMatch(/version\s*=\s*version\s*\+\s*1/);
  });
});
