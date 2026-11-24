import type { IncomingMessage } from "node:http";
import type { Pool } from "@pos-platform/database-postgres";
import type { GlobalAdministrationSessions } from "../global-administration-sessions.js";

export type VerifiedGlobalSession = {
  userId: string;
  sessionId: string;
};

/**
 * Bridge identity gate: bridge key authenticates the service hop only.
 * GLOBAL MFA browser session (or an explicit test double) grants subject identity.
 */
export interface GlobalSessionGate {
  verifyForMint(request: IncomingMessage): Promise<VerifiedGlobalSession | null>;
  isSessionActive(sessionId: string): Promise<boolean>;
}

/** Production gate — requires live GLOBAL cookie + CSRF against Central origin. */
export class GlobalAdministrationSessionGate implements GlobalSessionGate {
  constructor(
    private readonly sessions: GlobalAdministrationSessions,
    private readonly pool: Pool,
    private readonly origin: string,
  ) {}

  async verifyForMint(request: IncomingMessage): Promise<VerifiedGlobalSession | null> {
    const cookie = typeof request.headers.cookie === "string" ? request.headers.cookie : null;
    const csrf = typeof request.headers["x-csrf-token"] === "string" ? request.headers["x-csrf-token"] : null;
    const sessionId = await this.sessions.authorize(
      {
        method: "POST",
        origin: this.origin,
        fetchSite: "same-origin",
        cookie,
        csrfToken: csrf,
      },
      "LICENSE_ISSUE",
    );
    if (!sessionId) return null;
    const found = await this.pool.query<{ user_id: string }>(
      `SELECT user_id::text AS user_id FROM identity.sessions
        WHERE id = $1::uuid AND revoked_at IS NULL AND expires_at > clock_timestamp()
          AND tenant_id IS NULL AND tenant_membership_id IS NULL`,
      [sessionId],
    );
    const userId = found.rows[0]?.user_id;
    if (!userId) return null;
    return { sessionId, userId };
  }

  async isSessionActive(sessionId: string): Promise<boolean> {
    const found = await this.pool.query(
      `SELECT 1 FROM identity.sessions
        WHERE id = $1::uuid AND revoked_at IS NULL AND expires_at > clock_timestamp()
          AND tenant_id IS NULL AND tenant_membership_id IS NULL`,
      [sessionId],
    );
    return found.rowCount === 1;
  }
}

/**
 * Explicit test/lab gate. Never mounts in NODE_ENV=production.
 * Headers: x-test-global-session-id, x-test-global-user-id (UUIDs).
 */
export class ExplicitTestGlobalSessionGate implements GlobalSessionGate {
  private readonly active = new Set<string>();

  constructor() {
    if (process.env.NODE_ENV === "production") {
      throw new Error("TEST_GLOBAL_SESSION_GATE_FORBIDDEN_IN_PRODUCTION");
    }
  }

  async verifyForMint(request: IncomingMessage): Promise<VerifiedGlobalSession | null> {
    const sessionId = header(request, "x-test-global-session-id");
    const userId = header(request, "x-test-global-user-id");
    if (!sessionId || !userId) return null;
    if (!/^[0-9a-f-]{36}$/i.test(sessionId) || !/^[0-9a-f-]{36}$/i.test(userId)) return null;
    this.active.add(sessionId);
    return { sessionId, userId };
  }

  async isSessionActive(sessionId: string): Promise<boolean> {
    return this.active.has(sessionId);
  }

  revoke(sessionId: string): void {
    this.active.delete(sessionId);
  }
}

function header(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name];
  return Array.isArray(raw) ? raw[0] : raw;
}
