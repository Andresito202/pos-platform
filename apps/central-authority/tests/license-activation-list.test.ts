import { generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { uuidV7 } from "@pos-platform/contracts";
import type { Pool } from "@pos-platform/database-postgres";
import { LicenseCapacityAuthority } from "../src/license-capacity-authority.js";
const guard = vi.hoisted(() => vi.fn());
vi.mock("../src/license-administration.js", () => ({ requireLicenseAdministrator: guard }));
const policy = { profile: "CAMACHO_LICENSE_ACTIVATION_V1", policy_reference: "TEST_ONLY", subscription_grace_days: 3,
  grace_basis: "ELAPSED_24_HOURS", perpetual_use: "NO_EXPIRY", support_and_external_services: "SEPARATE",
  accepted_contract_policy_references: ["TEST_ONLY"], offline_capabilities: ["CASH_REGISTER"] };
function fixture(rows: Record<string, unknown>[] = []) {
  const query = vi.fn(async (sql: string, _args?: unknown[]) => ({ rows: sql.includes("current_user=") ? [{ ok: true }] : sql.includes("FROM licensing.license_activations") ? rows : [], rowCount: 0 }));
  const release = vi.fn(), connect = vi.fn(async () => ({ query, release }));
  const authority = new LicenseCapacityAuthority({ connect } as unknown as Pool, policy,
    { keyId: "TEST", privateKey: generateKeyPairSync("ed25519").privateKey, environment: "PREPRODUCTION" },
    { reauthenticationMs: 60000, lockTimeoutMs: 1000, statementTimeoutMs: 2000 });
  return { authority, query, release, connect };
}
beforeEach(() => { guard.mockReset().mockResolvedValue({ user_id: uuidV7() }); });
describe("bounded GLOBAL activation listing", () => {
  it("checks revoke authority before read and before commit; exposes only projected fields", async () => {
    const rows = Array.from({ length: 51 }, () => ({ id: uuidV7(), license_id: uuidV7(), company_id: uuidV7(), device_id: uuidV7(), activation_status: "ACTIVE", issued_at: new Date("2026-11-10T00:00:00Z"), revoked_at: null, signature: "must not leak" }));
    const f = fixture(rows), session = uuidV7(), cursor = uuidV7();
    const page = await f.authority.listActivations(session, { after: cursor });
    expect(page.activations).toHaveLength(50); expect(page.nextCursor).toBe(rows[49]!.id);
    expect(JSON.stringify(page)).not.toContain("must not leak");
    expect(guard).toHaveBeenCalledTimes(2);
    expect(guard).toHaveBeenCalledWith(expect.anything(), session, 60000, "LICENSE_REVOKE");
    expect(f.query).toHaveBeenCalledWith(expect.stringContaining("ORDER BY id LIMIT 51"), [cursor]);
    expect(f.query).toHaveBeenLastCalledWith("COMMIT"); expect(f.release).toHaveBeenCalledOnce();
  });
  it("does not read activations after authorization rejection", async () => {
    guard.mockRejectedValue(Error("DENIED")); const f = fixture();
    await expect(f.authority.listActivations(uuidV7(), { after: null })).rejects.toThrow("DENIED");
    expect(f.query.mock.calls.some(([sql]) => sql.includes("FROM licensing.license_activations"))).toBe(false);
    expect(f.query).toHaveBeenLastCalledWith("ROLLBACK"); expect(f.release).toHaveBeenCalledOnce();
  });
  it("rejects forged scope and invalid cursors before opening a transaction", async () => {
    const f = fixture();
    for (const input of [{ after: "bad" }, { after: null, tenant_id: uuidV7() }, {}]) {
      await expect(f.authority.listActivations(uuidV7(), input)).rejects.toThrow();
    }
    expect(f.connect).not.toHaveBeenCalled();
  });
  it("rolls back when authority is revoked before completion", async () => {
    guard.mockResolvedValueOnce({}).mockRejectedValueOnce(Error("REVOKED")); const f = fixture();
    await expect(f.authority.listActivations(uuidV7(), { after: null })).rejects.toThrow("REVOKED");
    expect(f.query).not.toHaveBeenCalledWith("COMMIT"); expect(f.query).toHaveBeenLastCalledWith("ROLLBACK");
  });
});
