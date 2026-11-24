import { readFileSync } from "node:fs";
import { createServer } from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash, createPrivateKey, timingSafeEqual } from "node:crypto";
import { CentralDeviceCredentialIssuer, DeviceEnrollmentHttpHandler, type DeviceEnrollmentTransportContext } from "@pos-platform/device-trust";
import { createPostgresPool, PostgresDeviceRegistryRepository } from "@pos-platform/database-postgres";
import { GlobalAdministrationProvisionSchema } from "@pos-platform/contracts";
import { prepareGlobalAdministrationRuntime } from "./global-administration-runtime.js";
import { prepareLicenseCapacityRuntime } from "./license-capacity-runtime.js";
import { parseCentralDeploymentConfiguration, verifyCentralRuntimeDatabase, verifyCentralTlsIdentity } from "./central-deployment-configuration.js";
import { SessionTrustPublication } from "./session-trust-publication.js";
import { prepareFactusPayRuntime } from "./factus-pay-runtime.js";
import { FACTUS_PAY_COLLECTION_WEBHOOK_PATH } from "./factus-pay-webhook-handler.js";
import { prepareBusinessAdministrationRuntime } from "./business-administration-runtime.js";
import { prepareSubscriptionFulfillmentRuntime } from "./subscription-fulfillment-runtime.js";
import { prepareSubscriptionFactusPayGateway } from "./subscription-factus-pay-gateway-runtime.js";
import { createCentralRouter } from "./central-router.js";

const PORT = Number(process.env.CENTRAL_AUTHORITY_PORT ?? "8443");
const MAX_BODY_BYTES = Number(process.env.D3_ENROLLMENT_MAX_BODY_BYTES ?? String(16 * 1024));
const MAX_CREDENTIAL_LIFETIME_MS = Number(process.env.D3_CREDENTIAL_LIFETIME_MS ?? String(24 * 60 * 60 * 1000));
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_BUCKETS_MAX = 10_000;

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

class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, { count: number; startedAt: number }>();
  allow(key: string, now = Date.now()): boolean {
    const existing = this.buckets.get(key);
    if (!existing || now - existing.startedAt >= RATE_LIMIT_WINDOW_MS) {
      if (this.buckets.size >= RATE_LIMIT_BUCKETS_MAX) {
        const first = this.buckets.keys().next().value;
        if (first) this.buckets.delete(first);
      }
      this.buckets.set(key, { count: 1, startedAt: now });
      return true;
    }
    if (existing.count >= RATE_LIMIT_MAX) return false;
    existing.count += 1;
    return true;
  }
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
  response.writeHead(statusCode, { "content-type": "application/json", "cache-control": "no-store", ...headers });
  response.end(JSON.stringify(body));
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
const globalProvision = process.env.CENTRAL_GLOBAL_ADMINISTRATION_PROVISION_FILE;
const businessProvision = process.env.CENTRAL_BUSINESS_PROVISION_FILE;
const deployment = globalProvision || businessProvision !== undefined ? parseCentralDeploymentConfiguration(process.env) : null;
const transportToken = deployment === null
  ? required("D3_ENROLLMENT_TRANSPORT_TOKEN")
  : secretFromFile("D3_ENROLLMENT_TRANSPORT_TOKEN_FILE");
const issuerPrivateKey = createPrivateKey(secretFromFile("D3_ISSUER_PRIVATE_KEY_FILE"));
const tlsKey = readFileSync(required("CENTRAL_TLS_KEY_FILE"));
const tlsCert = readFileSync(required("CENTRAL_TLS_CERT_FILE"));
const sessionTrustPublication = process.env.SESSION_TRUST_ARTIFACT_FILE === undefined
  ? null
  : new SessionTrustPublication(process.env.SESSION_TRUST_ARTIFACT_FILE);
const sessionTrustTransportToken = process.env.SESSION_TRUST_TRANSPORT_TOKEN_FILE === undefined
  ? null
  : secretFromFile("SESSION_TRUST_TRANSPORT_TOKEN_FILE");
const pool = createPostgresPool(databaseUrl, 10, "pos-platform-central-authority");

