import { describe, expect, it } from "vitest";
import { readArtifact, sha256 } from "../src/shared.js";
import { PLATFORM_ROLE_008_TABLES, POSTGRES_008_DESCRIPTOR } from "../src/postgres-008-platform-roles-contract.js";

describe("PostgreSQL 008 global platform role assignments", () => {
  it("follows password recovery and owns only the global assignment relation", () => {
    expect(POSTGRES_008_DESCRIPTOR.migrationId).toBe("008_platform_role_assignments");
    expect(POSTGRES_008_DESCRIPTOR.dependencies).toEqual(["007_password_recovery"]);
    expect(POSTGRES_008_DESCRIPTOR.ownedSchemas).toEqual(["authorization"]);
    expect(POSTGRES_008_DESCRIPTOR.ownedTables).toEqual(PLATFORM_ROLE_008_TABLES);
  });

  it("restricts assignment to PLATFORM roles and platform service access", async () => {
    const sql = await readArtifact(POSTGRES_008_DESCRIPTOR.upArtifact);
    expect(sql).toContain("CHECK (role_scope_type = 'PLATFORM')");
    expect(sql).toContain('FOREIGN KEY (role_id, role_scope_type)');
    expect(sql).toContain("FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("TO pos_platform_app");
    expect(sql).toContain("REVOKE ALL ON");
    expect(sql).not.toMatch(/INSERT\s+INTO\s+"authorization"\.platform_role_assignments/i);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+identity\.users/i);
    expect(sha256(sql)).toHaveLength(32);
  });

  it("refuses rollback while global assignments remain", async () => {
    const sql = await readArtifact(POSTGRES_008_DESCRIPTOR.downArtifact);
    expect(sql).toContain("IF EXISTS (SELECT 1 FROM \"authorization\".platform_role_assignments)");
    expect(sql).toContain("RAISE EXCEPTION");
    expect(sql).toContain("DROP TABLE \"authorization\".platform_role_assignments");
  });

  it("requires explicit revocation evidence and leaves bootstrap authority unassigned", async () => {
    const sql = await readArtifact(POSTGRES_008_DESCRIPTOR.upArtifact);
    expect(sql).toContain("revoked_by_actor_type");
    expect(sql).toContain("revocation_reason");
    expect(sql).toContain("created_by_actor_type");
    expect(sql).not.toContain("DEFAULT 'ACTIVE'"); 
  });
});
