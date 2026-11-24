/**
 * Application ports for observability (security-model § Puertos).
 * Domain must not import exporters; adapters live in this package.
 */

export type MetricAttributes = Readonly<Record<string, string | number | boolean>>;

export interface MetricsPort {
  /** Monotonic counter (e.g. rate_limit.denied). */
  counter(name: string, value?: number, attributes?: MetricAttributes): void;
  /** Histogram observation in the unit declared by the metric name (ms, bytes, …). */
  histogram(name: string, value: number, attributes?: MetricAttributes): void;
  /** Last-value gauge. */
  gauge(name: string, value: number, attributes?: MetricAttributes): void;
}

export interface SpanHandle {
  readonly traceId: string;
  readonly spanId: string;
  setAttribute(key: string, value: string | number | boolean): void;
  recordException(error: unknown): void;
  end(status?: "OK" | "ERROR"): void;
}

export interface TracerPort {
  startSpan(name: string, attributes?: MetricAttributes, parent?: SpanHandle): SpanHandle;
}

/** Security / fraud / license / payment / sync signals — never decide business state. */
export type SecuritySignalKind =
  | "security.authz_denied"
  | "security.rate_limited"
  | "security.integrity_failed"
  | "fraud.price_tamper_rejected"
  | "fraud.privilege_abuse"
  | "license.wipe_recovery"
  | "license.activation_rejected"
  | "license.capacity_denied"
  | "payment.operation_rejected"
  | "payment.webhook_rejected"
  | "payment.duplicate_rejected"
  | "sync.dispatch_failed"
  | "sync.conflict"
  | "sync.burst_backlog"
  | "backup.failed"
  | "backup.stale";

export interface SecuritySignal {
  readonly kind: SecuritySignalKind;
  readonly severity: "info" | "warn" | "critical";
  readonly correlationId?: string;
  readonly attributes?: MetricAttributes;
}

export interface SecurityAlertPort {
  emit(signal: SecuritySignal): void;
}

export class NoopMetrics implements MetricsPort {
  counter(): void {}
  histogram(): void {}
  gauge(): void {}
}

export class NoopTracer implements TracerPort {
  startSpan(name: string): SpanHandle {
    void name;
    return {
      traceId: "0".repeat(32),
      spanId: "0".repeat(16),
      setAttribute() {},
      recordException() {},
      end() {},
    };
  }
}

export class NoopSecurityAlerts implements SecurityAlertPort {
  emit(): void {}
}
