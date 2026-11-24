import { metrics, trace, context, SpanStatusCode, type Span } from "@opentelemetry/api";
import type {
  MetricAttributes,
  MetricsPort,
  SecurityAlertPort,
  SecuritySignal,
  SpanHandle,
  TracerPort,
} from "./ports.js";
import { NoopMetrics, NoopSecurityAlerts, NoopTracer } from "./ports.js";
import { StructuredLogger, type LogSink } from "./structured-logger.js";

function applyAttributes(span: Span, attributes?: MetricAttributes): void {
  if (!attributes) return;
  for (const [key, value] of Object.entries(attributes)) {
    span.setAttribute(key, value);
  }
}

/** Metrics via OpenTelemetry API meter (requires registered MeterProvider or no-ops). */
export class OpenTelemetryMetrics implements MetricsPort {
  constructor(private readonly meterName = "pos-platform") {}

  counter(name: string, value = 1, attributes?: MetricAttributes): void {
    metrics.getMeter(this.meterName).createCounter(name).add(value, attributes);
  }

  histogram(name: string, value: number, attributes?: MetricAttributes): void {
    metrics.getMeter(this.meterName).createHistogram(name).record(value, attributes);
  }

  gauge(name: string, value: number, attributes?: MetricAttributes): void {
    metrics.getMeter(this.meterName).createGauge(name).record(value, attributes);
  }
}

export class OpenTelemetryTracer implements TracerPort {
  constructor(private readonly tracerName = "pos-platform") {}

  startSpan(name: string, attributes?: MetricAttributes, parent?: SpanHandle): SpanHandle {
    const tracer = trace.getTracer(this.tracerName);
    const active = parent
      ? trace.setSpan(context.active(), trace.wrapSpanContext({
        traceId: parent.traceId,
        spanId: parent.spanId,
        traceFlags: 1,
        isRemote: false,
      }))
      : context.active();
    const span = tracer.startSpan(name, undefined, active);
    applyAttributes(span, attributes);
    const sc = span.spanContext();
    return {
      traceId: sc.traceId,
      spanId: sc.spanId,
      setAttribute(key, value) {
        span.setAttribute(key, value);
      },
      recordException(error) {
        if (error instanceof Error) span.recordException(error);
        else span.recordException(new Error(String(error)));
        span.setStatus({ code: SpanStatusCode.ERROR });
      },
      end(status) {
        if (status === "ERROR") span.setStatus({ code: SpanStatusCode.ERROR });
        else if (status === "OK") span.setStatus({ code: SpanStatusCode.OK });
        span.end();
      },
    };
  }
}

/**
 * Security signals → structured log + metric counter.
 * Alerts never mutate business state (security-model).
 */
export class LoggingSecurityAlerts implements SecurityAlertPort {
  constructor(
    private readonly logger: StructuredLogger,
    private readonly metricsPort: MetricsPort = new NoopMetrics(),
  ) {}

  emit(signal: SecuritySignal): void {
    this.logger.log(
      signal.severity === "critical" ? "error" : signal.severity === "warn" ? "warn" : "info",
      signal.kind.replace(/\./g, "_"),
      { severity: signal.severity, ...(signal.attributes ?? {}) },
      signal.correlationId,
    );
    this.metricsPort.counter("pos.security.signal", 1, {
      kind: signal.kind,
      severity: signal.severity,
    });
  }
}

export type TelemetryBundle = {
  readonly metrics: MetricsPort;
  readonly tracer: TracerPort;
  readonly alerts: SecurityAlertPort;
  readonly logger: StructuredLogger;
};

/**
 * Lab/default: structured logger + OTel API facades (no-op without SDK provider).
 * Set OTEL_EXPORTER_OTLP_ENDPOINT in the host process and register a NodeSDK
 * outside this package when a collector is authorized — this package does not
 * phone home or provision cloud exporters.
 */
export function createTelemetryBundle(options: {
  sink: LogSink;
  serviceName?: string;
  enableOtelApi?: boolean;
}): TelemetryBundle {
  const logger = new StructuredLogger(options.sink);
  const enable = options.enableOtelApi ?? process.env.OTEL_ENABLE_API === "1";
  if (!enable) {
    const metricsPort = new NoopMetrics();
    return {
      metrics: metricsPort,
      tracer: new NoopTracer(),
      alerts: new LoggingSecurityAlerts(logger, metricsPort),
      logger,
    };
  }
  const metricsPort = new OpenTelemetryMetrics(options.serviceName ?? "pos-platform");
  return {
    metrics: metricsPort,
    tracer: new OpenTelemetryTracer(options.serviceName ?? "pos-platform"),
    alerts: new LoggingSecurityAlerts(logger, metricsPort),
    logger,
  };
}
