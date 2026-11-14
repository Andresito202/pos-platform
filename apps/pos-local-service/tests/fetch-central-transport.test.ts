import { afterEach, describe, expect, it, vi } from "vitest";
import { CentralTransportError } from "../src/sync/central-transport.js";
import { FetchCentralTransport } from "../src/sync/fetch-central-transport.js";

afterEach(() => vi.unstubAllGlobals());

const request = () => ({
  method: "POST" as const,
  url: "https://central.invalid/v1/sync/batches",
  headers: { "content-type": "application/json" },
  body: "{}",
  signal: new AbortController().signal,
});

describe("FetchCentralTransport ambiguous delivery", () => {
  it("marks network errors as possibly sent, because response loss is indistinguishable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(new FetchCentralTransport().send(request())).rejects.toMatchObject({
      name: "CentralTransportError",
      code: "CONNECTION_FAILURE",
      sent: true,
    } satisfies Partial<CentralTransportError>);
  });

  it("marks aborted fetch as possibly sent", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abort));
    await expect(new FetchCentralTransport().send(request())).rejects.toMatchObject({
      code: "READ_TIMEOUT",
      sent: true,
    } satisfies Partial<CentralTransportError>);
  });

  it("returns valid HTTP responses without changing payload", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"ok":true}', {
      status: 200,
      headers: { "content-type": "application/json" },
    })));
    const result = await new FetchCentralTransport().send(request());
    expect(result.status).toBe(200);
    expect(result.body).toBe('{"ok":true}');
    expect(result.headers["content-type"]).toContain("application/json");
  });
});
