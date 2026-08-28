import { describe, expect, it } from "vitest";
import { StructuredLogger, redactFields, type LogRecord } from "../src/index.js";

describe("StructuredLogger", () => {
  it("redacts nested secrets without mutating input", () => {
    const input = { actor: "a", nested: { accessToken: "secret", value: 2 } };
    expect(redactFields(input)).toEqual({ actor: "a", nested: { accessToken: "[REDACTED]", value: 2 } });
    expect(input.nested.accessToken).toBe("secret");
  });
  it("emits stable structured records", () => {
    const records: LogRecord[] = [];
    new StructuredLogger({ write: (record) => records.push(record) }, () => new Date("2026-08-28T00:00:00Z"))
      .log("info", "runtime.started", { password: "x" });
    expect(records).toEqual([{ timestamp: "2026-08-28T00:00:00.000Z", level: "info", event: "runtime.started", fields: { password: "[REDACTED]" } }]);
  });
});
