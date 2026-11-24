import { createServer } from "node:http";
import { once } from "node:events";
import { expect, it, vi } from "vitest";
import { createTelemetryBundle } from "../src/index.js";
import { startOtlpSdk } from "../src/otlp-sdk.js";

it("exports actual OTLP protobuf traces and metrics to an HTTP receiver", async () => {
  const received = new Map<string, Buffer>();
  const receiver = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    received.set(request.url ?? "", Buffer.concat(chunks));
    response.writeHead(200, { "content-type": "application/x-protobuf" });
    response.end();
  });
  receiver.listen(0, "127.0.0.1");
  await once(receiver, "listening");
  const address = receiver.address();
  if (!address || typeof address === "string") throw new Error("expected TCP receiver");
  vi.stubEnv("OTEL_ENABLE_API", "1");
  vi.stubEnv("OTEL_TRACES_SAMPLER", "always_on");
  vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", `http://127.0.0.1:${address.port}`);
  try {
    const stop = startOtlpSdk("pos-otlp-test");
    const bundle = createTelemetryBundle({ sink: { write() {} } });
    bundle.metrics.counter("pos.test.counter");
    bundle.metrics.gauge("pos.test.gauge", 2);
    bundle.tracer.startSpan("pos.test.trace").end("OK");
    await stop?.();
    expect(received.get("/v1/traces")?.includes("pos.test.trace")).toBe(true);
    expect(received.get("/v1/metrics")?.includes("pos.test.counter")).toBe(true);
    expect(received.get("/v1/metrics")?.includes("pos.test.gauge")).toBe(true);
  } finally {
    vi.unstubAllEnvs();
    receiver.closeAllConnections();
    await new Promise<void>((resolve, reject) => receiver.close((error) => error ? reject(error) : resolve()));
  }
}, 15000);
