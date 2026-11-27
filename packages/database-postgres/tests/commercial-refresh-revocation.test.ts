import type { Pool } from "pg";
import { afterEach, expect, it, vi } from "vitest";
import { PostgresCommercialRefreshFamilies } from "../src/commercial-refresh-families.js";
import { PostgresCommercialPossessionVerifier } from "../src/device-proof-replay-verifier.js";
import { PostgresPlatformSecurityEventRepository } from "../src/platform-security-event-repository.js";

afterEach(() => vi.restoreAllMocks());

it("requires fresh revoke possession and audits the scoped family update once", async () => {
  const id = (n: number) => `018f0000-0000-7000-8000-${String(n).padStart(12, "0")}`;
  const at = new Date();
  const row = {
    token_family_id: id(1), session_id: id(2), tenant_id: id(3), credential_id: id(4),
    installation_id: id(5), device_id: id(6),
  };
  const possession = vi.spyOn(PostgresCommercialPossessionVerifier.prototype, "verifyRevokeAndConsume");
  const writeEvent = vi.spyOn(PostgresPlatformSecurityEventRepository.prototype, "append")
    .mockImplementation(async (event) => ({ ...event, server_recorded_at: at.toISOString() }));
  let revoked = false;
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("FROM identity.sessions")) return { rows: [{ user_id: id(7) }] };
    if (sql.includes("UPDATE identity.session_refresh_tokens")) {
      if (revoked) return { rowCount: 0 };
      revoked = true;
      return { rowCount: 2 };
    }
    return { rows: [{ at }] };
  });
  const connect = vi.fn(async () => ({ query, release: vi.fn() }));
  const pool = { query: vi.fn(async () => ({ rows: [row] })), connect } as unknown as Pool;
  const authority = new PostgresCommercialRefreshFamilies(pool, {
    origin: "https://central.example.dev", audience: "commercial", clientId: "android-commercial",
    lifetimeMs: 60_000, maximumReauthenticationAgeMs: 60_000, maximumProofSkewMs: 10_000,
    rotationWindowMs: 60_000, maximumRotationsPerWindow: 2,
  });
  const request = {
    requestId: id(8), correlationId: id(9), authorization: "test-proof",
    body: JSON.stringify({ client_id: "android-commercial", refresh_token: "r".repeat(64) }),
  };
  possession.mockResolvedValueOnce(null);
  await expect(authority.revoke(request)).resolves.toBe(false);
  expect(connect).not.toHaveBeenCalled();

  possession.mockResolvedValue({
    requestId: id(8), correlationId: id(9), companyId: id(10), credentialExpiresAt: at.toISOString(),
    tenantId: row.tenant_id, deviceId: row.device_id, installationId: row.installation_id, credentialId: row.credential_id,
  });
  await expect(authority.revoke(request)).resolves.toBe(true);
  await expect(authority.revoke({ ...request, requestId: id(11), correlationId: id(12) })).resolves.toBe(true);
  expect(possession).toHaveBeenCalledWith(request, expect.objectContaining({
    operation: "REVOKE", deviceId: row.device_id, tenantId: row.tenant_id, credentialId: row.credential_id,
  }), 10_000);
  expect(query).toHaveBeenCalledWith(expect.stringContaining("WHERE token_family_id=$1 AND session_id=$2 AND tenant_id=$3"),
    [row.token_family_id, row.session_id, row.tenant_id]);
  expect(writeEvent).toHaveBeenCalledTimes(1);
  expect(writeEvent).toHaveBeenCalledWith(expect.objectContaining({ reason_code: "NATIVE_LOGOUT", result: "REVOKED" }),
    expect.objectContaining({ query }));
});
