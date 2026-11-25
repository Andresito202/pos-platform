import { describe, expect, it } from "vitest";
import {
  LoggingSecurityAlerts,
  MemoryMetrics,
  MemorySecurityAlerts,
  MemoryTracer,
  StructuredLogger,
  createTelemetryBundle,
  resolveCorrelationId,
} from "../src/index.js";

describe("telemetry ports", () => {
  it("memory metrics and tracer record security-relevant signals", () => {
    const metrics = new MemoryMetrics();
    const tracer = new MemoryTracer();
    const alerts = new MemorySecurityAlerts();

    metrics.counter("pos.rate_limit.denied", 1, { route: "session-trust" });
    const span = tracer.startSpan("central.session_trust", { route: "session-trust" });
    span.setAttribute("http.status", 429);
    span.end("OK");

    alerts.emit({
      kind: "security.rate_limited",
      severity: "warn",
      correlationId: "corr-test-01",
      attributes: { route: "session-trust" },
    });

    expect(metrics.counters.get("pos.rate_limit.denied|route=session-trust")).toBe(1);
    expect(tracer.spans).toHaveLength(1);
    expect(alerts.signals[0]?.kind).toBe("security.rate_limited");
  });

  it("resolveCorrelationId rejects short inbound values", () => {
    expect(resolveCorrelationId("short")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(resolveCorrelationId("corr-id-long-enough")).toBe("corr-id-long-enough");
  });

  it("createTelemetryBundle defaults to noop OTel API until enabled", async () => {
    const records: unknown[] = [];
    const bundle = createTelemetryBundle({
      sink: { write: (r) => { records.push(r); } },
      enableOtelApi: false,
    });
    bundle.metrics.counter("x", 1);
    bundle.alerts.emit({ kind: "license.capacity_denied", severity: "warn" });
    await bundle.logger.flush();
    expect(records).toHaveLength(1);
  });

  it("LoggingSecurityAlerts redacts through StructuredLogger", async () => {
    const records: Array<{ event: string }> = [];
    const logger = new StructuredLogger({ write: (r) => { records.push(r); } });
    const alerts = new LoggingSecurityAlerts(logger, new MemoryMetrics());
    alerts.emit({
      kind: "fraud.price_tamper_rejected",
      severity: "critical",
      attributes: { sale_id: "s1" },
    });
    await logger.flush();
    expect(records[0]?.event).toBe("fraud_price_tamper_rejected");
  });
});
