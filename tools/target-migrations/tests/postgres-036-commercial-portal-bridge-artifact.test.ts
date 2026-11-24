import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("036 commercial portal bridge artifact", () => {
  it("defines durable bridge sessions, jtis, trials and provisioning receipts", () => {
    const up = readFileSync(
      join(process.cwd(), "sql/postgres/036_commercial_portal_bridge.up.sql"),
      "utf8",
    );
    expect(up).toContain("identity.commercial_bridge_sessions");
    expect(up).toContain("identity.commercial_bridge_jtis");
    expect(up).toContain("licensing.commercial_trial_grants");
    expect(up).toContain("licensing.commercial_provisioning_receipts");
    expect(up).toContain("expires_at = starts_at + INTERVAL '120 hours'");
    expect(up).toContain("FORCE ROW LEVEL SECURITY");
    const digest = createHash("sha256").update(up).digest("hex");
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
  });
});
