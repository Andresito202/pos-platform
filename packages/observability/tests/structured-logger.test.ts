import { describe, expect, it } from "vitest";
import { StructuredLogger, redactFields, type LogRecord } from "../src/index.js";

describe("StructuredLogger", () => {
  it("redacts nested secrets without mutating input", () => {
    const input = { actor: "a", nested: { accessToken: "secret", value: 2 } };
    expect(redactFields(input)).toEqual({ actor: "a", nested: { accessToken: "[REDACTED]", value: 2 } });
    expect(input.nested.accessToken).toBe("secret");
  });

  it("redacts configured secret values even under innocent keys and inside errors", async () => {
    const records: LogRecord[] = [];
    const logger = new StructuredLogger(
      { write: (record) => { records.push(record); } },
      () => new Date("2026-08-28T00:00:00Z"),
      { sensitiveValues: ["super-secret-value"] },
    );
    logger.log("error", "runtime.failed", {
      detail: "failure: super-secret-value",
      error: new Error("Bearer abc.def and super-secret-value"),
    });
    await logger.flush();
    expect(JSON.stringify(records)).not.toContain("super-secret-value");
    expect(JSON.stringify(records)).not.toContain("abc.def");
  });

  it("emits stable structured records", async () => {
    const records: LogRecord[] = [];
    const logger = new StructuredLogger(
      { write: (record) => { records.push(record); } },
      () => new Date("2026-08-28T00:00:00Z"),
    );
    logger.log("info", "runtime.started", { password: "x" });
    await logger.flush();
    expect(records).toEqual([{
      timestamp: "2026-08-28T00:00:00.000Z",
      level: "info",
      event: "runtime.started",
      fields: { password: "[REDACTED]" },
    }]);
  });

  it("bounds pending async writes and surfaces sink failure", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const logger = new StructuredLogger({ write: async () => gate }, undefined, { maxPendingRecords: 1 });
    logger.log("info", "runtime.first");
    expect(() => logger.log("info", "runtime.second")).toThrow("capacity exceeded");
    release();
    await logger.flush();

    const failed = new StructuredLogger({ write: async () => { throw new Error("sink unavailable"); } });
    failed.log("error", "runtime.failed");
    await expect(failed.flush()).rejects.toThrow("log sink failed");
    expect(() => failed.log("info", "runtime.after_failure")).toThrow("log sink is failed");
  });
});
