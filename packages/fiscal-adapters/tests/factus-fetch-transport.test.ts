import { afterEach, describe, expect, it, vi } from "vitest";
import { FetchHttpTransport } from "../src/factus/fetch-transport.js";

const request = {
  method: "GET" as const,
  url: "https://provider.example.test/document",
  headers: {},
  body: undefined,
  signal: new AbortController().signal,
};

afterEach(() => vi.unstubAllGlobals());

describe("FetchHttpTransport response bounds", () => {
  it("preserves UTF-8 characters split across chunks at the byte limit", async () => {
    const bytes = new TextEncoder().encode("ñ");
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.slice(0, 1));
        controller.enqueue(bytes.slice(1));
        controller.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream)));
    expect(await new FetchHttpTransport().send({ ...request, maxResponseBytes: 2 })).toMatchObject({ body: "ñ" });
  });

  it("cancels an oversized response without consuming the remaining stream", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(3)); },
      cancel,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream)));
    await expect(new FetchHttpTransport().send({ ...request, maxResponseBytes: 2 }))
      .rejects.toMatchObject({ code: "RESPONSE_SIZE_REJECTED", sentToProvider: true });
    expect(cancel).toHaveBeenCalledOnce();
  });
});
