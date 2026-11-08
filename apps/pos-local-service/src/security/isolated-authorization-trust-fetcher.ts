import { request } from "node:https";
import { SignedAuthorizationTrustCandidateSchema } from "@pos-platform/contracts";
import type { AuthorizationTrustCandidateStore } from "./authorization-trust-candidate.js";

/** Closed loopback TLS transport for the unapproved DEC-011 candidate.
 * Independently provisioned root/issuer/floor authenticate the response; TLS
 * and a response generation alone never create trust. No production route. */
export async function refreshIsolatedAuthorizationTrust(input: {
  mode: "ISOLATED_VALIDATION"; url: string; ca: string; timeoutMs: number;
  store: AuthorizationTrustCandidateStore;
  signal?:AbortSignal;
}): Promise<number> {
  const url = new URL(input.url);
  if (process.env.NODE_ENV !== "test" || input.mode !== "ISOLATED_VALIDATION" || url.protocol !== "https:" || !url.hostname.endsWith(".test") ||
    url.pathname !== "/v1/isolated/authorization-trust" || url.username || url.password || url.search || url.hash ||
    !input.ca || !Number.isSafeInteger(input.timeoutMs) || input.timeoutMs <= 0)
    throw Error("SAS_LAB_TRANSPORT_REQUIRED");
  const payload = await new Promise<Buffer>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: url.port || 443, servername: url.hostname,
      path: url.pathname, method: "GET", ca: input.ca, rejectUnauthorized: true, minVersion: "TLSv1.2", agent: false,
      ...(input.signal?{signal:input.signal}:{}),
      headers: { accept: "application/json", host: url.hostname } }, res => {
      res.once("error", reject); res.once("aborted", () => reject(Error("SAS_TRUST_RESPONSE_ABORTED")));
      if (res.statusCode !== 200 || res.headers["cache-control"] !== "no-store" || res.headers["content-type"] !== "application/json; charset=utf-8" ||
        res.headers["content-encoding"] || res.headers.location) {
        res.destroy(); reject(Error("SAS_TRUST_HTTP_REJECTED")); return;
      }
      const chunks: Buffer[] = []; let bytes = 0;
      res.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) { res.destroy(Error("SAS_TRUST_RESPONSE_TOO_LARGE")); return; }
        chunks.push(chunk);
      });
      res.once("end", () => resolve(Buffer.concat(chunks)));
    });
    // Absolute deadline also covers slow headers/body, not only socket idle.
    const deadline = setTimeout(() => req.destroy(Error("SAS_TRUST_TIMEOUT")), input.timeoutMs);
    req.once("close", () => clearTimeout(deadline)); req.once("error", reject); req.end();
  });
  input.signal?.throwIfAborted();
  return input.store.install(SignedAuthorizationTrustCandidateSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload))));
}
