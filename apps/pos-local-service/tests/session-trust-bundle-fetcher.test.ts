import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  SessionAssertionOperationalKeyClaimsSchema,
  SessionAssertionTrustBundleSchema,
  unsignedSessionAssertionOperationalKeyBytes,
} from "@pos-platform/contracts";
import { SessionTrustBundleFetcher } from "../src/security/session-trust-bundle-fetcher.js";

function validBundle(): unknown {
  const root = generateKeyPairSync("ed25519");
  const operational = generateKeyPairSync("ed25519");
  const claims = SessionAssertionOperationalKeyClaimsSchema.parse({
    key_id: "ssa-fetch-test",
    key_purpose: "SESSION_ASSERTION",
    environment: "production",
    public_key_pem: operational.publicKey.export({ type: "spki", format: "pem" }),
    status: "ACTIVE",
    valid_from: "2026-01-01T00:00:00.000Z",
    valid_until: null,
    version: 1,
  });
  return SessionAssertionTrustBundleSchema.parse({
    version: 1,
    keys: [{ claims, signature: sign(null, unsignedSessionAssertionOperationalKeyBytes(claims), root.privateKey).toString("base64url") }],
  });
}

const endpoint = "https://authority.example/v1/session-trust";
const token = "t".repeat(48);

describe("SessionTrustBundleFetcher", () => {
  it("requests the central endpoint over HTTPS without redirects or caching", async () => {
    const bundle = validBundle();
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(bundle), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    await expect(new SessionTrustBundleFetcher(request).fetch(endpoint, token)).resolves.toEqual(bundle);
    expect(request).toHaveBeenCalledOnce();
    const init = request.mock.calls[0]?.[1];
    expect(init?.method).toBe("GET");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${token}`);
    expect(init?.redirect).toBe("error");
    expect(init?.cache).toBe("no-store");
  });

  it("rejects a path other than the exact central trust endpoint", async () => {
    const request = vi.fn<typeof fetch>();
    await expect(new SessionTrustBundleFetcher(request).fetch("https://authority.example/other/v1/session-trust", token))
      .rejects.toThrow("SESSION_TRUST_ENDPOINT_PATH_INVALID");
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects malformed bearer tokens before making a request", async () => {
    const request = vi.fn<typeof fetch>();
    await expect(new SessionTrustBundleFetcher(request).fetch(endpoint, "short"))
      .rejects.toThrow("SESSION_TRUST_TRANSPORT_TOKEN_INVALID");
    await expect(new SessionTrustBundleFetcher(request).fetch(endpoint, `${token}\\n`))
      .rejects.toThrow("SESSION_TRUST_TRANSPORT_TOKEN_INVALID");
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects non-HTTPS endpoints before making a request", async () => {
    const request = vi.fn<typeof fetch>();
    await expect(new SessionTrustBundleFetcher(request).fetch("http://authority.example/v1/session-trust", token))
      .rejects.toThrow("SESSION_TRUST_ENDPOINT_MUST_BE_HTTPS");
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects non-success HTTP responses", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("denied", { status: 401 }));
    await expect(new SessionTrustBundleFetcher(request).fetch(endpoint, token)).rejects.toThrow("SESSION_TRUST_HTTP_401");
  });

  it("rejects oversized payloads and malformed JSON", async () => {
    const oversized = vi.fn<typeof fetch>().mockResolvedValue(new Response("x".repeat(65 * 1024), { status: 200 }));
    await expect(new SessionTrustBundleFetcher(oversized).fetch(endpoint, token)).rejects.toThrow("SESSION_TRUST_RESPONSE_TOO_LARGE");
    const malformed = vi.fn<typeof fetch>().mockResolvedValue(new Response("{", { status: 200 }));
    await expect(new SessionTrustBundleFetcher(malformed).fetch(endpoint, token)).rejects.toThrow("SESSION_TRUST_RESPONSE_INVALID_JSON");
  });
});
