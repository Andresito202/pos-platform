import { describe, expect, it } from "vitest";
import { readArtifact, sha256 } from "../src/shared.js";
import { LICENSING_006_TABLES, POSTGRES_006_DESCRIPTOR } from "../src/postgres-006-contract.js";

describe("PostgreSQL 006 licensing foundation", () => {
  it("depends on onboarding hardening and owns only licensing tables", () => {
    expect(POSTGRES_006_DESCRIPTOR.migrationId).toBe("006_licensing_foundation");
    expect(POSTGRES_006_DESCRIPTOR.dependencies).toEqual(["005_onboarding_bootstrap_hardening"]);
    expect(POSTGRES_006_DESCRIPTOR.ownedSchemas).toEqual(["licensing"]);
    expect(POSTGRES_006_DESCRIPTOR.ownedTables).toEqual(LICENSING_006_TABLES);
  });

  it("materializes monthly, annual and perpetual contract primitives without sentinel limits", async () => {
    const sql = await readArtifact(POSTGRES_006_DESCRIPTOR.upArtifact);
    expect(sql).toContain("MONTHLY");
    expect(sql).toContain("ANNUAL");
    expect(sql).toContain("PERPETUAL");
    expect(sql).toContain("LOCAL_PERPETUAL");
    expect(sql).toContain("FINITE");
    expect(sql).toContain("UNLIMITED");
    expect(sql).toContain("NOT_APPLICABLE");
    expect(sql).not.toContain("Number.MAX_VALUE");
    expect(sql).toContain("FORCE ROW LEVEL SECURITY");
    expect(sha256(sql)).toHaveLength(32);
  });
});
