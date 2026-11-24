import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";

export function startOtlpSdk(serviceName: string): (() => Promise<void>) | undefined {
  if (process.env.OTEL_ENABLE_API !== "1") return undefined;
  const endpoint = new URL(process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "");
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname);
  if ((endpoint.protocol !== "https:" && !(loopback && endpoint.protocol === "http:")) ||
      endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error("OTEL_EXPORTER_OTLP_ENDPOINT_INVALID");
  }
  const base = endpoint.href.replace(/\/+$/, "");
  const sdk = new NodeSDK({
    serviceName,
    autoDetectResources: false,
    traceExporter: new OTLPTraceExporter({ url: `${base}/v1/traces`, timeoutMillis: 5000 }),
    metricReaders: [new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: `${base}/v1/metrics`, timeoutMillis: 5000 }),
      exportIntervalMillis: 10000,
      exportTimeoutMillis: 5000,
    })],
    logRecordProcessors: [],
  });
  sdk.start();
  return () => sdk.shutdown();
}