try {
  await verifyCentralRuntimeDatabase(pool);
  console.log("CENTRAL_DATABASE_CONNECTED");
} catch (error) {
  await pool.end();
  throw error;
}
const subscriptionFactusPayGatewayFile = process.env.CENTRAL_SUBSCRIPTION_FACTUS_PAY_GATEWAY_FILE;
const subscriptionFactusPayGateway = subscriptionFactusPayGatewayFile === undefined
  ? null
  : prepareSubscriptionFactusPayGateway(subscriptionFactusPayGatewayFile);

const subscriptionFulfillmentProvision = process.env.CENTRAL_SUBSCRIPTION_FULFILLMENT_PROVISION_FILE;
const subscriptionFulfillmentRuntime = await (async () => {
  if (!subscriptionFulfillmentProvision || !globalProvision) return null;
  try {
    const globalPolicy = GlobalAdministrationProvisionSchema.parse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(globalProvision))),
    );
    if (!globalPolicy.fulfillment_policies?.length) {
      throw new Error("LICENSING_FULFILLMENT_POLICY_REQUIRED");
    }
    return await prepareSubscriptionFulfillmentRuntime({
      pool,
      provisionFile: subscriptionFulfillmentProvision,
      approvedPolicies: globalPolicy.fulfillment_policies,
      factusPay: subscriptionFactusPayGateway,
    });
  } catch (error) {
    await pool.end();
    throw error;
  }
})();

const globalHandler = await (async () => {
  if (!globalProvision || !deployment) return undefined;
  const environment = deployment.environment;
  if (environment === "LOCAL") throw new Error("GLOBAL_ADMIN_REAL_DEPLOYMENT_REQUIRED");
  verifyCentralTlsIdentity(deployment, tlsCert, createPrivateKey(tlsKey));
  try {
    await verifyCentralRuntimeDatabase(pool);
    const licenseRuntime = await prepareLicenseCapacityRuntime({
      pool, provisionFile: required("CENTRAL_LICENSE_ACTIVATION_PROVISION_FILE"),
      origin: deployment.origin, environment,
    });
    return {
      portal: await prepareGlobalAdministrationRuntime({
        pool, provisionFile: globalProvision, origin: deployment.origin,
        licenseAuthority: licenseRuntime.authority,
        subscriptionFulfillment: subscriptionFulfillmentRuntime?.fulfillment ?? null,
        factusPay: subscriptionFactusPayGateway,
      }),
      activation: licenseRuntime.handler,
    };
  } catch (error) {
    subscriptionFulfillmentRuntime?.stopWorker();
    await pool.end();
    throw error;
  }
})();
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

const factusPayProvision = process.env.CENTRAL_FACTUS_PAY_PROVISION_FILE;
const factusPayHandler = factusPayProvision === undefined
  ? undefined
  : await prepareFactusPayRuntime(
    pool,
    factusPayProvision,
    subscriptionFulfillmentRuntime
      ? {
        onSubscriptionObservation: async (observation, keyContext) => {
          await subscriptionFulfillmentRuntime.fulfillment.enqueueFromWebhookObservation({
            tenantId: keyContext.tenantId,
            companyId: keyContext.companyId,
            integrationId: keyContext.integrationId,
            externalTransactionId: observation.external_transaction_id,
            amountScale6: observation.amount,
            currencyCode: observation.currency_code,
          });
          void subscriptionFulfillmentRuntime.fulfillment.processDue(4);
        },
      }
      : undefined,
  );

const businessHandler = await (async () => {
  if (businessProvision === undefined) return undefined;
  if (!deployment || deployment.environment === "LOCAL") throw Error("BUSINESS_REAL_DEPLOYMENT_REQUIRED");
  verifyCentralTlsIdentity(deployment, tlsCert, createPrivateKey(tlsKey));
  try { return await prepareBusinessAdministrationRuntime(pool, businessProvision, deployment.origin); }
  catch (error) { await pool.end(); throw error; }
})();

