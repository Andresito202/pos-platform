import { createHash } from "node:crypto";
import { createServer, request, type Server } from "node:https";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BusinessAdministrationProvisionSchema, uuidV7, type BusinessAdministrationProvision } from "@pos-platform/contracts";
import type { Pool } from "@pos-platform/database-postgres";
import { BusinessInitialMfaFlow } from "../src/business-initial-mfa-flow.js";
import { createBusinessAdministrationHandler } from "../src/business-administration-http.js";
import { createCentralRouter } from "../src/central-router.js";
import { businessTestTls } from "./helpers/business-test-tls.js";

const tls = businessTestTls();
const ids = { user: uuidV7(), tenant: uuidV7(), member: uuidV7(), company: uuidV7(), branch: uuidV7(), license: uuidV7() };
const scope = { companyId: ids.company, branchId: ids.branch, licenseId: ids.license };
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
let server: Server | undefined, port = 0, origin = "";
let policy: BusinessAdministrationProvision;
let revoked = false, allowed = true, used = 0, version = 1, auditFails = false;
let cookieHash = "", csrfHash = "", sessionId = uuidV7();
let existingMaster: Record<string,unknown> | null = null;
let creationEvidence: Record<string,unknown>[] = [];
let competingLicense = false;
const calls: { sql: string; params: unknown[] }[] = [];
const registerId = uuidV7();
const baseRow = () => ({ id: registerId, tenant_id: ids.tenant, company_id: ids.company, branch_id: ids.branch,
  code: "C1", code_normalized: "c1", name: "Caja principal", currency_code: "COP", status: "ACTIVE", version,
  created_at: new Date(), retired_at: null });
const result = (rows: unknown[]) => ({ rows, rowCount: rows.length });

/** PostgreSQL boundary double: records statements and returns controlled rows.
 * Does NOT evaluate SQL, grants, RLS, locks or PostgreSQL concurrency. */
