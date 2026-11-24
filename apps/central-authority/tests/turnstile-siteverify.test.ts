import { describe, expect, it, vi } from "vitest";
import { verifyTurnstileToken } from "../src/turnstile-siteverify.js";

describe("verifyTurnstileToken", () => {
  it("rejects empty or oversized tokens without calling Cloudflare", async () => {
    const fetchImpl = vi.fn();
    expect(await verifyTurnstileToken({ secret: "x".repeat(20), token: "", fetchImpl })).toBe(false);
    expect(await verifyTurnstileToken({ secret: "short", token: "tok", fetchImpl })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns true only when siteverify reports success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    expect(await verifyTurnstileToken({
      secret: "0x".padEnd(20, "A"),
      token: "turnstile-response",
      remoteip: "203.0.113.10",
      fetchImpl,
    })).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    expect(String(init.body)).toContain("secret=");
    expect(String(init.body)).toContain("response=turnstile-response");
    expect(String(init.body)).toContain("remoteip=203.0.113.10");
  });

  it("fail-closes on network or non-success payloads", async () => {
    expect(await verifyTurnstileToken({
      secret: "0x".padEnd(20, "A"),
      token: "tok",
      fetchImpl: vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: false }) }),
    })).toBe(false);
    expect(await verifyTurnstileToken({
      secret: "0x".padEnd(20, "A"),
      token: "tok",
      fetchImpl: vi.fn().mockRejectedValue(new Error("network")),
    })).toBe(false);
  });
});
