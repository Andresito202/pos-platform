import { describe, expect, it } from "vitest";
import { readArtifact, sha256 } from "../src/shared.js";
import { FACTUS_PAY_009_TABLES, POSTGRES_009_DESCRIPTOR } from "../src/postgres-009-contract.js";

describe("PostgreSQL 009 Factus Pay webhook inbox", () => {
  it("depends on integration foundations and password recovery without modifying prior migrations", () => {
    expect(POSTGRES_009_DESCRIPTOR.migrationId).toBe("009_factus_pay_webhook_inbox");
    expect(POSTGRES_009_DESCRIPTOR.dependencies).toEqual(["002_external_integrations_foundation", "007_password_recovery"]);
    expect(POSTGRES_009_DESCRIPTOR.ownedSchemas).toEqual(["integrations"]);
    expect(POSTGRES_009_DESCRIPTOR.ownedTables).toEqual(FACTUS_PAY_009_TABLES);
  });

  it("stores only a hash of the webhook secret and durable normalized collection fields", async () => {
    const sql = await readArtifact(POSTGRES_009_DESCRIPTOR.upArtifact);
    expect(sql).toContain("secret_sha256");
    expect(sql).toContain("factus_pay_webhook_inbox");
    expect(sql).toContain("external_transaction_id");
    expect(sql).toContain("amount numeric(19,6)");
    expect(sql).toContain("UNIQUE (tenant_id,integration_id,external_transaction_id)");
    expect(sql).toContain("FORCE ROW LEVEL SECURITY");
    expect(sql).not.toMatch(/secret\s+text/i);
    expect(sha256(sql)).toHaveLength(32);
  });

  it("refuses destructive rollback after keys or collection history exist", async () => {
    const sql = await readArtifact(POSTGRES_009_DESCRIPTOR.downArtifact);
    expect(sql).toContain("down refused");
    expect(sql).toContain("IF EXISTS (SELECT 1 FROM integrations.factus_pay_webhook_inbox)");
    expect(sql).toContain("IF EXISTS (SELECT 1 FROM integrations.factus_pay_webhook_keys)");
  });
});
