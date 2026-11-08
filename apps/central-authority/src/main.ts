import { lstatSync,readFileSync } from "node:fs";
import {isAbsolute} from "node:path";
import { createServer } from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash, createPrivateKey, timingSafeEqual } from "node:crypto";
import { CentralDeviceCredentialIssuer, DeviceEnrollmentHttpHandler, type DeviceEnrollmentTransportContext } from "@pos-platform/device-trust";
import { createPostgresPool, PostgresDeviceRegistryRepository } from "@pos-platform/database-postgres";
import { SessionTrustPublication,AuthorizationTrustPublication } from "./session-trust-publication.js";
import { FixedWindowRateLimiter } from "./fixed-window-rate-limiter.js";
import {resolveCentralDeploymentConfiguration,verifyCentralTlsIdentity,verifyEnrollmentIssuerKey,verifyCentralRuntimeDatabase,createCentralReadinessProbe} from "./central-deployment-configuration.js";
import {drainCentralServer} from "./central-server-shutdown.js";
import {prepareCentralCommercialRuntime} from "./central-commercial-runtime.js";
import {prepareFactusPayRuntime} from "./factus-pay-runtime.js";
import {FACTUS_PAY_COLLECTION_WEBHOOK_PATH} from "./factus-pay-webhook-handler.js";
import {prepareSubscriptionCollectionRuntime} from "./subscription-collection-runtime.js";
import {prepareGlobalAdministrationRuntime} from "./global-administration-runtime.js";
import {prepareLicenseCapacityRuntime} from "./license-capacity-runtime.js";
import {prepareCommercialPublicSite} from "./commercial-public-site.js";
import {CamachoCommercialDomains} from "@pos-platform/contracts";

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
const sasConfigured=process.env.AUTHORIZATION_TRUST_ARTIFACT_FILE!==undefined||process.env.AUTHORIZATION_TRUST_TRANSPORT_TOKEN_FILE!==undefined;
if(sasConfigured&&!deployment)throw Error("SAS_EXPLICIT_CENTRAL_DEPLOYMENT_REQUIRED");
if(sasConfigured){
  const path=required("AUTHORIZATION_TRUST_TRANSPORT_TOKEN_FILE");
  if(!isAbsolute(path))throw Error("SAS_MANAGED_TOKEN_ABSOLUTE_FILE_REQUIRED");
  const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4096)throw Error("SAS_MANAGED_TOKEN_FILE_REJECTED");
}
const authorizationTrustPublication=sasConfigured?new AuthorizationTrustPublication(required("AUTHORIZATION_TRUST_ARTIFACT_FILE"),
  {issuer:deployment!.origin,...(deployment!.environment==="LOCAL"?{}:{environment:deployment!.environment})}):null;
const authorizationTrustTransportToken=sasConfigured?secretFromFile("AUTHORIZATION_TRUST_TRANSPORT_TOKEN_FILE"):null;
if(authorizationTrustTransportToken!==null&&(authorizationTrustTransportToken.length<32||Buffer.byteLength(authorizationTrustTransportToken)>4096||
  /[\r\n]/.test(authorizationTrustTransportToken)||constantTimeEqual(authorizationTrustTransportToken,transportToken)||
  sessionTrustTransportToken!==null&&constantTimeEqual(authorizationTrustTransportToken,sessionTrustTransportToken)))throw Error("SAS_SEPARATE_MANAGED_TRANSPORT_TOKEN_REQUIRED");
const pool = createPostgresPool(databaseUrl, 10, "pos-platform-central-authority");
if(deployment){try{await verifyCentralRuntimeDatabase(pool);}catch{await pool.end();throw Error("CENTRAL_RUNTIME_DATABASE_REJECTED");}}
const readiness=deployment?createCentralReadinessProbe(pool,deployment.requestTimeoutMs):null;
const publicSiteFile=process.env.CENTRAL_PUBLIC_SITE_PROVISION_FILE;
if(publicSiteFile&&(!deployment||deployment.environment==='LOCAL'))throw Error("PUBLIC_SITE_EXPLICIT_DEPLOYMENT_REQUIRED");
const publicSite=publicSiteFile?await prepareCommercialPublicSite(pool,publicSiteFile,deployment!.origin,tlsCert):undefined;
const factusPayProvision=process.env.CENTRAL_FACTUS_PAY_PROVISION_FILE;
if(factusPayProvision&&!deployment)throw Error("FACTUS_PAY_EXPLICIT_DEPLOYMENT_REQUIRED");
const factusPayHandler=factusPayProvision?await prepareFactusPayRuntime(pool,factusPayProvision):undefined;
const globalProvision=process.env.CENTRAL_GLOBAL_ADMINISTRATION_PROVISION_FILE;
const licenseProvision=process.env.CENTRAL_LICENSE_ACTIVATION_PROVISION_FILE;
if(licenseProvision&&(!deployment||deployment.environment==="LOCAL"))throw Error("LICENSE_REAL_DEPLOYMENT_REQUIRED");
const licenseRuntime=licenseProvision?await prepareLicenseCapacityRuntime({pool,provisionFile:licenseProvision,origin:deployment!.origin,
  environment:deployment!.environment as "PREPRODUCTION"|"PRODUCTION"}):undefined;