const server = createServer({ key: tlsKey, cert: tlsCert, minVersion: "TLSv1.2" }, createCentralRouter(async (request, response) => {
  const requestId = request.headers["x-request-id"]?.toString() ?? createHash("sha256").update(`${Date.now()}:${Math.random()}`).digest("hex").slice(0, 32);
  const correlationId = request.headers["x-correlation-id"]?.toString() ?? requestId;
  const remote = request.socket.remoteAddress ?? "unknown";

  if (request.url === "/v1/licensing/activations/resolve" ||
      request.url === "/platform" || request.url?.startsWith("/platform/") ||
      request.url?.startsWith("/v1/platform/")) {
    if (!globalHandler || !deployment) {
      send(response, 503, { status: "REJECTED", result_code: "GLOBAL_ADMINISTRATION_NOT_ACTIVATED" });
      return;
    }
    if (request.headers.host !== new URL(deployment.origin).host) {
      send(response, 421, { status: "REJECTED", result_code: "CENTRAL_HOST_REJECTED" });
      return;
    }
    await (request.url === "/v1/licensing/activations/resolve" ? globalHandler.activation : globalHandler.portal)(request, response);
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    send(response, 200, { status: "OK", service: "central-authority", protocol_version: "1.0.0" });
    return;
  }

  // Reserved Android/Windows BUSINESS native surface (migration 016 + DeviceProof
  // allowlist). Explicitly fail-closed until D3 registration, DAL publication and
  // native request activation are authorized. Do not invent an alternate stack.
  const commercialNativePath = request.url?.split("?", 1)[0] ?? "";
  if (
    commercialNativePath === "/v1/commercial/native-request-challenges"
    || commercialNativePath === "/v1/commercial/native-requests"
    || commercialNativePath === "/v1/commercial/token"
    || commercialNativePath === "/v1/commercial/login"
    || commercialNativePath === "/.well-known/assetlinks.json"
  ) {
    if (!limiter.allow(`${remote}:commercial-native`)) {
      send(response, 429, {
        status: "REJECTED",
        result_code: "COMMERCIAL_NATIVE_RATE_LIMITED",
        request_id: requestId,
        correlation_id: correlationId,
      }, { "retry-after": "60" });
      return;
    }
    send(response, 503, {
      status: "REJECTED",
      result_code: commercialNativePath === "/.well-known/assetlinks.json"
        ? "ANDROID_ASSET_LINKS_NOT_PUBLISHED"
        : "NATIVE_BUSINESS_ROUTE_NOT_ACTIVATED",
      request_id: requestId,
      correlation_id: correlationId,
      publication_status: "NOT_PUBLISHED",
    });
    return;
  }

  if (request.method === "POST" && request.url === FACTUS_PAY_COLLECTION_WEBHOOK_PATH) {
    if (factusPayHandler === undefined) {
      send(response, 503, { status: "REJECTED", result_code: "FACTUS_PAY_NOT_PROVISIONED" });
      return;
    }
    await factusPayHandler(request, response);
    return;
  }

  if (request.method === "GET" && request.url === "/v1/session-trust") {
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
    if (!limiter.allow(`${remote}:session-trust`)) {
      send(response, 429, { status: "REJECTED", result_code: "SESSION_TRUST_RATE_LIMITED", request_id: requestId, correlation_id: correlationId }, { "retry-after": "60" });
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

  if (request.method !== "POST" || request.url !== "/v1/device-enrollment") {
    send(response, 404, { status: "REJECTED", result_code: "NOT_FOUND" });
    return;
  }

  const authorization = request.headers.authorization ?? null;
  const authFingerprint = createHash("sha256").update(authorization ?? "anonymous").digest("hex");
  if (!limiter.allow(`${remote}:${authFingerprint}`)) {
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
}, businessHandler));

if (deployment) {
  server.requestTimeout = deployment.requestTimeoutMs;
  server.headersTimeout = deployment.headersTimeoutMs;
}
server.on("clientError", (_error, socket) => socket.destroy());
server.listen(PORT, deployment?.bindAddress ?? process.env.CENTRAL_BIND_ADDRESS ?? "127.0.0.1", () => process.stdout.write(JSON.stringify({ service: "central-authority", status: "LISTENING", port: PORT }) + "\n"));

const shutdown = async (signal: string) => {
  server.close();
  await pool.end();
  process.stdout.write(JSON.stringify({ service: "central-authority", status: "STOPPED", signal }) + "\n");
  process.exit(0);
};
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
