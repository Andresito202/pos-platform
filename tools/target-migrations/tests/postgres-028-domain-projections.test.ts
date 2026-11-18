import { describe, expect, it } from "vitest";
import {
  DOMAIN_PROJECTIONS_028_TABLES,
  POSTGRES_028_DESCRIPTOR,
} from "../src/postgres-028-domain-projections-contract.js";
import { readArtifact, sha256 } from "../src/shared.js";

describe("028 sync domain projections", () => {
  it("registers the tip additive projection migration without merchant/FACTUS chain wiring", async () => {
    expect(POSTGRES_028_DESCRIPTOR.migrationId).toBe("028_sync_domain_projections");
    // Tip commercial chain lists 027 as successor dependency; Wave 3 lab apply
    // uses the isolated runner (predecessor 001). Do not pull merchant 025–027.
    expect(POSTGRES_028_DESCRIPTOR.dependencies).toEqual(["027_merchant_notice_revocation_guard"]);
    expect(DOMAIN_PROJECTIONS_028_TABLES).toEqual(["sync.domain_projections"]);
    expect(POSTGRES_028_DESCRIPTOR.ownedTables).toEqual(["sync.domain_projections"]);
    const up = await readArtifact(POSTGRES_028_DESCRIPTOR.upArtifact);
    expect(sha256(up).toString("hex")).toMatch(/^[0-9a-f]{64}$/);
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