if(globalProvision&&(!deployment||deployment.environment==="LOCAL"))throw Error("GLOBAL_ADMIN_REAL_DEPLOYMENT_REQUIRED");
const globalHandler=globalProvision?await prepareGlobalAdministrationRuntime({pool,provisionFile:globalProvision,origin:deployment!.origin,
  environment:deployment!.environment as "PREPRODUCTION"|"PRODUCTION",
  ...(licenseRuntime?{licenseAuthority:licenseRuntime.authority}:{})}):undefined;
const collectionsProvision=process.env.CENTRAL_FACTUS_PAY_COLLECTIONS_PROVISION_FILE;
if(collectionsProvision&&(!deployment||deployment.environment==="LOCAL"))throw Error("COLLECTIONS_REAL_DEPLOYMENT_REQUIRED");
const collectionsRuntime=collectionsProvision?await prepareSubscriptionCollectionRuntime({pool,provisionFile:collectionsProvision,
  onError:code=>process.stderr.write(JSON.stringify({service:"subscription-collections",code})+"\n")}):undefined;
const qr002RevokeOption=process.env.CENTRAL_MERCHANT_QR002_CONSENT_REVOKE_ENABLED;
if(qr002RevokeOption!==undefined&&!["true","false"].includes(qr002RevokeOption))
  throw Error("QR002_INVALID_CONSENT_REVOKE_FLAG");
if(qr002RevokeOption==="true"&&process.env.CENTRAL_MERCHANT_QR002_ADMIN_READ_ENABLED!=="true")
  throw Error("QR002_CONSENT_REVOCATION_REQUIRES_ADMIN_READ");
const qr002IngestOption=process.env.CENTRAL_MERCHANT_QR002_INGEST_ENABLED;
if(qr002IngestOption!==undefined&&!["true","false"].includes(qr002IngestOption))
  throw Error("QR002_INVALID_INGEST_FLAG");
if(qr002IngestOption==="true"&&process.env.CENTRAL_MERCHANT_QR002_ADMIN_READ_ENABLED!=="true")
  throw Error("QR002_INGEST_REQUIRES_ADMIN_READ");
const qr002Option=process.env.CENTRAL_MERCHANT_QR002_ADMIN_READ_ENABLED;
if(qr002Option!==undefined&&!["true","false"].includes(qr002Option))
  throw Error("QR002_INVALID_DEPLOYMENT_FLAG");
if(qr002Option==="true"&&process.env.CENTRAL_MERCHANT_QR001_ENABLED!=="true")
  throw Error("QR002_REQUIRES_QR001");
