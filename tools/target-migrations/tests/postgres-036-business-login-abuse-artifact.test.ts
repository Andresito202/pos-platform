import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { POSTGRES_036_DESCRIPTOR, commercialMigrationManifest } from "../src/postgres-commercial-runner.js";

const sqlRoot = join(dirname(fileURLToPath(import.meta.url)), "../sql/postgres");

describe("036_business_login_abuse_budget artifact", () => {
  it("registers LOGIN_ABUSE_BUDGET manifest checksum from up artifact", async () => {
    expect(POSTGRES_036_DESCRIPTOR.migrationId).toBe("036_business_login_abuse_budget");
    expect(POSTGRES_036_DESCRIPTOR.upArtifact).toBe("postgres/036_business_login_abuse_budget.up.sql");
    expect(POSTGRES_036_DESCRIPTOR.downArtifact).toBe("postgres/036_business_login_abuse_budget.down.sql");
    const manifest = await commercialMigrationManifest("LOGIN_ABUSE_BUDGET");
    expect(Object.keys(manifest)).toEqual(["036_business_login_abuse_budget"]);
    const up = await readFile(join(sqlRoot, "036_business_login_abuse_budget.up.sql"), "utf8");
    expect(manifest["036_business_login_abuse_budget"]).toBe(
      createHash("sha256").update(up).digest("hex"),
    );
    expect(up).toContain("BUSINESS_LOGIN_ACCOUNT");
    expect(up).toContain("BUSINESS_LOGIN_ADDRESS");
  });
});
