import { randomUUID } from "node:crypto";
import type { LocalOperator } from "./local-operator-password.js";
import { LocalOperatorPasswordGate } from "./local-operator-password-gate.js";

export type LocalOperatorLoginResult =
  | { readonly status: "AUTHENTICATED"; readonly username: string; readonly role: LocalOperator["role"]; readonly expiresAt: string }
  | { readonly status: "DENIED" | "RATE_LIMITED" };

type ActiveOperator = {
  readonly sessionId: string;
  readonly username: LocalOperator["username"];
  readonly role: LocalOperator["role"];
  readonly expiresAtMs: number;
};

/**
 * Connection-scoped local operator identity, independent from commercial
 * BUSINESS authority. A password verifies a local user, not a signed SSA or
 * SAS. This registry NEVER writes CommercialComponent.bindings.
 *
 * On restart the registry is intentionally empty and a password is required
 * again. Durable state belongs to SQLite business data and the login budget,
 * NOT to an automatically resurrected privileged UI identity.
 */
export class LocalOperatorSessionRegistry {
  private readonly sessions = new Map<string, ActiveOperator>();
  private readonly validForMs = 8 * 60 * 60 * 1000;
  private readonly pending = new Set<string>();
  private readonly epochs = new Map<string, number>();
  private nextEpoch = 0;

  constructor(
    private readonly gate: Pick<LocalOperatorPasswordGate, "authenticate">,
    private readonly now: () => number = Date.now,
  ) {}

  async login(
    connectionId: string,
    username: string,
    password: string,
  ): Promise<LocalOperatorLoginResult> {
    if (!connectionId || this.pending.has(connectionId)) return { status: "DENIED" };
    const epoch = ++this.nextEpoch;
    this.epochs.set(connectionId, epoch);
    this.pending.add(connectionId);
    // Never preserve a previous user if a reauthentication fails.
    this.sessions.delete(connectionId);
    try {
      const result = await this.gate.authenticate(username, password);
      if (this.epochs.get(connectionId) !== epoch) return { status: "DENIED" };
      if (result.status !== "AUTHENTICATED") return { status: result.status };
      const expiresAtMs = this.now() + this.validForMs;
      const active: ActiveOperator = {
        sessionId: randomUUID(),
        username: result.operator.username,
        role: result.operator.role,
        expiresAtMs,
      };
      this.sessions.set(connectionId, active);
      return {
        status: "AUTHENTICATED",
        username: active.username,
        role: active.role,
        expiresAt: new Date(expiresAtMs).toISOString(),
      };
    } finally {
      if (this.epochs.get(connectionId) === epoch) {
        this.pending.delete(connectionId);
        this.epochs.delete(connectionId);
      }
    }
  }

  resolve(connectionId: string): Readonly<{ sessionId: string; username: LocalOperator["username"]; role: LocalOperator["role"]; expiresAt: string }> | null {
    // During a pending reauthentication there is never an active identity.
    if (this.pending.has(connectionId)) return null;
    const active = this.sessions.get(connectionId);
    if (!active) return null;
    if (this.now() >= active.expiresAtMs) {
      this.sessions.delete(connectionId);
      return null;
    }
    return {
      sessionId: active.sessionId,
      username: active.username,
      role: active.role,
      expiresAt: new Date(active.expiresAtMs).toISOString(),
    };
  }

  logout(connectionId: string): void {
    // Revocation must not race an async scrypt in login(). A release during
    // pending login cancels its post-verification commit as well.
    this.sessions.delete(connectionId);
    this.epochs.delete(connectionId);
    this.pending.delete(connectionId);
  }

  release(connectionId: string): void {
    this.logout(connectionId);
  }

  clear(): void {
    this.sessions.clear();
    this.pending.clear();
    this.epochs.clear();
  }
}
