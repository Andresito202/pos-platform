import { constants, openSync, fstatSync, readFileSync, closeSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import { isAbsolute } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { validateCommercialPosRegistration, type NativeClientRegistration } from "@pos-platform/contracts";

const ASSOCIATION_PATH = "/.well-known/assetlinks.json";
const PACKAGE_ID = "co.camachopos.colombia";
const ORIGIN = "https://central.camachoposcolombia.com";
type Deployment = { origin: string; environment: "LOCAL" | "PREPRODUCTION" | "PRODUCTION" };

function managed(path: string, limit: number): Buffer {
  if (!isAbsolute(path)) throw Error("ANDROID_ASSOCIATION_MANAGED_FILE_REQUIRED");
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size <= 0 || stat.size > limit) throw Error("ANDROID_ASSOCIATION_FILE_REJECTED");
    const bytes = readFileSync(fd);
    if (bytes.length !== stat.size || bytes.length > limit) throw Error("ANDROID_ASSOCIATION_FILE_CHANGED");
    return bytes;
  } finally { closeSync(fd); }
}

export function createAndroidAssociationDocument(registration: NativeClientRegistration, certificate: Buffer, deployment: Deployment, at = new Date()) {
  if (deployment.environment === "LOCAL" || deployment.origin !== ORIGIN) throw Error("ANDROID_ASSOCIATION_DEPLOYMENT_REJECTED");
  const validated = validateCommercialPosRegistration(registration, new URL(deployment.origin).hostname, deployment.origin).registration;
  if (validated.platform !== "ANDROID" || validated.androidPackageId !== PACKAGE_ID ||
      validated.authorizationOrigin !== deployment.origin || validated.redirectUri !== deployment.origin + "/android/callback")
    throw Error("ANDROID_ASSOCIATION_REGISTRATION_REJECTED");
  const cert = new X509Certificate(certificate);
  if (!Number.isFinite(at.getTime()) || at.getTime() < Date.parse(cert.validFrom) || at.getTime() >= Date.parse(cert.validTo) ||
      cert.fingerprint256.toUpperCase() !== validated.androidSigningCertificateSha256)
    throw Error("ANDROID_ASSOCIATION_CERTIFICATE_REJECTED");
  return JSON.stringify([{ relation: ["delegate_permission/common.handle_all_urls"],
    target: { namespace: "android_app", package_name: PACKAGE_ID, sha256_cert_fingerprints: [cert.fingerprint256.toUpperCase()] } }]);
}

export function prepareAndroidAssociationPublication(provisionFile: string, deployment: Deployment) {
  const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(managed(provisionFile, 16384)));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw Error("ANDROID_ASSOCIATION_PROVISION_REJECTED");
  const p = parsed as Record<string, unknown>;
  if (Object.keys(p).sort().join(",") !== "profile,registration,signing_certificate_file" ||
      p.profile !== "CAMACHO_ANDROID_ASSOCIATION_V1" || typeof p.signing_certificate_file !== "string" ||
      !p.registration || typeof p.registration !== "object" || Array.isArray(p.registration))
    throw Error("ANDROID_ASSOCIATION_PROVISION_REJECTED");
  const registration = p.registration as Record<string, unknown>;
  if (Object.keys(registration).sort().join(",") !== "androidPackageId,androidSigningCertificateSha256,authorizationOrigin,clientId,platform,redirectUri")
    throw Error("ANDROID_ASSOCIATION_REGISTRATION_FIELDS_REJECTED");
  const document = createAndroidAssociationDocument(registration as unknown as NativeClientRegistration, managed(p.signing_certificate_file, 16384), deployment);
  return Object.freeze({ origin: deployment.origin, document, registration: Object.freeze(registration as unknown as NativeClientRegistration) });
}

export function handleAndroidAssociation(request: IncomingMessage, response: ServerResponse, publication?: { origin: string; document: string }): boolean {
  if (request.url !== ASSOCIATION_PATH) return false;
  const headers = { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" };
  if (request.method !== "GET") {
    response.writeHead(405, { ...headers, allow: "GET" }); response.end(JSON.stringify({ code: "METHOD_NOT_ALLOWED" }));
  } else if (!publication) {
    response.writeHead(503, headers); response.end(JSON.stringify({ code: "ANDROID_ASSOCIATION_NOT_PROVISIONED" }));
  } else if (request.headers.host !== new URL(publication.origin).host) {
    response.writeHead(421, headers); response.end(JSON.stringify({ code: "CENTRAL_HOST_REJECTED" }));
  } else {
    response.writeHead(200, headers); response.end(publication.document);
  }
  return true;
}
