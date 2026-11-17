import { describe, expect, it } from "vitest";
import {
  commercialMigrationManifest,
  POSTGRES_027_DESCRIPTOR,
  POSTGRES_028_DESCRIPTOR,
} from "../src/postgres-commercial-runner.js";
import { POSTGRES_028_DESCRIPTOR as CONTRACT } from "../src/postgres-028-domain-projections-contract.js";
import { readArtifact, sha256 } from "../src/shared.js";

describe("028 sync domain projections", () => {
  it("registers additive commercial successor after 027", async () => {
    expect(POSTGRES_028_DESCRIPTOR.migrationId).toBe("028_sync_domain_projections");
    expect(POSTGRES_028_DESCRIPTOR.dependencies).toEqual([POSTGRES_027_DESCRIPTOR.migrationId]);
    expect(CONTRACT.ownedTables).toEqual(["sync.domain_projections"]);
    const up = await readArtifact(POSTGRES_028_DESCRIPTOR.upArtifact);
    const manifest = await commercialMigrationManifest("MERCHANT_NOTIFICATIONS");
    expect(manifest[POSTGRES_028_DESCRIPTOR.migrationId]).toBe(sha256(up).toString("hex"));
    expect((await commercialMigrationManifest("MERCHANT_DESTINATIONS"))[POSTGRES_028_DESCRIPTOR.migrationId]).toBeUndefined();
  });

  it("creates tenant-isolated projection ledger without inventing a second sync engine", async () => {
    const up = await readArtifact(POSTGRES_028_DESCRIPTOR.upArtifact);
    expect(up).toContain("CREATE TABLE sync.domain_projections");
    expect(up).toContain("UNIQUE (tenant_id, operation_id)");
    expect(up).toContain("FORCE ROW LEVEL SECURITY");
    expect(up).toContain("domain_projections_tenant_isolation");
    expect(up).toContain("REFERENCES sync.sync_operations");
    expect(up).toContain("GRANT SELECT, INSERT ON sync.domain_projections TO pos_app, pos_worker, pos_platform_app");
    expect(up).not.toContain("CREATE SCHEMA sync");
    expect(up).not.toContain("factus");
    const down = await readArtifact(POSTGRES_028_DESCRIPTOR.downArtifact);
    expect(down).toContain("cannot downgrade sync.domain_projections while projection evidence exists");
    expect(down).not.toContain("CASCADE");
  });
});
