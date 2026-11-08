import type { LocalDatabase } from "@pos-platform/database-sqlite";
import { verifyLocalOperatorPassword, type LocalOperator } from "./local-operator-password.js";

/**
 * Durable, server-owned password attempt budget. No commercial session is
 * issued here. Future IPC integration must call authenticate(), not the
 * underlying verifier, and must never expose the store file to the renderer.
 *
 * Attempts are charged BEFORE scrypt runs. This prevents concurrent attempts
 * from bypassing the limit. The budget survives process restarts in SQLite.
 */
export class LocalOperatorPasswordGate {
  private readonly windowMs = 15 * 60 * 1000;
  private readonly maxPerPrincipal = 5;
  private readonly maxGlobal = 40;

  constructor(
    private readonly database: LocalDatabase,
    private readonly accountStorePath: string,
    private readonly now: () => number = Date.now,
  ) {
    database.native.exec(`
      CREATE TABLE IF NOT EXISTS local_operator_password_budget (
        principal TEXT NOT NULL PRIMARY KEY,
        window_started_ms INTEGER NOT NULL,
        attempts INTEGER NOT NULL CHECK(attempts >= 0)
      ) STRICT
    `);
  }

  async authenticate(username: string, password: string): Promise<
    { readonly status: "AUTHENTICATED"; readonly operator: LocalOperator } |
    { readonly status: "DENIED" | "RATE_LIMITED" }
  > {
    const principal = /^(admin|supervisor|cajero|superadmin)\.local$/.test(username)
      ? username : "(unknown)";
    const now = this.now();
    const charge = this.database.native.transaction(() => {
      for (const [key, limit] of [[principal, this.maxPerPrincipal], ["(global)", this.maxGlobal]] as const) {
        const row = this.database.native.prepare(
          "SELECT window_started_ms, attempts FROM local_operator_password_budget WHERE principal=?",
        ).get(key) as { window_started_ms: number; attempts: number } | undefined;
        const active = row && now >= row.window_started_ms && now - row.window_started_ms < this.windowMs;
        if (active && row.attempts >= limit) return false;
      }
      for (const key of [principal, "(global)"]) {
        const row = this.database.native.prepare(
          "SELECT window_started_ms, attempts FROM local_operator_password_budget WHERE principal=?",
        ).get(key) as { window_started_ms: number; attempts: number } | undefined;
        const active = row && now >= row.window_started_ms && now - row.window_started_ms < this.windowMs;
        this.database.native.prepare(
          "INSERT INTO local_operator_password_budget(principal,window_started_ms,attempts) VALUES(?,?,?) " +
          "ON CONFLICT(principal) DO UPDATE SET window_started_ms=excluded.window_started_ms,attempts=excluded.attempts",
        ).run(key, active ? row.window_started_ms : now, active ? row.attempts + 1 : 1);
      }
      return true;
    });
    if (!charge()) return { status: "RATE_LIMITED" };

    const operator = await verifyLocalOperatorPassword(this.accountStorePath, username, password);
    if (!operator) return { status: "DENIED" };

    // A successful login only clears the principal budget. Keep the global
    // budget to limit aggregate scrypt cost and credential stuffing.
    this.database.native.prepare(
      "DELETE FROM local_operator_password_budget WHERE principal=?",
    ).run(principal);
    return { status: "AUTHENTICATED", operator };
  }
}
