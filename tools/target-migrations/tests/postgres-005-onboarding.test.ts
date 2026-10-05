import { describe, expect, it } from "vitest";
import { readArtifact, sha256 } from "../src/shared.js";
import { POSTGRES_005_DESCRIPTOR } from "../src/postgres-005-contract.js";

describe("PostgreSQL 005 onboarding hardening", () => {
  it("follows 004 without stealing table ownership from 001", () => {
    expect(POSTGRES_005_DESCRIPTOR.migrationId).toBe("005_onboarding_bootstrap_hardening");
    expect(POSTGRES_005_DESCRIPTOR.dependencies).toEqual(["004_device_trust"]);
    expect(POSTGRES_005_DESCRIPTOR.ownedTables).toEqual([]);
  });
  it("contains the commercial reference and actor-scoped RLS boundary", async () => {
    const sql = await readArtifact(POSTGRES_005_DESCRIPTOR.upArtifact);
    expect(sql).toContain("ADD COLUMN commercial_reference");
    expect(sql).toContain("onboarding_operations_commercial_reference_uq");
    expect(sql).toContain("current_setting('app.actor_id', true)");
    expect(sql).toContain("FORCE ROW LEVEL SECURITY");
    expect(sha256(sql)).toHaveLength(32);
  });
});
