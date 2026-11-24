import { readFileSync, lstatSync } from "node:fs";
import { isAbsolute } from "node:path";
import { GlobalAdministrationProvisionSchema, isSupportedPlatformPasswordVerifier } from "@pos-platform/contracts";
import type { Pool } from "@pos-platform/database-postgres";
import { GlobalAdministrationSessions } from "../global-administration-sessions.js";
import {
  ExplicitTestGlobalSessionGate,
  GlobalAdministrationSessionGate,
  type GlobalSessionGate,
} from "./global-session-gate.js";

function managed(path: string, max: number): string {
  if (!isAbsolute(path)) throw new Error("GLOBAL_ADMIN_MANAGED_ABSOLUTE_FILE_REQUIRED");
  const s = lstatSync(path);
  if (!s.isFile() || s.isSymbolicLink() || s.size > max || (process.platform !== "win32" && (s.mode & 0o077) !== 0)) {
    throw new Error("GLOBAL_ADMIN_MANAGED_FILE_REJECTED");
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));
}

/**
 * Bridge mint gate:
 * - Lab: ExplicitTestGlobalSessionGate when CENTRAL_BRIDGE_TEST_GATE=1 and not production.
 * - Deployment: GlobalAdministrationSessionGate (cookie+CSRF+LICENSE_ISSUE MFA).
 * - Otherwise fail-closed (bridge key alone never grants GLOBAL).
 */
export function prepareCommercialBridgeGlobalGate(input: {
  pool: Pool;
  origin: string | null;
  provisionFile: string | null;
}): GlobalSessionGate {
  if (process.env.NODE_ENV !== "production" && process.env.CENTRAL_BRIDGE_TEST_GATE === "1") {
    return new ExplicitTestGlobalSessionGate();
  }
  if (!input.provisionFile || !input.origin) {
    return {
      async verifyForMint() {
        return null;
      },
      async isSessionActive(sessionId: string) {
        const found = await input.pool.query(
          `SELECT 1 FROM identity.sessions
            WHERE id=$1::uuid AND revoked_at IS NULL AND expires_at>clock_timestamp()
              AND tenant_id IS NULL AND tenant_membership_id IS NULL`,
          [sessionId],
        );
        return found.rowCount === 1;
      },
    };
  }
  const p = GlobalAdministrationProvisionSchema.parse(JSON.parse(managed(input.provisionFile, 32768)));
  const l = p.limits;
  const rejection = managed(p.rejection_verifier_file, 8192).trim();
  if (!isSupportedPlatformPasswordVerifier(rejection)) {
    throw new Error("GLOBAL_ADMIN_REJECTION_VERIFIER_REQUIRED");
  }
  const sessions = new GlobalAdministrationSessions(input.pool, {
    mode: "DEPLOYMENT",
    origin: input.origin,
    rpId: p.rp_id,
    policyReference: p.policy_reference,
    rejectionVerifier: rejection,
    challengeLifetimeMs: l.challenge_ms,
    sessionLifetimeMs: l.session_ms,
    maximumMfaAgeMs: l.mfa_age_ms,
    maximumReauthenticationAgeMs: l.reauthentication_ms,
    browserLifetimeMs: l.browser_ms,
    idleTimeoutMs: l.idle_ms,
    lockTimeoutMs: l.sql_lock_ms,
    statementTimeoutMs: l.sql_statement_ms,
  });
  return new GlobalAdministrationSessionGate(sessions, input.pool, input.origin);
}
