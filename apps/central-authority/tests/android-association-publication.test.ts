import { describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { X509Certificate } from "node:crypto";
import { createAndroidAssociationDocument, handleAndroidAssociation } from "../src/android-association-publication.js";
import { businessTestTls } from "./helpers/business-test-tls.js";

const origin = "https://central.camachoposcolombia.com";
const certificate = Buffer.from(businessTestTls().cert);
const parsed = new X509Certificate(certificate);
const at = new Date((Date.parse(parsed.validFrom) + Date.parse(parsed.validTo)) / 2);
const deployment = { origin, environment: "PREPRODUCTION" as const };
const registration = { clientId: "android-commercial", platform: "ANDROID" as const, redirectUri: origin + "/android/callback",
  authorizationOrigin: origin, androidPackageId: "co.camachopos.colombia", androidSigningCertificateSha256: parsed.fingerprint256.toUpperCase() };
function request(method: string, url: string, host = new URL(origin).host) {
  const writeHead = vi.fn(), end = vi.fn();
  return { req: { method, url, headers: { host } } as IncomingMessage,
    res: { writeHead, end } as unknown as ServerResponse, writeHead, end };
}
describe("Android commercial public association", () => {
  it("derives the exact package and fingerprint from the configured public certificate", () => {
    const document = createAndroidAssociationDocument(registration, certificate, deployment, at);
    expect(JSON.parse(document)[0].target).toEqual({ namespace: "android_app", package_name: registration.androidPackageId,
      sha256_cert_fingerprints: [registration.androidSigningCertificateSha256] });
    const r = request("GET", "/.well-known/assetlinks.json");
    expect(handleAndroidAssociation(r.req, r.res, { origin, document })).toBe(true);
    expect(r.writeHead.mock.calls[0]?.[0]).toBe(200);
    expect(r.end).toHaveBeenCalledWith(document);
  });
  it("rejects a different signer, package, callback, origin and local deployment", () => {
    for (const change of [{ androidSigningCertificateSha256: Array(32).fill("00").join(":") }, { androidPackageId: "co.camachopos.lab" },
      { redirectUri: origin + "/callback" }, { authorizationOrigin: "https://other.com" }])
      expect(() => createAndroidAssociationDocument({ ...registration, ...change }, certificate, deployment, at)).toThrow();
    expect(() => createAndroidAssociationDocument(registration, certificate, { ...deployment, environment: "LOCAL" }, at)).toThrow();
    expect(() => createAndroidAssociationDocument(registration, certificate, deployment, new Date(0))).toThrow();
  });
  it("fails closed when unprovisioned and rejects non-GET or foreign Host", () => {
    const document = createAndroidAssociationDocument(registration, certificate, deployment, at);
    for (const [method, host, expected] of [["GET", new URL(origin).host, 503], ["POST", new URL(origin).host, 405], ["GET", "other.com", 421]] as const) {
      const r = request(method, "/.well-known/assetlinks.json", host);
      expect(handleAndroidAssociation(r.req, r.res, expected === 503 ? undefined : { origin, document })).toBe(true);
      expect(r.writeHead.mock.calls[0]?.[0]).toBe(expected);
    }
  });
  it("does not intercept existing BUSINESS, GLOBAL, FACTUS or enrollment routes", () => {
    for (const url of ["/business", "/platform", "/v1/device-enrollment", "/v1/webhooks/factus-pay/collections", "/.well-known/assetlinks.json?x=1"]) {
      const r = request("GET", url);
      expect(handleAndroidAssociation(r.req, r.res)).toBe(false);
      expect(r.writeHead).not.toHaveBeenCalled();
    }
  });
});
