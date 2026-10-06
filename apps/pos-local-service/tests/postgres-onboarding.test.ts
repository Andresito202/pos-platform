import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPostgresPool } from "@pos-platform/database-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InitializeTenant } from "../src/onboarding/initialize-tenant.js";
import { PostgresOnboardingRepository } from "@pos-platform/database-postgres";
import { uuidV7 } from "@pos-platform/database-postgres";

const SERVER_URL = process.env.POSTGRES_TEST_URL ?? "postgres://postgres@127.0.0.1:55432/postgres";
const DATABASE = "target_database_postgres_onboarding";
const NOW = new Date("2026-10-05T12:00:00.000Z");
const OWNER_ROLE = "OWNER";

function dbUrl(): string { const url = new URL(SERVER_URL); url.pathname = "/" + DATABASE; return url.toString(); }
function roleUrl(role: string): string { const url = new URL(dbUrl()); url.username = role; url.password = ""; return url.toString(); }

function request(suffix: string, actorId = "01890f5a-0000-7000-8000-000000000001"): OnboardingInput {
  return {
    actor: { type: "PLATFORM_ACCOUNT", id: actorId },
    tenantName: "Tenant " + suffix,
    tenantCode: "TEN-" + suffix,
    commercialReference: "COMM-" + suffix,
    companyName: "Company " + suffix,
    companyTaxId: "900.123.456-7",
    branchName: "Branch " + suffix,
    ownerEmail: "owner+" + suffix.toLowerCase() + "@example.test",
    ownerFullName: "Owner " + suffix,
    initialLocale: "es-CO",
    initialTimezone: "America/Bogota",
    initialCurrency: "COP",
    initialConfiguration: { taxPolicyVersion: "tax-v1", pricingPolicyVersion: "pricing-v1" },
    idempotencyKey: "onb-" + suffix,
    correlationId: uuidV7(NOW),
  };
}