async function query(sql: string, params: unknown[] = []) {
  calls.push({ sql, params });
  if (sql.includes('SELECT DISTINCT co.id AS "companyId"')) return result(allowed ? [{...scope,companyName:"Empresa",branchName:"Centro",licenseName:"Comercial",currency:"COP"}] : []);
  if (sql.includes("FROM identity.browser_sessions") && sql.includes("SELECT tenant_id::text")) return result(!revoked && params[0] === cookieHash ? [{ tenant_id: ids.tenant, csrf_hash: csrfHash }] : []);
  if (sql.includes("AS seconds")) return result([{ seconds: 290 }]);
  if (sql.includes("FROM identity.browser_sessions b")) return result(!revoked ? [{ session_id: sessionId, user_id: ids.user, tenant_id: ids.tenant, membership_id: ids.member, csrf_hash: csrfHash }] : []);
  if (sql.includes("FROM identity.users u")) return result([{ user_id: ids.user }]);
  if (sql.includes("INSERT INTO identity.sessions")) { sessionId = String(params[0]); return result([{ id: sessionId }]); }
  if (sql.includes("INSERT INTO identity.browser_sessions")) { cookieHash = String(params[0]); csrfHash = String(params[1]); return result([]); }
  if (sql.includes("INSERT INTO identity.security_events")) return result([{ user_id: params[1], session_id: params[2], tenant_id: params[3], event_code: params[4], result: params[5],
    reason_code: params[6], correlation_id: params[7], occurred_at: new Date(String(params[8])), server_recorded_at: new Date() }]);
  if (sql.includes("FROM organization.companies")) return result(params[0] === ids.company && params[1] === ids.tenant ? [{ id: ids.company, currency_code: "COP" }] : []);
  if (sql.includes("FROM identity.sessions s")) {
    if (sql.includes("CASH_REGISTER_MANAGE")) return result(allowed && params[1] === ids.company && params[2] === ids.branch ? [{}] : []);
    return result([{ tenant_id: ids.tenant, user_id: ids.user }]);
  }
  if (sql.includes("competing_license_id")) return result(competingLicense ? [{ competing_license_id:uuidV7() }] : []);
  if (sql.includes("FROM licensing.licenses l")) return result(params[0] === ids.license && params[1] === ids.tenant && params[2] === ids.company ?
    [{ included_registers: 1, additional_registers: 1, policy_version: "TEST_ONLY", terms_snapshot: { policy_reference: "TEST_ONLY" } }] : []);
  if (sql.includes("FROM licensing.license_entitlements")) return result([{}]);
  if (sql.includes("count(*)")) return result([{ used: String(used) }]);
  if (sql.includes("FROM audit.audit_events")) return result(creationEvidence);
  if (sql.startsWith("INSERT INTO cash.cash_registers")) return result([{ ...baseRow(), id: params[3], code: params[4], code_normalized: params[5], name: params[6] }]);
  if (sql.startsWith("UPDATE cash.cash_registers")) {
    if (params[4] !== version || params[0] !== ids.tenant || params[1] !== ids.company || params[2] !== ids.branch) return result([]);
    return result([{ ...baseRow(), version: version+1, ...(sql.includes("RETIRED") ? { status: "RETIRED", retired_at: new Date() } : { code: params[5], code_normalized: params[6], name: params[7] }) }]);
  }
  if (sql.includes("SELECT * FROM cash.cash_registers")) return result(sql.includes("AND id=$4") ? existingMaster ? [existingMaster] : [] : [baseRow()]);
  if (sql.includes("INSERT INTO audit.audit_events") && auditFails) throw Error("AUDIT_UNAVAILABLE");
  if (sql.includes("UPDATE identity.sessions SET revoked_at")) revoked = true;
  return result([]);
}
const pool = { connect: async () => ({ query, release: vi.fn() }) } as unknown as Pool;
async function post(path: string, body: unknown = {}, headers: Record<string,string> = {}) {
  const data = JSON.stringify(body);
  return new Promise<{ status: number; body: Record<string, any>; cookies: string[] }>((resolve,reject) => {
    const req = request({ hostname: "127.0.0.1", port, path, method: "POST", ca: tls.cert,
      headers: { origin, "sec-fetch-site": "same-origin", "content-type": "application/json", "content-length": Buffer.byteLength(data), ...headers } }, res => {
      let payload = ""; res.on("data", b => payload += b); res.on("end", () => resolve({ status: res.statusCode!, body: JSON.parse(payload), cookies: res.headers["set-cookie"] ?? [] }));
    }); req.on("error", reject); req.end(data);
  });
}
let mfaAccepted = true;
async function login() {
  const begin = await post("/v1/business/login/begin", { email: "owner@example.test", password: "test-only" });
  expect(begin.status).toBe(200);
  const response = { id: "credential", rawId: "credential", type: "public-key", clientExtensionResults: {}, response: { clientDataJSON: "test", authenticatorData: "test", signature: "test" } };
  const completed = await post("/v1/business/login/complete", { email: "owner@example.test", password: "test-only", challenge: "challenge",
    response, tenantId: ids.tenant, membershipId: ids.member }, { cookie: begin.cookies[0]!.split(";")[0]!, "x-csrf-token": begin.body.csrfToken });
  return { completed, headers: { cookie: completed.cookies.find(c => c.startsWith("__Host-camacho_business="))?.split(";")[0] ?? "", "x-csrf-token": String(completed.body.csrfToken) } };
}
beforeEach(async () => {
  calls.length = 0; revoked = false; allowed = true; used = 0; version = 1; auditFails = false; mfaAccepted = true; cookieHash = ""; csrfHash = "";
  existingMaster = null; creationEvidence = []; competingLicense = false;
  // Explicit MFA verification boundary double. Issuer, browser authority,
  // permissions guard, cash use case, router and HTTPS transport are real.
  vi.spyOn(BusinessInitialMfaFlow.prototype, "begin").mockResolvedValue({ challengeId: uuidV7(), challenge: "challenge", credentialId: "credential", userVerification: "required" });
  vi.spyOn(BusinessInitialMfaFlow.prototype, "complete").mockImplementation(async () => mfaAccepted ? { kind: "BUSINESS_INITIAL_MFA_RECEIPT" } : null);
  vi.spyOn(BusinessInitialMfaFlow.prototype, "takeForBusinessSession").mockImplementation(() => ({ purpose: "BUSINESS_INITIAL_MFA", sessionId: null, userId: ids.user,
    passwordCredentialId: uuidV7(), passwordCredentialVersion: "1", factorId: uuidV7(), challengeId: uuidV7(), correlationId: uuidV7(), verifiedAt: new Date().toISOString() }));
  server = createServer(tls);
  await new Promise<void>(resolve => server!.listen(0,"127.0.0.1",resolve));
  const address = server.address(); if (!address || typeof address === "string") throw Error("TEST_LISTENER_MISSING");
  port = address.port; origin = `https://127.0.0.1:${port}`;
  policy = BusinessAdministrationProvisionSchema.parse({ profile: "CAMACHO_BUSINESS_ADMINISTRATION_V1", origin, rp_id: "127.0.0.1", expected_database: "camacho_pos",
    rejection_verifier_file: "TEST_ONLY", migration_checksums: Object.fromEntries(["013_business_browser_sessions","015_authorization_snapshot_sequences","019_subscription_quotes","020_subscription_payments","022_license_activations","023_license_offer_terms","029_cash_register_master","030_commercial_authorization_catalog","031_business_owner_role"].map(id => [id,"a".repeat(64)])),
    license_policy: { profile: "CAMACHO_LICENSE_ACTIVATION_V1", policy_reference: "TEST_ONLY", subscription_grace_days: 3, grace_basis: "ELAPSED_24_HOURS", perpetual_use: "NO_EXPIRY", support_and_external_services: "SEPARATE", accepted_contract_policy_references: ["TEST_ONLY"], offline_capabilities: ["CASH_REGISTER"] },
    renderer: { directory: "TEST_ONLY", maximum_asset_bytes: 10000 }, limits: { challenge_ms: 60000, session_ms: 300000, browser_ms: 300000, mfa_age_ms: 60000, reauthentication_ms: 300000, idle_ms: 300000,
      sql_lock_ms: 2000, sql_statement_ms: 10000, maximum_body_bytes: 16384, maximum_pending_flows: 10, requests_per_window: 100, maximum_buckets: 100, request_window_ms: 60000, maximum_login_per_account: 20 } });
  server.on("request", createCentralRouter(async (_req,res) => { res.writeHead(404); res.end('{"code":"FALLBACK"}'); }, createBusinessAdministrationHandler(pool,policy,"TEST_VERIFIER_NOT_USED")));
});
afterEach(async () => { vi.restoreAllMocks(); if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); } });

