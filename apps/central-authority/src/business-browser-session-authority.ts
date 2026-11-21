import { createHash, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "@pos-platform/database-postgres";

const COOKIE = "__Host-camacho_business";

const hash = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

function extractCookie(header: string | null): string | null {
  if (!header || header.length > 8192) return null;

  const matches = header
    .split(";")
    .map(value => value.trim())
    .filter(value => value.startsWith(`${COOKIE}=`));

  if (matches.length !== 1) return null;

  const token = matches[0]!.slice(COOKIE.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

function equalHash(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");

  return a.length === 32 &&
    b.length === 32 &&
    timingSafeEqual(a, b);
}

export type BusinessBrowserRequest = {
  method: string;
  origin: string | null;
  fetchSite: string | null;
  cookie: string | null;
  csrfToken: string | null;
};

export type AuthenticatedBusinessSession = {
  sessionId: string;
  userId: string;
  tenantId: string;
  membershipId: string;
};

export class BusinessBrowserSessionAuthority {
  constructor(
    private readonly origin: string,
    private readonly maximumReauthenticationAgeMs: number,
    private readonly idleTimeoutMs: number = maximumReauthenticationAgeMs,
  ) {
    if (
      new URL(origin).protocol !== "https:" ||
      new URL(origin).origin !== origin ||
      !Number.isSafeInteger(maximumReauthenticationAgeMs) ||
      maximumReauthenticationAgeMs <= 0 || !Number.isSafeInteger(idleTimeoutMs) || idleTimeoutMs <= 0
    ) {
      throw Error("BUSINESS_SESSION_POLICY_INVALID");
    }
  }

  async require(
    client: PoolClient,
    request: BusinessBrowserRequest,
    purpose: "OPERATION" | "LOGOUT" = "OPERATION",
  ): Promise<AuthenticatedBusinessSession | null> {
    if (
      request.method !== "POST" ||
      request.origin !== this.origin ||
      request.fetchSite !== "same-origin" ||
      !request.csrfToken ||
      !/^[A-Za-z0-9_-]{43}$/.test(request.csrfToken)
    ) {
      return null;
    }

    const cookie = extractCookie(request.cookie);
    if (!cookie) return null;

    // Browser custody is Identity-owned and readable before choosing a tenant.
    // Membership is tenant-isolated: joining it before setting trusted context
    // rejects valid sessions on a fresh pooled connection. Never derive this
    // context from a request tenant/session UUID or an unverified CSRF token.
    const custody = await client.query<{ tenant_id: string; csrf_hash: string }>(
      `SELECT tenant_id::text,csrf_hash
         FROM identity.browser_sessions
        WHERE cookie_hash=$1 AND origin=$2
          AND tenant_id IS NOT NULL AND membership_id IS NOT NULL
          AND revoked_at IS NULL AND expires_at>clock_timestamp()
          AND ($4::boolean OR last_used_at>=clock_timestamp()-$3::bigint*interval '1 millisecond')
        FOR UPDATE`,
      [hash(cookie), this.origin, this.idleTimeoutMs, purpose === "LOGOUT"],
    );
    const held = custody.rows[0];
    if (!held || !equalHash(hash(request.csrfToken), held.csrf_hash)) return null;
    await client.query("SELECT set_config('app.tenant_id',$1,true)", [held.tenant_id]);

    const result = await client.query<{
      session_id: string;
      user_id: string;
      tenant_id: string;
      membership_id: string;
      csrf_hash: string;
    }>(
      `SELECT b.session_id::text,
              b.user_id::text,
              b.tenant_id::text,
              b.membership_id::text,
              b.csrf_hash
         FROM identity.browser_sessions b
         JOIN identity.browser_session_handoffs h
           ON h.handoff_hash=b.handoff_hash
          AND h.session_id=b.session_id
          AND h.user_id=b.user_id
          AND h.tenant_id=b.tenant_id
          AND h.membership_id=b.membership_id
         JOIN identity.sessions s
           ON s.id=b.session_id
          AND s.user_id=b.user_id
          AND s.tenant_id=b.tenant_id
          AND s.tenant_membership_id=b.membership_id
         JOIN identity.users u
           ON u.id=s.user_id
          AND u.status='ACTIVE'
         JOIN tenancy.tenant_memberships m
           ON m.id=b.membership_id
          AND m.tenant_id=b.tenant_id
          AND m.user_id=b.user_id
          AND m.status='ACTIVE'
         JOIN tenancy.tenants t
           ON t.id=m.tenant_id AND t.status='ACTIVE'
         JOIN identity.user_credentials pwd
           ON pwd.id=h.password_credential_id
          AND pwd.user_id=b.user_id
          AND pwd.version=h.password_credential_version
          AND pwd.credential_type='PASSWORD'
          AND pwd.status='ACTIVE'
          AND pwd.revoked_at IS NULL
          AND (pwd.locked_until IS NULL OR pwd.locked_until<=clock_timestamp())
         JOIN identity.mfa_factors f
           ON f.id=h.factor_id
          AND f.user_id=b.user_id
          AND f.status='ACTIVE'
          AND f.verified_at IS NOT NULL
          AND f.revoked_at IS NULL
        WHERE b.cookie_hash=$1
          AND b.origin=$2
          AND h.origin=$2
          AND h.consumed_at IS NOT NULL
          AND h.expires_at>clock_timestamp()
          AND b.tenant_id IS NOT NULL
          AND b.membership_id IS NOT NULL
          AND b.revoked_at IS NULL
          AND b.expires_at>clock_timestamp()
          AND s.revoked_at IS NULL
          AND s.expires_at>clock_timestamp()
          AND s.mfa_status='SATISFIED'
          AND s.last_reauthenticated_at IS NOT NULL
          AND s.last_reauthenticated_at<=clock_timestamp()
          AND ($4::boolean OR s.last_reauthenticated_at>=
              clock_timestamp()-$3::bigint*interval '1 millisecond')
        FOR UPDATE OF b
        FOR SHARE OF s,u,m,pwd,f,h,t`,
      [
        hash(cookie),
        this.origin,
        this.maximumReauthenticationAgeMs,
        purpose === "LOGOUT",
      ],
    );

    const session = result.rows[0];

    if (!session || !equalHash(hash(request.csrfToken), session.csrf_hash)) {
      return null;
    }

    await client.query(
      `UPDATE identity.browser_sessions
          SET last_used_at=clock_timestamp()
        WHERE cookie_hash=$1
          AND revoked_at IS NULL`,
      [hash(cookie)],
    );

    return {
      sessionId: session.session_id,
      userId: session.user_id,
      tenantId: session.tenant_id,
      membershipId: session.membership_id,
    };
  }
}