describe("database-postgres ONB-002 integration", () => {
  let admin: Pool;
  let runtime: Pool;
  let inspection: Pool;

  beforeAll(async () => {
    admin = createPostgresPool(SERVER_URL, 2);
    await admin.query('DROP DATABASE IF EXISTS "' + DATABASE + '" WITH (FORCE)');
    await admin.query('CREATE DATABASE "' + DATABASE + '"');

    const bootstrap = await readFile(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tools", "target-migrations", "sql", "postgres", "bootstrap.sql"), "utf8");
    const foundation = await readFile(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tools", "target-migrations", "sql", "postgres", "001_central_foundation.up.sql"), "utf8");
    const hardening = await readFile(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tools", "target-migrations", "sql", "postgres", "005_onboarding_bootstrap_hardening.up.sql"), "utf8");

    const root = createPostgresPool({ connectionString: dbUrl() });
    try {
      await root.query(bootstrap);
      await root.query(foundation);
      await root.query("SET ROLE pos_schema_owner");
      await root.query(hardening);
      await root.query(
        `INSERT INTO "authorization".roles(id,code,name,scope_type,version,status,created_at)
         VALUES ($1,$2,'Propietario del comercio','BUSINESS',1,'ACTIVE',clock_timestamp())`,
        [uuidV7(NOW), OWNER_ROLE],
      );
    } finally {
      await root.end();
    }
    runtime = createPostgresPool(roleUrl("pos_platform_app"), 4);
    inspection = createPostgresPool(dbUrl(), 2);
  }, 120_000);

  afterAll(async () => {
    await runtime?.end();
    await inspection?.end();
    await admin?.query('DROP DATABASE IF EXISTS "' + DATABASE + '" WITH (FORCE)');
    await admin?.end();
  });

  function useCase(): InitializeTenant {
    return new InitializeTenant(
      new PostgresOnboardingRepository(runtime),
      { authorize: async () => undefined },
      () => NOW,
    );
  }

  it("persists the complete chain, seven audit events and one central outbox", async () => {
    const outcome = await useCase().execute(request("A"));
    expect(outcome.status).toBe("READY_FOR_LICENSE");

    const tenant = (await inspection.query("SELECT id FROM tenancy.tenants WHERE id=$1", [outcome.tenantId])).rows[0];
    expect(tenant.id).toBe(outcome.tenantId);

    const config = (await inspection.query(
      "SELECT pricing_policy_version,tax_policy_version FROM tenancy.onboarding_operations WHERE id=$1",
      [outcome.onboardingId],
    )).rows[0];
    expect(config).toEqual({ pricing_policy_version: "pricing-v1", tax_policy_version: "tax-v1" });

    const audits = (await inspection.query(
      "SELECT action_code FROM audit.audit_events WHERE correlation_id=$1 ORDER BY action_code",
      [outcome.correlationId],
    )).rows.map((row: { action_code: string }) => row.action_code);
    expect(audits).toEqual([
      "BRANCH_CREATED", "COMPANY_CREATED", "ONBOARDING_STARTED", "ONBOARDING_STATUS_CHANGED",
      "OWNER_ROLE_ASSIGNED", "TENANT_CREATED", "TENANT_OWNER_ASSIGNED",
    ]);

    const outbox = (await inspection.query(
      "SELECT operation_type,sync_status FROM sync.outbox_entries WHERE tenant_id=$1",
      [outcome.tenantId],
    )).rows;
    expect(outbox).toEqual([{ operation_type: "TENANT_ONBOARDED", sync_status: "READY_TO_SYNC" }]);
  });

  it("uses physical idempotency under concurrent identical requests", async () => {
    const base = request("B");
    const [first, second] = await Promise.all([useCase().execute(base), useCase().execute(base)]);
    expect([first.tenantId, second.tenantId].sort()).toEqual([first.tenantId, second.tenantId].sort());
    expect(new Set([first.onboardingId, second.onboardingId]).size).toBe(1);
    expect(new Set([first.status, second.status])).toEqual(new Set(["READY_FOR_LICENSE"]));
    expect((await inspection.query("SELECT count(*)::int AS n FROM tenancy.onboarding_operations WHERE idempotency_key=$1", [base.idempotencyKey])).rows[0].n).toBe(1);
  });

  it("rejects a commercial reference already claimed by another actor", async () => {
    const first = await useCase().execute(request("C"));
    const conflicting = { ...request("D", "01890f5a-0000-7000-8000-000000000002"), commercialReference: "COMM-C" };
    await expect(useCase().execute(conflicting)).rejects.toThrow("ONBOARDING_COMMERCIAL_REFERENCE_CONFLICT");
    expect((await inspection.query("SELECT count(*)::int AS n FROM tenancy.tenants WHERE id=$1", [first.tenantId])).rows[0].n).toBe(1);
    expect((await inspection.query("SELECT count(*)::int AS n FROM tenancy.tenants WHERE name=$1", [conflicting.tenantName])).rows[0].n).toBe(0);
  });

  it("rejects unsupported configuration instead of persisting a generic blob", async () => {
    const bad = { ...request("G"), initialConfiguration: { printer: "raw" } };
    await expect(useCase().execute(bad)).rejects.toThrow("ONBOARDING_CONFIGURATION_UNSUPPORTED_printer");
    expect((await inspection.query("SELECT count(*)::int AS n FROM tenancy.tenants WHERE code=$1", [bad.tenantCode])).rows[0].n).toBe(0);
  });

  it("reuses the owner identity across tenants without crossing memberships", async () => {
    const a = await useCase().execute(request("E"));
    const b = await useCase().execute({ ...request("F"), ownerEmail: "owner+e@example.test" });
    expect(a.ownerUserId).toBe(b.ownerUserId);
    expect(a.tenantId).not.toBe(b.tenantId);
    const memberships = (await inspection.query("SELECT tenant_id FROM tenancy.tenant_memberships WHERE user_id=$1 ORDER BY tenant_id", [a.ownerUserId])).rows.map((row: { tenant_id: string }) => row.tenant_id);
    expect(memberships).toEqual([a.tenantId, b.tenantId].sort());
  });
});
