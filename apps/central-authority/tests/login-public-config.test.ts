import { createServer, request, type Server } from "node:https";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BusinessAdministrationProvisionSchema, type BusinessAdministrationProvision } from "@pos-platform/contracts";
import type { Pool } from "@pos-platform/database-postgres";
import { createBusinessAdministrationHandler } from "../src/business-administration-http.js";
import { createGlobalAdministrationHandler } from "../src/global-administration-http.js";
import { businessTestTls } from "./helpers/business-test-tls.js";

const tls = businessTestTls();
let server: Server | undefined;
let port = 0;
let origin = "";

async function get(path: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
    const req = request({
      hostname: "127.0.0.1", port, path, method: "GET", ca: tls.cert,
      headers: { "sec-fetch-site": "same-origin", ...headers },
    }, res => {
      let payload = "";
      res.on("data", b => payload += b);
      res.on("end", () => resolve({ status: res.statusCode!, body: payload ? JSON.parse(payload) : {} }));
    });
    req.on("error", reject);
    req.end();
  });
}

afterEach(async () => {
  await new Promise<void>((resolve, reject) => server?.close(err => err ? reject(err) : resolve()) ?? resolve());
  server = undefined;
});

describe("login public-config", () => {
  beforeEach(async () => {
    server = createServer(tls);
    await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw Error("TEST_LISTENER_MISSING");
    port = address.port;
    origin = `https://127.0.0.1:${port}`;
  });

  it("BUSINESS exposes null site key when Turnstile is off", async () => {
    const policy = BusinessAdministrationProvisionSchema.parse({
      profile: "CAMACHO_BUSINESS_ADMINISTRATION_V1", origin, rp_id: "127.0.0.1", expected_database: "camacho_pos",
      rejection_verifier_file: "TEST_ONLY",
      migration_checksums: Object.fromEntries([
        "013_business_browser_sessions", "015_authorization_snapshot_sequences", "019_subscription_quotes",
        "020_subscription_payments", "022_license_activations", "023_license_offer_terms", "029_cash_register_master",
        "030_commercial_authorization_catalog", "031_business_owner_role", "032_tenant_initialization_permission",
        "033_cash_register_license_bindings",
      ].map(id => [id, "a".repeat(64)])),
      license_policy: {
        profile: "CAMACHO_LICENSE_ACTIVATION_V1", policy_reference: "TEST_ONLY", subscription_grace_days: 3,
        grace_basis: "ELAPSED_24_HOURS", perpetual_use: "NO_EXPIRY", support_and_external_services: "SEPARATE",
        accepted_contract_policy_references: ["TEST_ONLY"], offline_capabilities: ["CASH_REGISTER"],
      },
      renderer: { directory: "/tmp", maximum_asset_bytes: 1 },
      limits: {
        challenge_ms: 60_000, session_ms: 3_600_000, browser_ms: 3_600_000, mfa_age_ms: 300_000,
        reauthentication_ms: 300_000, idle_ms: 1_800_000, sql_lock_ms: 1_000, sql_statement_ms: 5_000,
        maximum_body_bytes: 8192, maximum_pending_flows: 16, requests_per_window: 120, maximum_buckets: 256,
        request_window_ms: 60_000, maximum_login_per_account: 20, login_window_ms: 60_000, maximum_login_per_address: 40,
      },
    }) satisfies BusinessAdministrationProvision;
    const pool = { connect: async () => ({ query: vi.fn(), release: vi.fn() }) } as unknown as Pool;
    server!.removeAllListeners("request");
    server!.on("request", createBusinessAdministrationHandler(pool, policy, "TEST_VERIFIER_NOT_USED"));
    const res = await get("/v1/business/login/public-config");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ turnstileSiteKey: null });
  });

  it("BUSINESS exposes site key when Turnstile pair is configured", async () => {
    const policy = BusinessAdministrationProvisionSchema.parse({
      profile: "CAMACHO_BUSINESS_ADMINISTRATION_V1", origin, rp_id: "127.0.0.1", expected_database: "camacho_pos",
      rejection_verifier_file: "TEST_ONLY",
      migration_checksums: Object.fromEntries([
        "013_business_browser_sessions", "015_authorization_snapshot_sequences", "019_subscription_quotes",
        "020_subscription_payments", "022_license_activations", "023_license_offer_terms", "029_cash_register_master",
        "030_commercial_authorization_catalog", "031_business_owner_role", "032_tenant_initialization_permission",
        "033_cash_register_license_bindings",
      ].map(id => [id, "a".repeat(64)])),
      license_policy: {
        profile: "CAMACHO_LICENSE_ACTIVATION_V1", policy_reference: "TEST_ONLY", subscription_grace_days: 3,
        grace_basis: "ELAPSED_24_HOURS", perpetual_use: "NO_EXPIRY", support_and_external_services: "SEPARATE",
        accepted_contract_policy_references: ["TEST_ONLY"], offline_capabilities: ["CASH_REGISTER"],
      },
      renderer: { directory: "/tmp", maximum_asset_bytes: 1 },
      turnstile_secret_file: "/tmp/turnstile-secret",
      turnstile_site_key: "0x4AAAAAAATESTKEY",
      limits: {
        challenge_ms: 60_000, session_ms: 3_600_000, browser_ms: 3_600_000, mfa_age_ms: 300_000,
        reauthentication_ms: 300_000, idle_ms: 1_800_000, sql_lock_ms: 1_000, sql_statement_ms: 5_000,
        maximum_body_bytes: 8192, maximum_pending_flows: 16, requests_per_window: 120, maximum_buckets: 256,
        request_window_ms: 60_000, maximum_login_per_account: 20, login_window_ms: 60_000, maximum_login_per_address: 40,
      },
    });
    const pool = { connect: async () => ({ query: vi.fn(), release: vi.fn() }) } as unknown as Pool;
    server!.removeAllListeners("request");
    server!.on("request", createBusinessAdministrationHandler(
      pool, policy, "TEST_VERIFIER_NOT_USED", "turnstile-secret-value", "0x4AAAAAAATESTKEY",
    ));
    const res = await get("/v1/business/login/public-config");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ turnstileSiteKey: "0x4AAAAAAATESTKEY" });
  });

  it("rejects mismatched Turnstile secret/site-key pairs at handler construction", () => {
    const pool = { connect: async () => ({ query: vi.fn(), release: vi.fn() }) } as unknown as Pool;
    const limits = {
      maximumBodyBytes: 8192, maximumPendingFlows: 8, requestsPerWindow: 60, maximumBuckets: 64,
      requestWindowMs: 60_000, loginWindowMs: 60_000, maximumLoginPerAddress: 20, maximumLoginPerAccount: 10,
    };
    expect(() => createBusinessAdministrationHandler(
      pool,
      BusinessAdministrationProvisionSchema.parse({
        profile: "CAMACHO_BUSINESS_ADMINISTRATION_V1", origin, rp_id: "127.0.0.1", expected_database: "camacho_pos",
        rejection_verifier_file: "TEST_ONLY",
        migration_checksums: Object.fromEntries([
          "013_business_browser_sessions", "015_authorization_snapshot_sequences", "019_subscription_quotes",
          "020_subscription_payments", "022_license_activations", "023_license_offer_terms", "029_cash_register_master",
          "030_commercial_authorization_catalog", "031_business_owner_role", "032_tenant_initialization_permission",
          "033_cash_register_license_bindings",
        ].map(id => [id, "a".repeat(64)])),
        license_policy: {
          profile: "CAMACHO_LICENSE_ACTIVATION_V1", policy_reference: "TEST_ONLY", subscription_grace_days: 3,
          grace_basis: "ELAPSED_24_HOURS", perpetual_use: "NO_EXPIRY", support_and_external_services: "SEPARATE",
          accepted_contract_policy_references: ["TEST_ONLY"], offline_capabilities: ["CASH_REGISTER"],
        },
        renderer: { directory: "/tmp", maximum_asset_bytes: 1 },
        limits: {
          challenge_ms: 60_000, session_ms: 3_600_000, browser_ms: 3_600_000, mfa_age_ms: 300_000,
          reauthentication_ms: 300_000, idle_ms: 1_800_000, sql_lock_ms: 1_000, sql_statement_ms: 5_000,
          maximum_body_bytes: 8192, maximum_pending_flows: 16, requests_per_window: 120, maximum_buckets: 256,
          request_window_ms: 60_000, maximum_login_per_account: 20, login_window_ms: 60_000, maximum_login_per_address: 40,
        },
      }),
      "TEST_VERIFIER_NOT_USED",
      "secret-only",
      null,
    )).toThrow("BUSINESS_TURNSTILE_PAIR_REQUIRED");
    expect(() => createGlobalAdministrationHandler({
      pool,
      policy: {
        mode: "ISOLATED_VALIDATION", origin: "https://business.example.test", rpId: "business.example.test",
        policyReference: "TEST", rejectionVerifier: "rejection",
        challengeLifetimeMs: 60_000, sessionLifetimeMs: 3_600_000, maximumMfaAgeMs: 300_000,
        maximumReauthenticationAgeMs: 300_000, browserLifetimeMs: 3_600_000, idleTimeoutMs: 1_800_000,
        lockTimeoutMs: 1_000, statementTimeoutMs: 5_000,
      },
      limits,
      turnstileSecret: "secret-only",
    })).toThrow("GLOBAL_TURNSTILE_PAIR_REQUIRED");
  });
});
