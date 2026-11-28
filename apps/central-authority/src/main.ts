import { LICENSE_LOCAL_ACCEPTANCE_PATH } from "@pos-platform/contracts";
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
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
import { createMerchantPaymentNoticeHandler } from "./merchant-payment-notice-ingest.js";
import { prepareAndroidCommercialRuntime,isAndroidCommercialRoute } from "./android-commercial-central-runtime.js";
import { createNativeRequestHandler } from "./native-business-request-registration.js";
import { prepareAndroidAssociationPublication, handleAndroidAssociation } from "./android-association-publication.js";
import { FixedWindowRateLimiter } from "./fixed-window-rate-limiter.js";
import { DurableFixedWindowRateLimiter } from "./durable-fixed-window-rate-limiter.js";
import { PostgresFixedWindowRateLimiter, allowsNonPostgresRateLimit } from "./postgres-fixed-window-rate-limiter.js";
import {
  CommercialPortalBridgeService,
  PostgresCommercialPortalBridgeStore,
  createCommercialPortalBridgeHandler,
} from "./commercial-portal-bridge/index.js";
import { prepareCommercialBridgeGlobalGate } from "./commercial-portal-bridge/prepare-global-gate.js";
import { PostgresCommercialLicenseIssuer } from "./commercial-portal-bridge/trial-license-issuer.js";

import { createTelemetryBundle, observeHttp } from "@pos-platform/observability";
import { startOtlpSdk } from "@pos-platform/observability/node";
const stopTelemetry = startOtlpSdk("central-authority");
const telemetry = createTelemetryBundle({
  sink: {
    write(record) {
      process.stdout.write(`${JSON.stringify(record)}\n`);
    },
  },
  serviceName: "central-authority",
  enableOtelApi: process.env.OTEL_ENABLE_API === "1",
});

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

const databaseUrl = process.env.CENTRAL_DATABASE_URL_FILE
  ? secretFromFile("CENTRAL_DATABASE_URL_FILE")
  : required("CENTRAL_DATABASE_URL");
const globalProvision = process.env.CENTRAL_GLOBAL_ADMINISTRATION_PROVISION_FILE;
const businessProvision = process.env.CENTRAL_BUSINESS_PROVISION_FILE;
const androidAssociationProvision = process.env.CENTRAL_ANDROID_ASSOCIATION_PROVISION_FILE;
const androidCommercialProvision=process.env.CENTRAL_ANDROID_COMMERCIAL_PROVISION_FILE;
const deployment = androidCommercialProvision !== undefined || globalProvision || businessProvision !== undefined || androidAssociationProvision !== undefined
  ? parseCentralDeploymentConfiguration({ ...process.env, CENTRAL_DATABASE_URL: databaseUrl })
  : null;
const transportToken = deployment === null && !process.env.D3_ENROLLMENT_TRANSPORT_TOKEN_FILE
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
const rateLimitStateFile = process.env.CENTRAL_RATE_LIMIT_STATE_FILE;
if (rateLimitStateFile !== undefined && !isAbsolute(rateLimitStateFile)) {
  throw new Error("CENTRAL_RATE_LIMIT_STATE_FILE_MUST_BE_ABSOLUTE");
}
/** Default: PostgreSQL distributed budgets. file = single-node durable; memory = process-local. */
const rateLimitBackend = (process.env.CENTRAL_RATE_LIMIT_BACKEND ?? "postgres").trim().toLowerCase();
if (!["postgres", "file", "memory"].includes(rateLimitBackend)) {
  throw new Error("CENTRAL_RATE_LIMIT_BACKEND_INVALID");
}
if (rateLimitBackend !== "postgres" && !allowsNonPostgresRateLimit(process.env.NODE_ENV, deployment?.environment ?? process.env.CENTRAL_DEPLOYMENT_ENVIRONMENT)) {
  throw new Error("CENTRAL_RATE_LIMIT_POSTGRES_REQUIRED");
}
if (rateLimitBackend === "file" && rateLimitStateFile === undefined) {
  throw new Error("CENTRAL_RATE_LIMIT_STATE_FILE_REQUIRED_FOR_FILE_BACKEND");
}
const limiter = rateLimitBackend === "postgres"
  ? new PostgresFixedWindowRateLimiter(pool, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)
  : rateLimitBackend === "file"
  ? new DurableFixedWindowRateLimiter(
    rateLimitStateFile!,
    RATE_LIMIT_MAX,
    RATE_LIMIT_BUCKETS_MAX,
    RATE_LIMIT_WINDOW_MS,
  )
  : new FixedWindowRateLimiter(RATE_LIMIT_MAX, RATE_LIMIT_BUCKETS_MAX, RATE_LIMIT_WINDOW_MS);

async function allowRate(key: string): Promise<boolean> {
  const allowed = await Promise.resolve(limiter.allow(key));
  const route = key.includes("session-trust") ? "session-trust" : "device-enrollment";
  if (allowed) {
    telemetry.metrics.counter("pos.rate_limit.allowed", 1, { route });
  } else {
    telemetry.metrics.counter("pos.rate_limit.denied", 1, { route });
    telemetry.alerts.emit({
      kind: "security.rate_limited",
      severity: "warn",
      attributes: { route },
    });
  }
  return allowed;
}

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