describe("Central production router over HTTPS (MFA and PostgreSQL boundary doubles)", () => {
  it("connects MFA -> real issuer -> BUSINESS cookie -> authority -> protected list", async () => {
    const { completed, headers } = await login(); expect(completed.status).toBe(200); expect(completed.body.scope).toBe("BUSINESS");
    const cookie = completed.cookies.find(c => c.startsWith("__Host-camacho_business="))!;
    expect(cookie).toContain("; Secure; HttpOnly; SameSite=Strict;"); expect(cookie).not.toContain("platform");
    const listed = await post("/v1/business/cash-registers/list",{ ...scope, after: null },headers);
    expect(listed.status).toBe(200); expect(listed.body.registers[0].id).toBe(registerId);
    expect(calls.some(c => c.sql.includes("INSERT INTO identity.sessions"))).toBe(true);
    expect(calls.some(c => c.sql.includes("CASH_REGISTER_MANAGE"))).toBe(true);
  });
  it("rejects MFA without issuing a session", async () => {
    mfaAccepted = false; expect((await login()).completed.status).toBe(401);
    expect(calls.some(c => c.sql.includes("INSERT INTO identity.sessions"))).toBe(false);
  });
  it("rejects missing, GLOBAL and revoked sessions before cash SQL", async () => {
    for (const cookie of ["", "__Host-camacho_platform="+"a".repeat(43)]) expect((await post("/v1/business/session",{}, { cookie })).status).toBe(401);
    const { headers } = await login(); revoked = true;
    expect((await post("/v1/business/cash-registers/list",{ ...scope,after:null },headers)).status).toBe(401);
    expect(calls.some(c => c.sql.includes("FROM cash.cash_registers"))).toBe(false);
  });
  it("rejects origin and CSRF violations before a protected effect", async () => {
    const { headers } = await login();
    expect((await post("/v1/business/session",{}, { ...headers,origin:"https://other.example.test" })).status).toBe(403);
    expect((await post("/v1/business/session",{}, { ...headers,"x-csrf-token":"b".repeat(43) })).status).toBe(401);
  });
  it("rejects a role lacking CASH_REGISTER_MANAGE and rolls back", async () => {
    allowed = false;
    const { headers, completed } = await login(); expect(completed.status).toBe(200);
    expect((await post("/v1/business/session",{},headers)).status).toBe(200);
    expect((await post("/v1/business/cash-registers/list",{ ...scope,after:null },headers)).status).toBe(403);
    expect(calls.at(-1)?.sql).toBe("ROLLBACK");
  });
  it("rejects another company or branch and a license outside the company", async () => {
    const { headers } = await login();
    for (const replacement of [{companyId:uuidV7()},{branchId:uuidV7()},{licenseId:uuidV7()}]) {
      expect((await post("/v1/business/cash-registers/list",{ ...scope,...replacement,after:null },headers)).status).toBe(403);
    }
  });
  it("creates under company and license locks and audits before commit", async () => {
    const { headers } = await login(); calls.length=0;
    const created = await post("/v1/business/cash-registers/create",{ ...scope,id:registerId,code:"C1",name:"Principal",currency:"COP",correlationId:uuidV7() },headers);
    expect(created.status).toBe(200);
    const sql = calls.map(c => c.sql);
    expect(sql.findIndex(s => s.includes("pg_advisory_xact_lock"))).toBeLessThan(sql.findIndex(s => s.includes("FROM organization.companies")));
    expect(sql.findIndex(s => s.includes("FROM organization.companies") && s.includes("FOR UPDATE"))).toBeLessThan(sql.findIndex(s => s.includes("count(*)")));
    expect(sql.findIndex(s => s.includes("pg_advisory_xact_lock"))).toBeLessThan(sql.findIndex(s => s.includes("count(*)")));
    expect(sql.findIndex(s => s.includes("INSERT INTO audit.audit_events"))).toBeLessThan(sql.lastIndexOf("COMMIT"));
  });
  it("refuses exhausted active/historical capacity without deleting allocation history", async () => {
    const { headers } = await login(); used=2;
    expect((await post("/v1/business/cash-registers/create",{ ...scope,id:registerId,code:"C1",name:"Principal",currency:"COP",correlationId:uuidV7() },headers)).status).toBe(409);
    expect(calls.some(c => c.sql.startsWith("INSERT INTO cash.cash_registers"))).toBe(false);
  });
  it("replays creation from immutable audit evidence after later edit and retirement", async () => {
    const { headers } = await login();
    const r = { ...scope,id:registerId,code:"C1",name:"Caja principal",currency:"COP",correlationId:uuidV7() };
    const original = { ...baseRow(),created_at:new Date().toISOString() };
    existingMaster = { ...baseRow(),code:"EDITED",name:"Retirada",version:9,status:"RETIRED",retired_at:new Date() };
    creationEvidence = [{ new_value:{register:original,licenseId:ids.license},correlation_id:r.correlationId }];
    calls.length=0;
    const replay = await post("/v1/business/cash-registers/create",r,headers);
    expect(replay.status).toBe(200); expect(replay.body.register.version).toBe(1); expect(replay.body.register.code).toBe("C1");
    expect(calls.some(c => c.sql.includes("INSERT INTO cash.cash_registers") || c.sql.includes("INSERT INTO audit.audit_events"))).toBe(false);
  });
  it("rejects a changed creation intent and an identity with no original audit evidence", async () => {
    const { headers } = await login();
    const r = { ...scope,id:registerId,code:"C1",name:"Caja principal",currency:"COP",correlationId:uuidV7() };
    existingMaster = baseRow();
    creationEvidence = [{ new_value:{register:{...baseRow(),created_at:new Date().toISOString()},licenseId:ids.license},correlation_id:r.correlationId }];
    expect((await post("/v1/business/cash-registers/create",{...r,name:"Otros datos"},headers)).status).toBe(409);
    expect((await post("/v1/business/cash-registers/create",{...r,correlationId:uuidV7()},headers)).status).toBe(409);
    creationEvidence=[];
    expect((await post("/v1/business/cash-registers/create",r,headers)).status).toBe(409);
  });
  it("fails closed if the capacity count is missing or malformed", async () => {
    const { headers } = await login(); used=Number.NaN;
    expect((await post("/v1/business/cash-registers/create",{ ...scope,id:registerId,code:"C1",name:"Principal",currency:"COP",correlationId:uuidV7() },headers)).status).toBe(403);
  });
  it("blocks ambiguous multi-license creation while keeping independent list/edit/retire available", async () => {
    const { headers } = await login(); competingLicense=true;
    const created = await post("/v1/business/cash-registers/create",{ ...scope,id:registerId,code:"C1",name:"Principal",currency:"COP",correlationId:uuidV7() },headers);
    expect(created.status).toBe(409); expect(created.body.code).toBe("CASH_REGISTER_LICENSE_BINDING_REQUIRED");
    expect((await post("/v1/business/cash-registers/list",{...scope,after:null},headers)).status).toBe(200);
    expect((await post("/v1/business/cash-registers/edit",{...scope,id:registerId,expectedVersion:1,code:"C1",name:"Editada",correlationId:uuidV7()},headers)).status).toBe(200);
    expect((await post("/v1/business/cash-registers/retire",{...scope,id:registerId,expectedVersion:1,correlationId:uuidV7()},headers)).status).toBe(200);
  });
  it("rejects stale versions without auditing or committing a mutation", async () => {
    const { headers } = await login(); calls.length=0;
    expect((await post("/v1/business/cash-registers/edit",{ ...scope,id:registerId,expectedVersion:2,code:"C1",name:"Editada",correlationId:uuidV7() },headers)).status).toBe(409);
    expect(calls.some(c => c.sql.includes("INSERT INTO audit.audit_events"))).toBe(false); expect(calls.at(-1)?.sql).toBe("ROLLBACK");
  });
  it("retires with a version increment, audit and no DELETE", async () => {
    const { headers } = await login();
    const retired=await post("/v1/business/cash-registers/retire",{ ...scope,id:registerId,expectedVersion:1,correlationId:uuidV7() },headers);
    expect(retired.status).toBe(200); expect(retired.body.register.status).toBe("RETIRED"); expect(retired.body.register.version).toBe(2);
    expect(calls.some(c => /DELETE FROM/i.test(c.sql))).toBe(false); expect(calls.some(c => c.sql.includes("INSERT INTO audit.audit_events"))).toBe(true);
  });
  it("rolls back when the audit boundary fails", async () => {
    const { headers } = await login(); auditFails=true;
    expect((await post("/v1/business/cash-registers/retire",{ ...scope,id:registerId,expectedVersion:1,correlationId:uuidV7() },headers)).status).toBe(500);
    expect(calls.at(-1)?.sql).toBe("ROLLBACK");
  });
  it("logs out by revoking stored custody and the session before clearing the cookie", async () => {
    const { headers } = await login(); const closed=await post("/v1/business/logout",{},headers);
    expect(closed.status).toBe(200); expect(closed.cookies[0]).toContain("Max-Age=0");
    expect((await post("/v1/business/session",{},headers)).status).toBe(401);
  });
  it("never sends BUSINESS routes to the GLOBAL/legacy fallback", async () => {
    expect((await post("/v1/business/unknown")).body.code).toBe("BUSINESS_NOT_FOUND");
    expect((await post("/v1/platform/session")).body.code).toBe("FALLBACK");
  });
  it("exposes authorized contexts and rejects client-declared session authority", async () => {
    const { headers } = await login();
    const contexts = await post("/v1/business/contexts",{},headers);
    expect(contexts.status).toBe(200); expect(contexts.body.contexts[0].companyId).toBe(ids.company);
    expect((await post("/v1/business/contexts",{role:"OWNER",tenantId:ids.tenant,sessionId},headers)).status).toBe(400);
    allowed=false;
    expect((await post("/v1/business/contexts",{},headers)).body.contexts).toEqual([]);
  });
  it("fails closed when BUSINESS is not provisioned and leaves legacy dispatch intact", async () => {
    server!.removeAllListeners("request");
    server!.on("request",createCentralRouter(async (_req,res) => {res.writeHead(200);res.end('{"scope":"GLOBAL_OR_LEGACY"}');}));
    const blocked=await post("/v1/business/session"); expect(blocked.status).toBe(503); expect(blocked.body.code).toBe("BUSINESS_NOT_PROVISIONED");
    expect((await post("/v1/platform/session")).body.scope).toBe("GLOBAL_OR_LEGACY");
  });
});