const qr001Option=process.env.CENTRAL_MERCHANT_QR001_ENABLED;
if(qr001Option!==undefined&&!["true","false"].includes(qr001Option))throw Error("QR001_INVALID_DEPLOYMENT_FLAG");
if(qr001Option==="true"&&!deployment)throw Error("QR001_CENTRAL_DEPLOYMENT_REQUIRED");
const commercialProvision=process.env.CENTRAL_COMMERCIAL_PROVISION_FILE;
if(commercialProvision&&(!deployment||deployment.environment==="LOCAL"||!sessionTrustPublication||!authorizationTrustPublication))throw Error("COMMERCIAL_REAL_DEPLOYMENT_TRUST_REQUIRED");
const commercialHandler=commercialProvision?await prepareCentralCommercialRuntime({pool,provisionFile:commercialProvision,
  origin:deployment!.origin,environment:deployment!.environment as "PREPRODUCTION"|"PRODUCTION",tls:{key:tlsKey,cert:tlsCert},
  publishedSsaFile:required("SESSION_TRUST_ARTIFACT_FILE"),publishedSasFile:required("AUTHORIZATION_TRUST_ARTIFACT_FILE"),
  merchantDestinationsEnabled:qr001Option==="true",
  merchantNotificationReadEnabled:qr002Option==="true",
  merchantNotificationIngestEnabled:qr002IngestOption==="true",
  merchantConsentRevocationEnabled:qr002RevokeOption==="true",
  ...(qr001Option==="true"?{merchantQrSigning:{
    keyPath:required("CENTRAL_QR001_PRIVATE_KEY_FILE"),
    keyId:required("CENTRAL_QR001_KEY_ID"),
    validFrom:required("CENTRAL_QR001_VALID_FROM"),
    validUntil:required("CENTRAL_QR001_VALID_UNTIL"),
  }}:{})}):undefined;
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
  if(publicSite&&request.headers.host===new URL(CamachoCommercialDomains.publicOrigin).host){await publicSite(request,response);return;}
  if(deployment&&request.headers.host!==new URL(deployment.origin).host){send(response,421,{status:"REJECTED",result_code:"CENTRAL_HOST_REJECTED"});return;}
  if(request.url?.split('?')[0]===CamachoCommercialDomains.androidCallbackPath||request.url===CamachoCommercialDomains.androidAssociationPath){
    send(response,503,{status:'REJECTED',result_code:'ANDROID_NATIVE_RUNTIME_NOT_PROVISIONED'});return;
  }
  const requestId = request.headers["x-request-id"]?.toString() ?? createHash("sha256").update(`${Date.now()}:${Math.random()}`).digest("hex").slice(0, 32);
  const correlationId = request.headers["x-correlation-id"]?.toString() ?? requestId;
  const remote = request.socket.remoteAddress ?? "unknown";
  if(request.url==="/v1/licensing/activations/resolve"){
    if(licenseRuntime)await licenseRuntime.handler(request,response);else send(response,503,{code:"LICENSE_ACTIVATION_NOT_PROVISIONED"});return;
  }

  if(request.url?.startsWith("/v1/platform/")||request.url==="/platform"||request.url?.startsWith("/platform/")||request.url==="/v1/licensing/offers"||request.url==="/pricing"||request.url?.startsWith("/pricing/")){
    if(globalHandler)await globalHandler(request,response);
    else send(response,503,{status:"REJECTED",result_code:"GLOBAL_ADMINISTRATION_NOT_ACTIVATED"});
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    send(response, 200, { status: "OK", service: "central-authority", protocol_version: "1.0.0" });
    return;
  }
  if(request.method==="GET"&&request.url==="/ready"){
    if(readiness&&await readiness())send(response,200,{status:"READY",service:"central-authority",commercial_auth:commercialHandler?"CONFIGURED":"NOT_ACTIVATED"});
    else send(response,503,{status:"NOT_READY",service:"central-authority"});return;
  }

  if (request.method === "GET" && (request.url === "/v1/session-trust"||request.url==="/v1/authorization-trust")) {
    const sas=request.url==="/v1/authorization-trust",publication=sas?authorizationTrustPublication:sessionTrustPublication,
      token=sas?authorizationTrustTransportToken:sessionTrustTransportToken,prefix=sas?"AUTHORIZATION_TRUST":"SESSION_TRUST";
    // Rate-limit before bearer validation so failed token guesses consume the same remote-address budget.
    if (!limiter.allow(`${remote}:${sas?"authorization-trust":"session-trust"}`)) {
      send(response, 429, { status: "REJECTED", result_code: `${prefix}_RATE_LIMITED`, request_id: requestId, correlation_id: correlationId }, { "retry-after": "60" });
      return;
    }
    const authorization = request.headers.authorization ?? null;
    const authorized = publication !== null
      && token !== null
      && authorization !== null
      && authorization.startsWith("Bearer ")
      && constantTimeEqual(authorization.slice(7), token);
    if (!authorized) {
      send(response, 401, { status: "REJECTED", result_code: `${prefix}_UNAUTHORIZED`, request_id: requestId, correlation_id: correlationId });
      return;
    }
    try {
      const bundle = publication.load();
      send(response, 200, bundle, { "x-request-id": requestId, "x-correlation-id": correlationId });
    } catch {
      send(response, 503, { status: "REJECTED", result_code: `${prefix}_UNAVAILABLE`, request_id: requestId, correlation_id: correlationId });
    }
    return;
  }

  if(commercialHandler&&(request.url?.startsWith("/v1/commercial/")||request.url?.startsWith("/v1/business-session/"))){commercialHandler(request,response);return;}
  if(request.url?.split("?",1)[0]===FACTUS_PAY_COLLECTION_WEBHOOK_PATH){
    if(!factusPayHandler){send(response,503,{status:"REJECTED",result_code:"FACTUS_PAY_NOT_PROVISIONED"});return;}
    await factusPayHandler(request,response);return;
  }
  // Reserved commercial authorization surface: explicitly fail closed until
  // D3 deployment approval, native registrations and key custody are verified.
  // Do not route isolated PostgreSQL fixtures or accept client session IDs.
  if (request.url === "/v1/commercial/token" ||
      request.url === "/v1/commercial/refresh" ||
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
server.listen(PORT, "0.0.0.0", () => {
  collectionsRuntime?.start();
  process.stdout.write(JSON.stringify({ service: "central-authority", status: "LISTENING", port: PORT }) + "\n");
});

let stopping=false;
const shutdown = async (signal: string) => {
  if(stopping)return;stopping=true;
  try{
    await collectionsRuntime?.stop();
    if(deployment){const outcome=await drainCentralServer(server,pool,deployment.shutdownTimeoutMs);
      process.stdout.write(JSON.stringify({service:"central-authority",status:"STOPPED",signal,outcome})+"\n");process.exit(outcome==="DRAINED"?0:1);}
    server.close();await pool.end();
    process.stdout.write(JSON.stringify({ service: "central-authority", status: "STOPPED", signal }) + "\n");process.exit(0);
  }catch{process.stderr.write("CENTRAL_SHUTDOWN_FAILED\n");process.exit(1);}
};
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
