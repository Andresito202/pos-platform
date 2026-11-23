import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  POSTGRES_033_DESCRIPTOR,
  POSTGRES_034_DESCRIPTOR,
  commercialMigrationManifest,
} from "../src/postgres-commercial-runner.js";

const sqlRoot = join(dirname(fileURLToPath(import.meta.url)), "../sql/postgres");

/**
 * Offline artifact / wiring checks only. Runtime apply against PostgreSQL remains
 * NO VERIFICADO until a disposable loopback server is available.
 */
describe("034_reporting_aggregate_permissions artifact", () => {
  it("wires descriptor after 033 and exposes REPORTING_PERMISSIONS target", async () => {
    expect(POSTGRES_034_DESCRIPTOR.migrationId).toBe("034_reporting_aggregate_permissions");
    expect(POSTGRES_034_DESCRIPTOR.dependencies).toEqual([POSTGRES_033_DESCRIPTOR.migrationId]);
    expect(POSTGRES_034_DESCRIPTOR.upArtifact).toBe("postgres/034_reporting_aggregate_permissions.up.sql");
    expect(POSTGRES_034_DESCRIPTOR.downArtifact).toBe("postgres/034_reporting_aggregate_permissions.down.sql");
    expect(POSTGRES_034_DESCRIPTOR.ownedSchemas).toEqual(["authorization"]);
    expect(POSTGRES_034_DESCRIPTOR.ownedTables).toEqual([]);

    const manifest = await commercialMigrationManifest("REPORTING_PERMISSIONS");
    expect(Object.keys(manifest)).toEqual(["034_reporting_aggregate_permissions"]);
    expect(manifest["034_reporting_aggregate_permissions"]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("catalogs three REPORTING_* codes without role_permission_grants", async () => {
    const up = await readFile(join(sqlRoot, "034_reporting_aggregate_permissions.up.sql"), "utf8");
    const down = await readFile(join(sqlRoot, "034_reporting_aggregate_permissions.down.sql"), "utf8");

    expect(up).toContain("REPORTING_SALES_AGGREGATE_READ");
    expect(up).toContain("REPORTING_CASH_AGGREGATE_READ");
    expect(up).toContain("REPORTING_PAYMENTS_AGGREGATE_READ");
    expect(up).toContain('INSERT INTO "authorization".permissions');
    expect(up).not.toMatch(/role_permission_grants/i);
    const executable = up
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    expect(executable).not.toMatch(/GENERAL_ADMIN|SUPERVISOR|CASHIER|PLATFORM_OWNER/);
    expect(executable).toMatch(/INSERT INTO "authorization"\.permissions/);

    expect(down).toContain("REPORTING_AGGREGATE_PERMISSIONS_ROLLBACK_REQUIRES_REVIEW");
  });
});
