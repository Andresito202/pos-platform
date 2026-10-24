import { readFileSync } from "node:fs";
import { createServer } from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash, createPrivateKey, timingSafeEqual } from "node:crypto";
import { CentralDeviceCredentialIssuer, DeviceEnrollmentHttpHandler, type DeviceEnrollmentTransportContext } from "@pos-platform/device-trust";
import { createPostgresPool, PostgresDeviceRegistryRepository } from "@pos-platform/database-postgres";
import { SessionTrustPublication } from "./session-trust-publication.js";
import { FixedWindowRateLimiter } from "./fixed-window-rate-limiter.js";
import {resolveCentralDeploymentConfiguration,verifyCentralTlsIdentity,verifyEnrollmentIssuerKey,verifyCentralRuntimeDatabase,createCentralReadinessProbe} from "./central-deployment-configuration.js";
import {drainCentralServer} from "./central-server-shutdown.js";

const deployment=resolveCentralDeploymentConfiguration(process.env);
const PORT = deployment?.port??Number(process.env.CENTRAL_AUTHORITY_PORT ?? "8443");
const MAX_BODY_BYTES = deployment?.maxBodyBytes??Number(process.env.D3_ENROLLMENT_MAX_BODY_BYTES ?? String(16 * 1024));
const MAX_CREDENTIAL_LIFETIME_MS = deployment?.credentialLifetimeMs??Number(process.env.D3_CREDENTIAL_LIFETIME_MS ?? String(24 * 60 * 60 * 1000));
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function secretFromFile(name: string): string {
  const path = required(name);
  const value = readFileSync(path, "utf8").trim();
  if (!value) throw new Error(`${name} points to an empty secret`);
  return value;
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}


async function readBody(request: IncomingMessage, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > maxBytes) throw new Error("DEVICE_ENROLLMENT_BODY_TOO_LARGE");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function send(response: ServerResponse, statusCode: number, body: Record<string, unknown>, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(payload, "utf8")),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    "cross-origin-resource-policy": "same-origin",
    ...headers,
  });
  response.end(payload);
}

function protocolContext(request: IncomingMessage, requestId: string, correlationId: string, authorization: string | null): DeviceEnrollmentTransportContext {
  const rawLength = request.headers["content-length"];
  const parsedLength = rawLength === undefined ? null : Number(rawLength);
  return {
    authorization,
    contentType: request.headers["content-type"]?.split(";", 1)[0]?.trim() ?? null,
    contentLength: parsedLength !== null && Number.isSafeInteger(parsedLength) ? parsedLength : null,
    requestId,
    correlationId,
  };
}

const databaseUrl = required("CENTRAL_DATABASE_URL");
const transportToken = deployment?secretFromFile("D3_ENROLLMENT_TRANSPORT_TOKEN_FILE"):required("D3_ENROLLMENT_TRANSPORT_TOKEN");
const issuerPrivateKey = createPrivateKey(secretFromFile("D3_ISSUER_PRIVATE_KEY_FILE"));
const tlsKey = readFileSync(required("CENTRAL_TLS_KEY_FILE"));
const tlsCert = readFileSync(required("CENTRAL_TLS_CERT_FILE"));
if(deployment){verifyCentralTlsIdentity(deployment,tlsCert,createPrivateKey(tlsKey));verifyEnrollmentIssuerKey(issuerPrivateKey);
  if(transportToken.length<32||transportToken.length>4096||/[\r\n]/.test(transportToken))throw Error("CENTRAL_MANAGED_TOKEN_REJECTED");}
const sessionTrustPublication = process.env.SESSION_TRUST_ARTIFACT_FILE === undefined
  ? null
  : new SessionTrustPublication(process.env.SESSION_TRUST_ARTIFACT_FILE);
const sessionTrustTransportToken = process.env.SESSION_TRUST_TRANSPORT_TOKEN_FILE === undefined
  ? null
  : secretFromFile("SESSION_TRUST_TRANSPORT_TOKEN_FILE");
const pool = createPostgresPool(databaseUrl, 10, "pos-platform-central-authority");
if(deployment){try{await verifyCentralRuntimeDatabase(pool);}catch{await pool.end();throw Error("CENTRAL_RUNTIME_DATABASE_REJECTED");}}
const readiness=deployment?createCentralReadinessProbe(pool,deployment.requestTimeoutMs):null;
const repository = new PostgresDeviceRegistryRepository({ pool });
const issuer = new CentralDeviceCredentialIssuer(repository, issuerPrivateKey, { now: () => new Date() });
const handler = new DeviceEnrollmentHttpHandler(issuer, {
  maxBodyBytes: MAX_BODY_BYTES,
  maxCredentialLifetimeMs: MAX_CREDENTIAL_LIFETIME_MS,
  authorize: (context) => {
    const value = context.authorization;
    return typeof value === "string" && value.startsWith("Bearer ") && constantTimeEqual(value.slice(7), transportToken);
  },
  now: () => new Date(),
});
const limiter = new FixedWindowRateLimiter();

