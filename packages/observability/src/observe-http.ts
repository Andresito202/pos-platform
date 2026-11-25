import { context, propagation } from "@opentelemetry/api";
import type { IncomingMessage, ServerResponse } from "node:http";
import { performance } from "node:perf_hooks";
import { correlationFromHeaders } from "./correlation.js";
import type { SecuritySignalKind } from "./ports.js";
import type { TelemetryBundle } from "./otel-runtime.js";

export function observeHttp(
  telemetry: TelemetryBundle,
  request: IncomingMessage,
  response: ServerResponse,
  route: string,
  signalForStatus?: (status: number) => SecuritySignalKind | undefined,
): void {
  const start = performance.now();
  const traceparent = request.headers.traceparent;
  const parent = typeof traceparent === "string"
    ? propagation.extract(context.active(), { traceparent })
    : context.active();
  const span = context.with(parent, () => telemetry.tracer.startSpan(route, { route }));
  const correlationId = correlationFromHeaders(request.headers);
  const complete = (status: number) => {
    response.off("finish", finished);
    response.off("close", closed);
    const attributes = { route, status };
    span.setAttribute("http.response.status_code", status);
    span.end(status >= 500 || status === 0 ? "ERROR" : "OK");
    telemetry.metrics.counter("pos.http.requests", 1, attributes);
    telemetry.metrics.histogram("pos.http.duration_ms", performance.now() - start, attributes);
    const kind = signalForStatus?.(status);
    if (kind) telemetry.alerts.emit({ kind, severity: "warn", attributes, correlationId });
  };
  const finished = () => complete(response.statusCode);
  const closed = () => complete(0);
  response.once("finish", finished);
  response.once("close", closed);
}
