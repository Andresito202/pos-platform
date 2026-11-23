import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  POSTGRES_023_DESCRIPTOR,
  POSTGRES_035_DESCRIPTOR,
  commercialMigrationManifest,
} from "../src/postgres-commercial-runner.js";

const sqlRoot = join(dirname(fileURLToPath(import.meta.url)), "../sql/postgres");

/**
 * Offline artifact / wiring checks only. Runtime apply against PostgreSQL remains
 * NO VERIFICADO until a disposable authorized loopback server is available.
 */
describe("035_subscription_license_fulfillment artifact", () => {
  it("wires descriptor after 023 and exposes SUBSCRIPTION_FULFILLMENT target", async () => {
    expect(POSTGRES_035_DESCRIPTOR.migrationId).toBe("035_subscription_license_fulfillment");
    expect(POSTGRES_035_DESCRIPTOR.dependencies).toEqual([POSTGRES_023_DESCRIPTOR.migrationId]);
    expect(POSTGRES_035_DESCRIPTOR.upArtifact).toBe("postgres/035_subscription_license_fulfillment.up.sql");
    expect(POSTGRES_035_DESCRIPTOR.downArtifact).toBe("postgres/035_subscription_license_fulfillment.down.sql");
    expect(POSTGRES_035_DESCRIPTOR.ownedSchemas).toEqual(["subscriptions"]);
    expect(POSTGRES_035_DESCRIPTOR.ownedTables).toEqual(["subscriptions.license_fulfillment_jobs"]);

    const manifest = await commercialMigrationManifest("SUBSCRIPTION_FULFILLMENT");
    expect(Object.keys(manifest)).toEqual(["035_subscription_license_fulfillment"]);
    expect(manifest["035_subscription_license_fulfillment"]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("defines recoverable claim/status columns without device activation promises", async () => {
    const up = await readFile(join(sqlRoot, "035_subscription_license_fulfillment.up.sql"), "utf8");
    const down = await readFile(join(sqlRoot, "035_subscription_license_fulfillment.down.sql"), "utf8");

    expect(up).toContain("license_fulfillment_jobs");
    expect(up).toContain("PENDING");
    expect(up).toContain("CONFIRMED");
    expect(up).toContain("ISSUED");
    expect(up).toContain("DELIVERY_PENDING");
    expect(up).toContain("ACTIVATION_PENDING");
    expect(up).toContain("claim_token");
    expect(up).toContain("claim_expires_at");
    expect(up).toContain("UNIQUE (payment_id)");
    expect(up).toContain("FORCE ROW LEVEL SECURITY");
    expect(up).toContain("BANK_MANUAL_VERIFIED");
    expect(up).toContain("FACTUS_PAY_WEBHOOK_INBOX");
    expect(up).not.toMatch(/skipAuth|synthetic.?session|fake.?mfa/i);

    expect(down).toContain("035 down refused");
    expect(down).toContain("license_fulfillment_jobs");
  });
});