const server = createServer({ key: tlsKey, cert: tlsCert, minVersion: "TLSv1.2" }, async (request, response) => {
  if(deployment&&request.headers.host!==new URL(deployment.origin).host){send(response,421,{status:"REJECTED",result_code:"CENTRAL_HOST_REJECTED"});return;}
  const requestId = request.headers["x-request-id"]?.toString() ?? createHash("sha256").update(`${Date.now()}:${Math.random()}`).digest("hex").slice(0, 32);
  const correlationId = request.headers["x-correlation-id"]?.toString() ?? requestId;
  const remote = request.socket.remoteAddress ?? "unknown";

  if (request.method === "GET" && request.url === "/health") {
    send(response, 200, { status: "OK", service: "central-authority", protocol_version: "1.0.0" });
    return;
  }
  if(request.method==="GET"&&request.url==="/ready"){
    if(readiness&&await readiness())send(response,200,{status:"READY",service:"central-authority",commercial_auth:"NOT_ACTIVATED"});
    else send(response,503,{status:"NOT_READY",service:"central-authority"});return;
  }

  if (request.method === "GET" && request.url === "/v1/session-trust") {
    // Rate-limit before bearer validation so failed token guesses consume the same remote-address budget.
    if (!limiter.allow(`${remote}:session-trust`)) {
      send(response, 429, { status: "REJECTED", result_code: "SESSION_TRUST_RATE_LIMITED", request_id: requestId, correlation_id: correlationId }, { "retry-after": "60" });
      return;
    }
    const authorization = request.headers.authorization ?? null;
    const authorized = sessionTrustPublication !== null
      && sessionTrustTransportToken !== null
      && authorization !== null
      && authorization.startsWith("Bearer ")
      && constantTimeEqual(authorization.slice(7), sessionTrustTransportToken);
    if (!authorized) {
      send(response, 401, { status: "REJECTED", result_code: "SESSION_TRUST_UNAUTHORIZED", request_id: requestId, correlation_id: correlationId });
      return;
    }
    try {
      const bundle = sessionTrustPublication.load();
      send(response, 200, bundle, { "x-request-id": requestId, "x-correlation-id": correlationId });
    } catch {
      send(response, 503, { status: "REJECTED", result_code: "SESSION_TRUST_UNAVAILABLE", request_id: requestId, correlation_id: correlationId });
    }
    return;
  }

  // Reserved commercial authorization surface: explicitly fail closed until
  // D3 deployment approval, native registrations and key custody are verified.
  // Do not route isolated PostgreSQL fixtures or accept client session IDs.
  if (request.url === "/v1/commercial/token" ||
      request.url === "/v1/commercial/authorize" ||
      request.url === "/v1/commercial/login" ||
      request.url === "/v1/commercial/browser/session" ||
      request.url === "/v1/commercial/browser/logout" ||
      request.url === "/v1/commercial/browser/rotate") {
    if (!limiter.allow(`${remote}:commercial-auth`)) {
      send(response,429,{status:"REJECTED",result_code:"COMMERCIAL_AUTH_RATE_LIMITED",
        request_id:requestId,correlation_id:correlationId},{"retry-after":"60"});
      return;
    }
    send(response,503,{status:"REJECTED",result_code:"COMMERCIAL_AUTH_NOT_ACTIVATED",
      request_id:requestId,correlation_id:correlationId});
    return;
  }

  if (request.method !== "POST" || request.url !== "/v1/device-enrollment") {
    send(response, 404, { status: "REJECTED", result_code: "NOT_FOUND" });
    return;
  }

  const authorization = request.headers.authorization ?? null;
  if (!limiter.allow(`${remote}:device-enrollment`)) {
    send(response, 429, { status: "REJECTED", result_code: "DEVICE_ENROLLMENT_RATE_LIMITED", request_id: requestId, correlation_id: correlationId }, { "retry-after": "60" });
    return;
  }

  const context = protocolContext(request, requestId, correlationId, authorization);
  try {
    const body = await readBody(request, MAX_BODY_BYTES);
    const result = await handler.handle(context, body);
    send(response, result.statusCode, result.body, { "x-request-id": requestId, "x-correlation-id": correlationId });
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_.-]+$/.test(error.message) ? error.message : "DEVICE_ENROLLMENT_FAILED";
    send(response, code === "DEVICE_ENROLLMENT_BODY_TOO_LARGE" ? 413 : 500, {
      status: "REJECTED", result_code: code, request_id: requestId, correlation_id: correlationId,
      error: { code, retryable: code === "DEVICE_ENROLLMENT_FAILED", user_message_key: "device_enrollment.rejected" },
    });
  }
});

server.on("clientError", (_error, socket) => socket.destroy());
if(deployment){server.requestTimeout=deployment.requestTimeoutMs;server.headersTimeout=deployment.headersTimeoutMs;}
if(deployment)server.once("error",()=>{process.stderr.write("CENTRAL_LISTEN_FAILED\n");void pool.end().finally(()=>{process.exitCode=1;});});
server.listen(PORT, "0.0.0.0", () => process.stdout.write(JSON.stringify({ service: "central-authority", status: "LISTENING", port: PORT }) + "\n"));

let stopping=false;
const shutdown = async (signal: string) => {
  if(stopping)return;stopping=true;
  try{
    if(deployment){const outcome=await drainCentralServer(server,pool,deployment.shutdownTimeoutMs);
      process.stdout.write(JSON.stringify({service:"central-authority",status:"STOPPED",signal,outcome})+"\n");process.exit(outcome==="DRAINED"?0:1);}
    server.close();await pool.end();
    process.stdout.write(JSON.stringify({ service: "central-authority", status: "STOPPED", signal }) + "\n");process.exit(0);
  }catch{process.stderr.write("CENTRAL_SHUTDOWN_FAILED\n");process.exit(1);}
};
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
