import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { PostgresPlatformAdministrationSessionRepository } from "../src/index.js";

const SESSION_ID = "018f0000-0000-7000-8000-0000000000b0";
const ACCOUNT_ID = "018f0000-0000-7000-8000-0000000000a1";
const NOW = new Date("2026-10-08T12:15:00.000Z");

function row(overrides: Record<string, unknown> = {}) {
  return {
    session_id: SESSION_ID,
    platform_account_id: ACCOUNT_ID,
    tenant_id: null,
    tenant_membership_id: null,
    mfa_status: "SATISFIED" as const,
    last_reauthenticated_at: new Date("2026-10-08T12:00:00.000Z"),
    expires_at: new Date("2026-10-08T13:00:00.000Z"),
    ...overrides,
  };
}

describe("PostgresPlatformAdministrationSessionRepository", () => {
  it("returns a persisted, global, active MFA session only after querying the central authority", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [row()], rowCount: 1 });
    const repository = new PostgresPlatformAdministrationSessionRepository({ query } as unknown as Pool);

    await expect(repository.findUsableSession(SESSION_ID, 15 * 60 * 1000, NOW)).resolves.toEqual({
      session_id: SESSION_ID,
      platform_account_id: ACCOUNT_ID,
      actor_type: "PLATFORM_ACCOUNT",
      tenant_id: null,
      tenant_membership_id: null,
      mfa_status: "SATISFIED",
      last_reauthenticated_at: "2026-10-08T12:00:00.000Z",
      expires_at: "2026-10-08T13:00:00.000Z",
    });

    expect(query).toHaveBeenCalledOnce();
    const [sql, parameters] = query.mock.calls[0] as [string, unknown[]];
    expect(parameters).toEqual([SESSION_ID]);
    expect(sql).toContain("JOIN identity.users AS u ON u.id = s.user_id");
    expect(sql).toContain("s.revoked_at IS NULL");
    expect(sql).toContain("s.expires_at > clock_timestamp()");
    expect(sql).toContain("s.mfa_status = 'SATISFIED'");
    expect(sql).toContain("u.status = 'ACTIVE'");
    expect(sql).toContain("FROM identity.mfa_factors AS mf");
    expect(sql).toContain("mf.status = 'ACTIVE'");
    expect(sql).toContain("mf.verified_at IS NOT NULL");
    expect(sql).not.toMatch(/\b(password|verifier|secret_reference|refresh_token)\b/i);
  });

  it("returns null when the persisted session fails any database-side active-session condition", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const repository = new PostgresPlatformAdministrationSessionRepository({ query } as unknown as Pool);

    await expect(repository.findUsableSession(SESSION_ID, 15 * 60 * 1000, NOW)).resolves.toBeNull();
  });

  it("fails closed when reauthentication is stale", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [row({ last_reauthenticated_at: new Date("2026-10-08T11:00:00.000Z") })],
      rowCount: 1,
    });
    const repository = new PostgresPlatformAdministrationSessionRepository({ query } as unknown as Pool);

    await expect(repository.findUsableSession(SESSION_ID, 15 * 60 * 1000, NOW)).resolves.toBeNull();
  });

  it("rejects an invalid session identifier before querying PostgreSQL", async () => {
    const query = vi.fn();
    const repository = new PostgresPlatformAdministrationSessionRepository({ query } as unknown as Pool);

    await expect(repository.findUsableSession("not-a-uuid", 15 * 60 * 1000, NOW)).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it("propagates database errors instead of converting them to an unauthenticated result", async () => {
    const failure = new Error("database unavailable");
    const query = vi.fn().mockRejectedValue(failure);
    const repository = new PostgresPlatformAdministrationSessionRepository({ query } as unknown as Pool);

    await expect(repository.findUsableSession(SESSION_ID, 15 * 60 * 1000, NOW)).rejects.toBe(failure);
  });

  it("rejects invalid reauthentication policy instead of accepting a session", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [row()], rowCount: 1 });
    const repository = new PostgresPlatformAdministrationSessionRepository({ query } as unknown as Pool);

    await expect(repository.findUsableSession(SESSION_ID, 0, NOW))
      .rejects.toThrow("PLATFORM_ADMINISTRATION_INVALID_REAUTHENTICATION_POLICY");
  });
});
