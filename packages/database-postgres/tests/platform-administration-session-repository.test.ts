import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { PostgresPlatformAdministrationSessionRepository } from "../src/index.js";

const SESSION_ID = "018f0000-0000-7000-8000-0000000000b0";
const USER_ID = "018f0000-0000-7000-8000-0000000000a1";
const NOW = new Date("2026-10-08T12:15:00.000Z");

function row(overrides: Record<string, unknown> = {}) {
  return {
    session_id: SESSION_ID,
    user_id: USER_ID,
    mfa_status: "SATISFIED" as const,
    last_reauthenticated_at: new Date("2026-10-08T12:00:00.000Z"),
    expires_at: new Date("2026-10-08T13:00:00.000Z"),
    ...overrides,
  };
}

describe("PostgresPlatformAdministrationSessionRepository", () => {
  it("returns a global MFA session candidate without asserting platform authority", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [row()], rowCount: 1 });
    const repository = new PostgresPlatformAdministrationSessionRepository({ query } as unknown as Pool);

    await expect(repository.findActiveGlobalMfaSession(SESSION_ID, 15 * 60 * 1000, NOW)).resolves.toEqual({
      session_id: SESSION_ID,
      user_id: USER_ID,
      mfa_status: "SATISFIED",
      last_reauthenticated_at: "2026-10-08T12:00:00.000Z",
      expires_at: "2026-10-08T13:00:00.000Z",
    });

    expect(query).toHaveBeenCalledOnce();
    const [sql, parameters] = query.mock.calls[0] as [string, unknown[]];
    expect(parameters).toEqual([SESSION_ID]);
    expect(sql).toContain("JOIN identity.users AS u ON u.id = s.user_id");
    expect(sql).toContain("s.tenant_id IS NULL");
    expect(sql).toContain("s.tenant_membership_id IS NULL");
    expect(sql).toContain("s.revoked_at IS NULL");
    expect(sql).toContain("s.expires_at > clock_timestamp()");
    expect(sql).toContain("s.mfa_status = 'SATISFIED'");
    expect(sql).toContain("u.status = 'ACTIVE'");
    expect(sql).toContain("FROM identity.mfa_factors AS mf");
    expect(sql).toContain("mf.status = 'ACTIVE'");
    expect(sql).toContain("mf.verified_at IS NOT NULL");
    expect(sql).not.toContain("PLATFORM_ACCOUNT");
    expect(sql).not.toMatch(/\b(password|verifier|secret_reference|refresh_token)\b/i);
  });

  it("requires an effective active PLATFORM role before resolving administrative authority", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [row()], rowCount: 1 });
    const repository = new PostgresPlatformAdministrationSessionRepository({ query } as unknown as Pool);
    await expect(repository.findActivePlatformAdministrationSession(SESSION_ID, 15 * 60 * 1000, NOW))
      .resolves.toMatchObject({ session_id: SESSION_ID, user_id: USER_ID });
    const [sql, parameters] = query.mock.calls[0] as [string, unknown[]];
    expect(parameters).toEqual([SESSION_ID]);
    expect(sql).toContain('FROM "authorization".platform_role_assignments AS pra');
    expect(sql).toContain('JOIN "authorization".roles AS pr');
    expect(sql).toContain("pr.scope_type = 'PLATFORM'");
    expect(sql).toContain("pr.status = 'ACTIVE'");
    expect(sql).toContain("pra.status = 'ACTIVE'");
    expect(sql).toContain("pra.valid_from <= clock_timestamp()");
    expect(sql).toContain("pra.user_id = s.user_id");
  });

  it("fails closed when no effective PLATFORM role assignment exists", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const repository = new PostgresPlatformAdministrationSessionRepository({ query } as unknown as Pool);
    await expect(repository.findActivePlatformAdministrationSession(SESSION_ID, 15 * 60 * 1000, NOW))
      .resolves.toBeNull();
  });

  it("returns null when the persisted session fails a database-side active-session condition", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const repository = new PostgresPlatformAdministrationSessionRepository({ query } as unknown as Pool);

    await expect(repository.findActiveGlobalMfaSession(SESSION_ID, 15 * 60 * 1000, NOW)).resolves.toBeNull();
  });

  it("fails closed when reauthentication is stale", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [row({ last_reauthenticated_at: new Date("2026-10-08T11:00:00.000Z") })],
      rowCount: 1,
    });
    const repository = new PostgresPlatformAdministrationSessionRepository({ query } as unknown as Pool);

    await expect(repository.findActiveGlobalMfaSession(SESSION_ID, 15 * 60 * 1000, NOW)).resolves.toBeNull();
  });

  it("fails closed when the session is expired or the reauthentication timestamp is in the future", async () => {
    const expiredQuery = vi.fn().mockResolvedValue({
      rows: [row({ expires_at: new Date("2026-10-08T12:14:59.000Z") })],
      rowCount: 1,
    });
    const expiredRepository = new PostgresPlatformAdministrationSessionRepository({ query: expiredQuery } as unknown as Pool);
    await expect(expiredRepository.findActiveGlobalMfaSession(SESSION_ID, 15 * 60 * 1000, NOW)).resolves.toBeNull();

    const futureQuery = vi.fn().mockResolvedValue({
      rows: [row({ last_reauthenticated_at: new Date("2026-10-08T12:16:00.000Z") })],
      rowCount: 1,
    });
    const futureRepository = new PostgresPlatformAdministrationSessionRepository({ query: futureQuery } as unknown as Pool);
    await expect(futureRepository.findActiveGlobalMfaSession(SESSION_ID, 15 * 60 * 1000, NOW)).resolves.toBeNull();
  });

  it("rejects an invalid session identifier before querying PostgreSQL", async () => {
    const query = vi.fn();
    const repository = new PostgresPlatformAdministrationSessionRepository({ query } as unknown as Pool);

    await expect(repository.findActiveGlobalMfaSession("not-a-uuid", 15 * 60 * 1000, NOW)).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it("propagates database errors instead of converting them to an unauthenticated result", async () => {
    const failure = new Error("database unavailable");
    const query = vi.fn().mockRejectedValue(failure);
    const repository = new PostgresPlatformAdministrationSessionRepository({ query } as unknown as Pool);

    await expect(repository.findActiveGlobalMfaSession(SESSION_ID, 15 * 60 * 1000, NOW)).rejects.toBe(failure);
  });

  it("rejects invalid reauthentication policy before querying PostgreSQL", async () => {
    const query = vi.fn();
    const repository = new PostgresPlatformAdministrationSessionRepository({ query } as unknown as Pool);

    await expect(repository.findActiveGlobalMfaSession(SESSION_ID, 0, NOW))
      .rejects.toThrow("PLATFORM_ADMINISTRATION_INVALID_REAUTHENTICATION_POLICY");
    expect(query).not.toHaveBeenCalled();
  });
});
