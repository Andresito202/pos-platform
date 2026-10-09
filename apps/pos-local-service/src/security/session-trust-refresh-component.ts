import type { TrustedSigningKey } from "./license-verifier.js";
import type { RuntimeComponent } from "../lifecycle.js";
import type { SessionTrustKeyResolution } from "./session-trust-key-resolver.js";

export type SessionTrustRefreshReport = (
  event: "UPDATED" | "FAILED",
  detail: Readonly<Record<string, unknown>>,
) => void;

/** Refreshes central session trust without restarting the POS runtime. */
export class SessionTrustRefreshComponent implements RuntimeComponent {
  readonly name = "session-trust-refresh";
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<void> | undefined;
  private stopped = false;

  constructor(
    private readonly fetchBundle: () => Promise<unknown>,
    private readonly resolveArtifact: (artifact: unknown) => SessionTrustKeyResolution,
    private readonly activeKeys: Map<string, TrustedSigningKey>,
    private readonly report: SessionTrustRefreshReport,
    private readonly intervalMs = 60_000,
  ) {
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 1_000) {
      throw new RangeError("session trust refresh interval must be an integer >= 1000ms");
    }
  }

  async start(): Promise<void> {
    this.stopped = false;
    const timer = setInterval(() => { void this.refreshNow(); }, this.intervalMs);
    timer.unref?.();
    this.timer = timer;
  }

  async refreshNow(): Promise<void> {
    if (this.stopped) return;
    if (this.inFlight !== undefined) {
      await this.inFlight;
      return;
    }
    const operation = this.refresh();
    this.inFlight = operation;
    try {
      await operation;
    } finally {
      if (this.inFlight === operation) this.inFlight = undefined;
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    await this.inFlight;
    this.inFlight = undefined;
  }

  private async refresh(): Promise<void> {
    try {
      const artifact = await this.fetchBundle();
      if (this.stopped) return;
      const resolution = this.resolveArtifact(artifact);
      this.activeKeys.clear();
      for (const [keyId, key] of resolution.keys) this.activeKeys.set(keyId, key);
      this.report("UPDATED", {
        decision: resolution.decision,
        key_count: this.activeKeys.size,
        ...(resolution.reason === undefined ? {} : { reason: resolution.reason }),
      });
    } catch (error) {
      this.report("FAILED", {
        reason: error instanceof Error ? error.message : "unknown session trust refresh failure",
        fallback: "retain_last_verified_trust",
      });
    }
  }
}
