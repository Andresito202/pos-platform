import type { IncomingMessage, ServerResponse } from "node:http";
import { UuidSchema } from "@pos-platform/contracts";
import { SCM_CHECKPOINT_PATH, type PostgresScmCheckpointRepository, type PostgresScmDeviceProofVerifier } from "@pos-platform/database-postgres";
import { parseDeviceRequestAuthorization } from "@pos-platform/device-trust";
import { FixedWindowRateLimiter } from "./fixed-window-rate-limiter.js";

/** Exact SCM checkpoint path only. Query/hash/aliases never authenticate. */
export function isScmCheckpointUrl(url: string | undefined): boolean {
  if (typeof url !== "string" || url.length === 0 || url.length > 2048) return false;
  try {
    const parsed = new URL(url, "https://scm.invalid");
    return parsed.pathname === SCM_CHECKPOINT_PATH && parsed.search === "" && parsed.hash === "";
  } catch {
    return false;
  }
}

export function createScmCheckpointHandler(
  proofs: Pick<PostgresScmDeviceProofVerifier, "verifyCheckpointAndConsume">,
  repository: Pick<PostgresScmCheckpointRepository, "latest">,
) {
  const limiter = new FixedWindowRateLimiter(600);
  const deviceLimiter = new FixedWindowRateLimiter(30);
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify(body));
    };
    if (!isScmCheckpointUrl(request.url) || request.method !== "POST") { send(404, { code: "NOT_FOUND" }); return; }
    if (!limiter.allow(request.socket.remoteAddress ?? "unknown")) { send(429, { code: "SCM_RATE_LIMITED" }); return; }
    const requestId = UuidSchema.safeParse(request.headers["x-request-id"]);
    const correlationId = UuidSchema.safeParse(request.headers["x-correlation-id"]);
    if (!requestId.success || !correlationId.success || !request.headers.authorization ||
        request.headers["content-type"]?.split(";")[0]?.trim() !== "application/json") { send(401, { code: "SCM_UNAUTHORIZED" }); return; }
    // Credential identity is taken from the DeviceProof header shape before any
    // nonce consumption. Cryptographic binding still happens below.
    const parsed = parseDeviceRequestAuthorization(request.headers.authorization);
    if (!parsed) { send(401, { code: "SCM_UNAUTHORIZED" }); return; }
    if (!deviceLimiter.allow(parsed.credentialId)) { send(429, { code: "SCM_RATE_LIMITED" }); return; }
    try {
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of request) {
        const bytes = Buffer.from(chunk); size += bytes.length;
        if (size > 1024) { send(413, { code: "SCM_BODY_TOO_LARGE" }); return; }
        chunks.push(bytes);
      }
      const body = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
      if (body !== "{}") { send(400, { code: "SCM_BODY_REJECTED" }); return; }
      const binding = await proofs.verifyCheckpointAndConsume({ authorization: request.headers.authorization, requestId: requestId.data, correlationId: correlationId.data, body });
      if (!binding) { send(401, { code: "SCM_UNAUTHORIZED" }); return; }
      // Scope comes only from the persisted credential, never URL/body IDs.
      const signed = await repository.latest(binding.installationId, binding.deviceId);
      if (!signed) { send(404, { code: "SCM_NOT_PROVISIONED" }); return; }
      send(200, signed);
    } catch { send(503, { code: "SCM_UNAVAILABLE" }); }
  };
}
