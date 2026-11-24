import type {
  MetricAttributes,
  MetricsPort,
  SecurityAlertPort,
  SecuritySignal,
  SpanHandle,
  TracerPort,
} from "./ports.js";

type CounterKey = string;

function keyOf(name: string, attributes?: MetricAttributes): CounterKey {
  if (!attributes) return name;
  const parts = Object.keys(attributes)
    .sort()
    .map((k) => `${k}=${String(attributes[k])}`);
  return `${name}|${parts.join(",")}`;
}

/** In-process telemetry for tests and lab — not a production exporter. */
export class MemoryMetrics implements MetricsPort {
  readonly counters = new Map<string, number>();
  readonly histograms = new Map<string, number[]>();
  readonly gauges = new Map<string, number>();

  counter(name: string, value = 1, attributes?: MetricAttributes): void {
    const key = keyOf(name, attributes);
    this.counters.set(key, (this.counters.get(key) ?? 0) + value);
  }

  histogram(name: string, value: number, attributes?: MetricAttributes): void {
    const key = keyOf(name, attributes);
    const series = this.histograms.get(key) ?? [];
    series.push(value);
    this.histograms.set(key, series);
  }

  gauge(name: string, value: number, attributes?: MetricAttributes): void {
    this.gauges.set(keyOf(name, attributes), value);
  }
}

export class MemoryTracer implements TracerPort {
  readonly spans: Array<{ name: string; status: string; attributes: Record<string, unknown> }> = [];

  startSpan(name: string, attributes?: MetricAttributes): SpanHandle {
    const attrs: Record<string, unknown> = { ...(attributes ?? {}) };
    let status: "OK" | "ERROR" = "OK";
    const spans = this.spans;
    return {
      traceId: "m".repeat(32),
      spanId: Math.random().toString(16).slice(2, 18).padEnd(16, "0"),
      setAttribute(key, value) {
        attrs[key] = value;
      },
      recordException(error) {
        attrs.exception = error instanceof Error ? error.message : String(error);
        status = "ERROR";
      },
      end(endStatus) {
        if (endStatus) status = endStatus;
        spans.push({ name, status, attributes: { ...attrs } });
      },
    };
  }
}

export class MemorySecurityAlerts implements SecurityAlertPort {
  readonly signals: SecuritySignal[] = [];
  emit(signal: SecuritySignal): void {
    this.signals.push(signal);
  }
}
