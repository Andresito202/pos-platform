import { describe, expect, it } from "vitest";
import { readArtifact, sha256 } from "../src/shared.js";
import { PASSWORD_RECOVERY_007_TABLES, POSTGRES_007_DESCRIPTOR } from "../src/postgres-007-contract.js";

describe("PostgreSQL 007 password recovery", () => {
  it("depends on licensing foundation and owns only the recovery table", () => {
    expect(POSTGRES_007_DESCRIPTOR.migrationId).toBe("007_password_recovery");
    expect(POSTGRES_007_DESCRIPTOR.dependencies).toEqual(["006_licensing_foundation"]);
    expect(POSTGRES_007_DESCRIPTOR.ownedSchemas).toEqual(["identity"]);
    expect(POSTGRES_007_DESCRIPTOR.ownedTables).toEqual(PASSWORD_RECOVERY_007_TABLES);
  });

  it("stores only hashed one-time recovery material with expiry, attempts and forced RLS", async () => {
    const sql = await readArtifact(POSTGRES_007_DESCRIPTOR.upArtifact);
    expect(sql).toContain("token_hash");
    expect(sql).toContain("EXPI");
    expect(sql).toContain("CONSUMED");
    expect(sql).toContain("max_attempts");
    expect(sql).toContain("FORCE ROW LEVEL SECURITY");
    expect(sql).not.toContain("token text");
    expect(sha256(sql)).toHaveLength(32);
  });
});