const commercialBridgeHandler = (() => {
  const bridgeKey = process.env.COMMERCIAL_BRIDGE_KEY?.trim() ?? "";
  const trialWebhookKey = process.env.CENTRAL_TRIAL_WEBHOOK_KEY?.trim() ?? "";
  if (!bridgeKey || !trialWebhookKey) return null;
  if (bridgeKey.length < 32 || trialWebhookKey.length < 32) {
    throw new Error("COMMERCIAL_BRIDGE_KEYS_TOO_SHORT");
  }
  // Production/main TLS listener always uses PostgreSQL — never process-local memory.
  const store = new PostgresCommercialPortalBridgeStore(pool);
  const issuer = new PostgresCommercialLicenseIssuer(pool);
  const bridge = new CommercialPortalBridgeService(store, {
    bridgeKey,
    trialWebhookKey,
    licenseIssuer: issuer,
    recoverBoundProvisioning: deployment?.environment === "PREPRODUCTION" &&
      process.env.CENTRAL_COMMERCIAL_PROVISIONING_RECOVERY_ENABLED === "1",
    isGlobalSessionActive: async (sessionId) => {
      const found = await pool.query(
        `SELECT 1 FROM identity.sessions
          WHERE id=$1::uuid AND revoked_at IS NULL AND expires_at>clock_timestamp()
            AND tenant_id IS NULL AND tenant_membership_id IS NULL`,
        [sessionId],
      );
      return found.rowCount === 1;
    },
  });
  // Mint: bridge key = service hop only. GLOBAL MFA cookie+CSRF via GlobalAdministrationSessionGate
  const gate = prepareCommercialBridgeGlobalGate({
    pool,
    origin: deployment?.origin ?? null,
    provisionFile: globalProvision ?? null,
  });
  return createCommercialPortalBridgeHandler(bridge, gate);
})();

const androidAssociationPublication = (() => {
  if (androidAssociationProvision === undefined) return undefined;
  if (!deployment || deployment.environment === "LOCAL") throw Error("ANDROID_ASSOCIATION_REAL_DEPLOYMENT_REQUIRED");
  verifyCentralTlsIdentity(deployment, tlsCert, createPrivateKey(tlsKey));
  return prepareAndroidAssociationPublication(androidAssociationProvision, deployment);
})();

// Activation requires the complete native authorization composition, not DAL alone.
const androidCommercial=await (async()=>{
 if(androidCommercialProvision===undefined)return undefined;
 if(!deployment||deployment.environment==="LOCAL"||!androidAssociationPublication||!businessProvision||!businessHandler||!globalHandler?.activation)throw Error("ANDROID_COMMERCIAL_DEPENDENCIES_REQUIRED");
 return prepareAndroidCommercialRuntime({pool,provisionFile:androidCommercialProvision,businessProvision,origin:deployment.origin,environment:deployment.environment,registration:androidAssociationPublication.registration});
})();
const nativeRequestHandler = createNativeRequestHandler();
const merchantPaymentNoticeHandler = deployment?.environment === "PREPRODUCTION" &&
    process.env.CENTRAL_MERCHANT_PAYMENT_NOTICE_INGEST_ENABLED === "1"
  ? createMerchantPaymentNoticeHandler(pool, deployment.origin, readBody, allowRate)
  : null;
const server = createServer({ key: tlsKey, cert: tlsCert, minVersion: "TLSv1.2" }, createCentralRouter(async (request, response) => {
  const requestId = request.headers["x-request-id"]?.toString() ?? createHash("sha256").update(`${Date.now()}:${Math.random()}`).digest("hex").slice(0, 32);
  const correlationId = request.headers["x-correlation-id"]?.toString() ?? requestId;
  const remote = request.socket.remoteAddress ?? "unknown";

  if (handleAndroidAssociation(request, response, androidAssociationPublication)) return;
  if (androidCommercial && await androidCommercial(request,response)) return;
  if (await nativeRequestHandler(request, response)) return;
  if (merchantPaymentNoticeHandler && await merchantPaymentNoticeHandler(request, response)) return;
  if (isAndroidCommercialRoute(request.url)) {send(response,503,{code:"ANDROID_COMMERCIAL_NOT_PROVISIONED"});return;}

  if (commercialBridgeHandler) {
    const handled = await commercialBridgeHandler(request, response);
    if (handled) return;
  }

  const activation = request.url === "/v1/licensing/activations/resolve" || request.url === LICENSE_LOCAL_ACCEPTANCE_PATH;
  if (activation ||
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
    observeHttp(telemetry, request, response, activation ? "licensing.activation" : "platform.administration",
      (status) => activation && (status === 403 || status === 429) ? "license.activation_rejected" : undefined);
    await (activation ? globalHandler.activation : globalHandler.portal)(request, response);
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    send(response, 200, { status: "OK", service: "central-authority", protocol_version: "1.0.0" });
    return;
  }

  if (request.method === "POST" && request.url === FACTUS_PAY_COLLECTION_WEBHOOK_PATH) {
    if (factusPayHandler === undefined) {
      send(response, 503, { status: "REJECTED", result_code: "FACTUS_PAY_NOT_PROVISIONED" });
      return;
    }
    observeHttp(telemetry, request, response, "payment.factus_webhook",
      (status) => status >= 400 ? "payment.webhook_rejected" : undefined);
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
    observeHttp(telemetry, request, response, "security.session_trust");
    if (!(await allowRate(`${remote}:session-trust`))) {
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
  if (!(await allowRate(`${remote}:${authFingerprint}`))) {
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
  if (limiter instanceof DurableFixedWindowRateLimiter) {
    limiter.dispose();
  }
  await pool.end();
  await telemetry.logger.flush();
  await stopTelemetry?.();
  process.stdout.write(JSON.stringify({ service: "central-authority", status: "STOPPED", signal }) + "\n");
  process.exit(0);
};
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => void shutdown(signal).catch(() => {
    process.stderr.write("CENTRAL_SHUTDOWN_FAILED\n");
    process.exit(1);
  }));
}
