import { Buffer } from "node:buffer";
import { SessionAssertionTrustBundleSchema, type SessionAssertionTrustBundle } from "@pos-platform/contracts";

const MAX_BUNDLE_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 5_000;

/** Fetches a public, root-signed trust bundle from Central Authority. */
export class SessionTrustBundleFetcher {
  constructor(private readonly request: typeof fetch = fetch) {}

  async fetch(endpoint: string, bearerToken: string): Promise<SessionAssertionTrustBundle> {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.hash !== "") {
      throw new Error("SESSION_TRUST_ENDPOINT_MUST_BE_HTTPS");
    }
    if (url.pathname !== "/v1/session-trust" || url.search !== "") {
      throw new Error("SESSION_TRUST_ENDPOINT_PATH_INVALID");
    }
    if (bearerToken.length < 32 || bearerToken.length > 4096 || /[\r\n]/.test(bearerToken)) {
      throw new Error("SESSION_TRUST_TRANSPORT_TOKEN_INVALID");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    timeout.unref?.();
    try {
      const response = await this.request(url, {
        method: "GET",
        headers: {
          authorization: `Bearer ${bearerToken}`,
          accept: "application/json",
          "cache-control": "no-store",
        },
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
      if (response.status !== 200) throw new Error(`SESSION_TRUST_HTTP_${response.status}`);
      const declaredLength = response.headers.get("content-length");
      if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_BUNDLE_BYTES)) {
        throw new Error("SESSION_TRUST_RESPONSE_TOO_LARGE");
      }
      if (response.body === null) throw new Error("SESSION_TRUST_RESPONSE_EMPTY");
      const reader = response.body.getReader();
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          totalBytes += value.byteLength;
          if (totalBytes > MAX_BUNDLE_BYTES) {
            await reader.cancel();
            throw new Error("SESSION_TRUST_RESPONSE_TOO_LARGE");
          }
          chunks.push(Buffer.from(value));
        }
      } finally {
        reader.releaseLock();
      }
      let artifact: unknown;
      try { artifact = JSON.parse(Buffer.concat(chunks, totalBytes).toString("utf8")); }
      catch { throw new Error("SESSION_TRUST_RESPONSE_INVALID_JSON"); }
      return SessionAssertionTrustBundleSchema.parse(artifact);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error("SESSION_TRUST_REQUEST_TIMEOUT");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
