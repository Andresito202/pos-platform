import type { IncomingMessage } from "node:http";
import type { GlobalSessionGate, VerifiedGlobalSession } from "../src/commercial-portal-bridge/global-session-gate.js";

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
