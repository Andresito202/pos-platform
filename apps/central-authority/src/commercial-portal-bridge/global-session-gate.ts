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
