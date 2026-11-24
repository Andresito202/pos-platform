import { beforeEach, describe, expect, it, vi } from "vitest";
import { BusinessClient } from "../../renderer/src/business-client.js";
import { PlatformClient } from "../../renderer/src/platform-client.js";

vi.mock("../../renderer/src/turnstile-token.js", () => ({
  acquireTurnstileToken: vi.fn(async () => "turnstile-token-from-widget"),
}));

beforeEach(() => {
  Object.defineProperty(navigator, "credentials", {
    configurable: true,
    value: { get: vi.fn(async () => null) },
  });
});

describe("browser login Turnstile wiring", () => {
  it("PlatformClient sends turnstileToken when public-config returns a site key", async () => {
    const calls: Array<{ path: string; body?: unknown }> = [];
    const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/login/public-config")) {
        calls.push({ path: "public-config" });
        return new Response(JSON.stringify({ turnstileSiteKey: "0x4AAAAAAATESTKEY" }), { status: 200 });
      }
      if (url.endsWith("/login/begin")) {
        calls.push({ path: "begin", body: JSON.parse(String(init?.body)) });
        return new Response(JSON.stringify({
          challenge: "Y2hhbGxlbmdl", credentialId: "Y3JlZA", csrfToken: "a".repeat(43),
        }), { status: 200 });
      }
      throw Error(`unexpected ${url}`);
    }) as unknown as typeof fetch;
    const client = new PlatformClient({ protocol: "https:", origin: "https://central.example.test" }, transport);
    await expect(client.login("a@b.test", "secret", new AbortController().signal)).rejects.toThrow();
    expect(calls).toEqual([
      { path: "public-config" },
      { path: "begin", body: { email: "a@b.test", password: "secret", turnstileToken: "turnstile-token-from-widget" } },
    ]);
  });

  it("BusinessClient omits turnstileToken when public-config returns null", async () => {
    const bodies: unknown[] = [];
    const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/login/public-config")) {
        return new Response(JSON.stringify({ turnstileSiteKey: null }), { status: 200 });
      }
      if (url.endsWith("/login/begin")) {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({
          challenge: "Y2hhbGxlbmdl", credentialId: "Y3JlZA", csrfToken: "a".repeat(43),
        }), { status: 200 });
      }
      throw Error(`unexpected ${url}`);
    }) as unknown as typeof fetch;
    const client = new BusinessClient("https://central.example.test", transport);
    await expect(client.login(
      "a@b.test", "secret",
      "11111111-1111-7111-8111-111111111111",
      "22222222-2222-7222-8222-222222222222",
      new AbortController().signal,
    )).rejects.toThrow();
    expect(bodies).toEqual([{ email: "a@b.test", password: "secret" }]);
  });
});
