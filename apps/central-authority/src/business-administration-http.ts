import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { TLSSocket } from "node:tls";
import { BUSINESS_API, BusinessLoginBeginSchema, BusinessLoginCompleteSchema, uuidV7,
  PlatformSecurityEventCode, BusinessContextsSchema, type BusinessAdministrationProvision } from "@pos-platform/contracts";
import { PostgresPlatformSecurityEventRepository, type Pool, type PoolClient } from "@pos-platform/database-postgres";
import { BusinessInitialMfaFlow } from "./business-initial-mfa-flow.js";
import { BusinessBrowserSessionIssuer } from "./business-browser-session-issuer.js";
import { BusinessBrowserSessionAuthority } from "./business-browser-session-authority.js";
import { BusinessCashRegisters, BusinessRejection } from "./business-cash-registers.js";
import { FixedWindowRateLimiter } from "./fixed-window-rate-limiter.js";
import { spendDurableLoginBudget } from "./login-abuse-budget.js";
import { verifyTurnstileToken } from "./turnstile-siteverify.js";
import { inspectCommercialHeaders, readCommercialJsonBody, sendCommercialJson, validateCommercialAssertion } from "./commercial-https-request-boundary.js";

const FLOW = "__Host-camacho_business_flow";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const csrfEqual = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
const flowCookie = (value: string, ms: number) => `${FLOW}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(ms / 1000)}`;
export function createBusinessAdministrationHandler(
  pool: Pool,
  policy: BusinessAdministrationProvision,
  rejectionVerifier: string,
  turnstileSecret: string | null = null,
) {
  const l = policy.limits;
  const mfa = new BusinessInitialMfaFlow(pool, { origin: policy.origin, rpId: policy.rp_id,
    challengeLifetimeMs: l.challenge_ms, rejectionVerifier, sessionScope: "BUSINESS" });
  const issuer = new BusinessBrowserSessionIssuer(pool, mfa, { origin: policy.origin, sessionLifetimeMs: l.session_ms,
    browserLifetimeMs: l.browser_ms, maximumMfaAgeMs: Math.min(l.mfa_age_ms, l.reauthentication_ms),
    lockTimeoutMs: l.sql_lock_ms, statementTimeoutMs: l.sql_statement_ms });
  const authority = new BusinessBrowserSessionAuthority(policy.origin, l.reauthentication_ms, l.idle_ms);
  const registers = new BusinessCashRegisters(policy.license_policy);
  const limiter = new FixedWindowRateLimiter(l.requests_per_window, l.maximum_buckets, l.request_window_ms);
  const pending = new Map<string, { email: string; challenge: string; csrf: string; expires: number }>();
  let starting = 0;
  async function transaction<T>(run: (c: PoolClient) => Promise<T>) {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('lock_timeout',$1,true),set_config('statement_timeout',$2,true),set_config('app.tenant_id','',true)",
        [`${l.sql_lock_ms}ms`, `${l.sql_statement_ms}ms`]);
      const value = await run(c); await c.query("COMMIT"); return value;
    } catch (e) { await c.query("ROLLBACK").catch(() => undefined); throw e; }
    finally { c.release(); }
  }
  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (!(req.socket instanceof TLSSocket) || !req.socket.encrypted || req.method !== "POST" ||
          req.headers.host !== new URL(policy.origin).host || req.headers.origin !== policy.origin || req.headers["sec-fetch-site"] !== "same-origin") {
        sendCommercialJson(res, 403, { code: "BUSINESS_ORIGIN_REJECTED" }); return;
      }
      inspectCommercialHeaders(req);
      if (!limiter.allow(req.socket.remoteAddress ?? "unknown")) { sendCommercialJson(res, 429, { code: "BUSINESS_RATE_LIMITED" }); return; }
      const path = req.url?.slice(BUSINESS_API.length);
      if (!["login/begin", "login/complete", "session", "logout", "contexts", "cash-registers/list", "cash-registers/create", "cash-registers/edit", "cash-registers/retire"].includes(path ?? "")) {
        sendCommercialJson(res, 404, { code: "BUSINESS_NOT_FOUND" }); return;
      }
      const { object: body } = await readCommercialJsonBody(req, l.maximum_body_bytes);
      const csrf = typeof req.headers["x-csrf-token"] === "string" ? req.headers["x-csrf-token"] : null;
      const cookie = req.headers.cookie ?? null;
      if (path === "login/begin" || path === "login/complete") {
        const parsed = path === "login/begin" ? BusinessLoginBeginSchema.safeParse(body) : BusinessLoginCompleteSchema.safeParse(body);
        if (!parsed.success) { sendCommercialJson(res, 400, { code: "BUSINESS_LOGIN_INVALID" }); return; }
        const b = parsed.data;
        if (!await spendDurableLoginBudget(pool, "BUSINESS", req.socket.remoteAddress ?? "unknown", b.email, {
          windowMs: l.login_window_ms,
          maximumPerAddress: l.maximum_login_per_address,
          maximumPerAccount: l.maximum_login_per_account,
        })) { sendCommercialJson(res, 429, { code: "BUSINESS_RATE_LIMITED" }); return; }
        for (const [key, value] of pending) if (value.expires <= Date.now()) pending.delete(key);
        if (path === "login/begin") {
          if (turnstileSecret !== null) {
            const token = "turnstileToken" in b && typeof b.turnstileToken === "string" ? b.turnstileToken : "";
            const remote = req.socket.remoteAddress;
            if (!await verifyTurnstileToken({
              secret: turnstileSecret,
              token,
              ...(remote ? { remoteip: remote } : {}),
            })) { sendCommercialJson(res, 401, { code: "BUSINESS_TURNSTILE_REJECTED" }); return; }
          }
          if (pending.size + starting >= l.maximum_pending_flows) { sendCommercialJson(res, 429, { code: "BUSINESS_RATE_LIMITED" }); return; }
          starting++;
          let challenge;
          try { challenge = await mfa.begin({ email: b.email, password: b.password, correlationId: uuidV7() }); }
          finally { starting--; }
          if (!challenge) { sendCommercialJson(res, 401, { code: "BUSINESS_MFA_REJECTED" }); return; }
          const token = randomBytes(32).toString("base64url"), csrfToken = randomBytes(32).toString("base64url");
          pending.set(hash(token), { email: b.email.trim().toLowerCase(), challenge: challenge.challenge, csrf: hash(csrfToken), expires: Date.now() + l.challenge_ms });
          sendCommercialJson(res, 200, { ...challenge, csrfToken }, flowCookie(token, l.challenge_ms)); return;
        }
        const b2 = BusinessLoginCompleteSchema.parse(body);
        const values = (cookie ?? "").split(";").map(s => s.trim()).filter(s => s.startsWith(FLOW + "="));
        const token = values.length === 1 ? values[0]!.slice(FLOW.length + 1) : "";
        const held = pending.get(hash(token)); pending.delete(hash(token));
        res.setHeader("set-cookie", flowCookie("", 0));
        if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !held || held.expires <= Date.now() || !csrf || !csrfEqual(hash(csrf), held.csrf) ||
            held.email !== b2.email.trim().toLowerCase() || held.challenge !== b2.challenge || !validateCommercialAssertion(b2.response)) {
          sendCommercialJson(res, 401, { code: "BUSINESS_MFA_REJECTED" }); return;
        }
        const receipt = await mfa.complete({ email: b2.email, password: b2.password, challenge: b2.challenge,
          response: b2.response as Parameters<BusinessInitialMfaFlow["complete"]>[0]["response"] });
        if (!receipt) { sendCommercialJson(res, 401, { code: "BUSINESS_MFA_REJECTED" }); return; }
        const issued = await issuer.issue(receipt, b2.tenantId, b2.membershipId, cookie);
        res.setHeader("set-cookie", [issued.setCookie, flowCookie("", 0)]);
        sendCommercialJson(res, 200, { authenticated: true, scope: "BUSINESS", csrfToken: issued.csrfToken }); return;
      }
      const result = await transaction(async c => {
        const browserRequest = { method: req.method!, origin: policy.origin, fetchSite: "same-origin", cookie, csrfToken: csrf };
        const session = await authority.require(c, browserRequest, path === "logout" ? "LOGOUT" : "OPERATION");
        if (!session) throw new BusinessRejection(401, "BUSINESS_SESSION_REQUIRED");
        if (path === "contexts") {
          if (Object.keys(body).length) throw new BusinessRejection(400, "BUSINESS_REQUEST_INVALID");
          const rows = (await c.query(`SELECT DISTINCT co.id AS "companyId",b.id AS "branchId",l.id AS "licenseId",
            co.trade_name AS "companyName",b.name AS "branchName",pl.name AS "licenseName",co.currency_code AS currency
            FROM "authorization".user_role_assignments a
            JOIN "authorization".roles r ON r.id=a.role_id AND r.scope_type='BUSINESS' AND r.status='ACTIVE' AND r.code IN ('OWNER','GENERAL_ADMIN')
            JOIN "authorization".role_permission_grants g ON g.role_id=r.id AND g.status='ACTIVE'
              AND g.valid_from<=clock_timestamp() AND (g.valid_until IS NULL OR g.valid_until>clock_timestamp())
            JOIN "authorization".permissions p ON p.id=g.permission_id AND p.code='CASH_REGISTER_MANAGE' AND p.status='ACTIVE'
            JOIN organization.companies co ON co.id=a.company_id AND co.tenant_id=a.tenant_id AND co.status='ACTIVE'
            JOIN organization.branches b ON b.company_id=co.id AND b.tenant_id=co.tenant_id AND b.status='ACTIVE' AND (a.branch_id IS NULL OR a.branch_id=b.id)
            JOIN subscriptions.license_quotes q ON q.company_id=co.id AND q.tenant_id=co.tenant_id
            JOIN licensing.licenses l ON l.tenant_id=q.tenant_id AND l.plan_id=q.plan_id AND l.contract_status IN ('ACTIVE','PAST_DUE')
            JOIN licensing.plans pl ON pl.id=l.plan_id
            JOIN payments.payment_groups pg ON pg.collection_subject_id=q.id AND pg.collection_subject_type='SUBSCRIPTION_QUOTE'
            JOIN payments.payments pay ON pay.payment_group_id=pg.id AND pay.status='CONFIRMED' AND l.commercial_reference='SUBSCRIPTION_PAYMENT:'||pay.id::text
            WHERE a.tenant_id=$1 AND a.tenant_membership_id=$2 AND a.status='ACTIVE'
              AND a.valid_from<=clock_timestamp() AND (a.valid_until IS NULL OR a.valid_until>clock_timestamp())
            ORDER BY co.id,b.id,l.id LIMIT 101`, [session.tenantId, session.membershipId])).rows;
          return BusinessContextsSchema.parse({ contexts: rows.slice(0,100), truncated: rows.length>100 });
        }
        if (path === "session" || path === "logout") {
          if (Object.keys(body).length) throw new BusinessRejection(400, "BUSINESS_REQUEST_INVALID");
          if (path === "session") return { authenticated: true, scope: "BUSINESS" };
          await c.query("UPDATE identity.browser_sessions SET revoked_at=clock_timestamp() WHERE session_id=$1 AND tenant_id=$2 AND revoked_at IS NULL", [session.sessionId, session.tenantId]);
          await c.query("UPDATE identity.sessions SET revoked_at=clock_timestamp(),revocation_reason='BUSINESS_LOGOUT',version=version+1 WHERE id=$1 AND tenant_id=$2 AND revoked_at IS NULL", [session.sessionId, session.tenantId]);
          await new PostgresPlatformSecurityEventRepository(pool).append({ user_id: session.userId, session_id: session.sessionId, tenant_id: session.tenantId,
            event_code: PlatformSecurityEventCode.SESSION_REVOKED, result: "REVOKED", reason_code: "BUSINESS_LOGOUT", correlation_id: uuidV7(), occurred_at: new Date().toISOString() }, c);
          return { closed: true };
        }
        const value = await registers.execute(c, session, path!.slice("cash-registers/".length), body);
        if ((await authority.require(c, browserRequest))?.sessionId !== session.sessionId) throw new BusinessRejection(401,"BUSINESS_SESSION_REQUIRED");
        return value;
      });
      // Do not clear custody before the server commits revocation.
      if (path === "logout") res.setHeader("set-cookie", "__Host-camacho_business=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0");
      sendCommercialJson(res, 200, result);
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      const status = e instanceof BusinessRejection ? e.status : code === "CASH_REGISTER_BUSINESS_PERMISSION_DENIED" ? 403 :
        code === "CASH_REGISTER_BUSINESS_SESSION_REQUIRED" ? 401 : code.startsWith("BUSINESS_SESSION_") || code === "BUSINESS_MFA_REQUIRED" ? 401 :
        (e as { code?: string })?.code === "23505" ? 409 : typeof (e as { status?: unknown })?.status === "number" ? Number((e as { status: number }).status) : 500;
      sendCommercialJson(res, status, { code: e instanceof BusinessRejection || ["CASH_REGISTER_BUSINESS_PERMISSION_DENIED", "CASH_REGISTER_BUSINESS_SESSION_REQUIRED"].includes(code) ? code : "BUSINESS_REQUEST_REJECTED" });
    }
  };
}
