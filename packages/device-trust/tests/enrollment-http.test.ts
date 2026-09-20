import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SignedDeviceTrustCredentialSchema } from "@pos-platform/contracts";
import { canonicalDeviceTrustJson, CentralDeviceCredentialIssuer, DeviceEnrollmentHttpHandler, type CentralDeviceEnrollmentRepository, type DeviceEnrollmentTransportContext } from "../src/index.js";

const binding = { tenantId: "018f0000-0000-7000-8000-000000000001", companyId: "018f0000-0000-7000-8000-000000000002", installationId: "018f0000-0000-7000-8000-000000000003", deviceId: "018f0000-0000-7000-8000-000000000004" };
const ISSUER = generateKeyPairSync("ed25519");
const DEVICE = generateKeyPairSync("ed25519");
const TRUST_KEY_ID = "DEVICE_TRUST_HTTP_TEST";
const DEVICE_KEY_ID = "DEVICE-KEY-HTTP-TEST";
const publicKeyPem = DEVICE.publicKey.export({ type: "spki", format: "pem" }).toString();
const challenge = { challenge_id: "018f0000-0000-7000-8000-000000000020", tenant_id: binding.tenantId, installation_id: binding.installationId, device_id: binding.deviceId, nonce: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", issued_at: "2099-09-16T12:00:00Z", expires_at: "2099-09-16T12:05:00Z" };
const validProof = sign(null, Buffer.from(canonicalDeviceTrustJson(challenge)), DEVICE.privateKey).toString("base64url");
const request = { activation_id: "018f0000-0000-7000-8000-000000000010", activation_secret: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-", tenant_id: binding.tenantId, company_id: binding.companyId, installation_id: binding.installationId, device_id: binding.deviceId, device_key_id: DEVICE_KEY_ID, device_public_key_pem: publicKeyPem, challenge, proof: { challenge_id: challenge.challenge_id, device_key_id: DEVICE_KEY_ID, signature: validProof }, requested_at: "2099-09-16T12:00:00Z", version: 1 };
const context: DeviceEnrollmentTransportContext = { authorization: "Bearer transport-test", contentType: "application/json", contentLength: null, requestId: "018f0000-0000-7000-8000-000000000030", correlationId: "018f0000-0000-7000-8000-000000000031" };

function issuer(consumable = true): CentralDeviceCredentialIssuer {
  let consumed = false;
  const repository: CentralDeviceEnrollmentRepository = {
    findDevice: async () => ({ device_id: binding.deviceId, installation_id: binding.installationId, tenant_id: binding.tenantId, company_id: binding.companyId, device_key_id: DEVICE_KEY_ID, device_public_key: publicKeyPem, status: "PENDING", trust_key_id: TRUST_KEY_ID, trust_key_purpose: "DEVICE_TRUST" }),
    consumeActivationAndIssueCredential: async () => { if (!consumable || consumed) return false; consumed = true; return true; },
  };
  return new CentralDeviceCredentialIssuer(repository, ISSUER.privateKey, { now: () => new Date("2099-09-16T12:00:00Z") });
}
function validHandler(consumable = true) {
  return new DeviceEnrollmentHttpHandler(issuer(consumable), { authorize: (value) => value.authorization === "Bearer transport-test", maxBodyBytes: 16 * 1024, maxCredentialLifetimeMs: 60 * 60 * 1000, now: () => new Date("2099-09-16T12:00:00Z") });
}

describe("D-3 enrollment HTTP boundary", () => {
  it("rejects unauthenticated transport before parsing the body", async () => {
    const result = await validHandler().handle({ ...context, authorization: null }, "not-json");
    expect(result.statusCode).toBe(401);
  });
  it("rejects oversized and content-length-mismatched bodies", async () => {
    const handler = new DeviceEnrollmentHttpHandler(issuer(), { authorize: () => true, maxBodyBytes: 1024, maxCredentialLifetimeMs: 60 * 60 * 1000, now: () => new Date("2099-09-16T12:00:00Z") });
    expect((await handler.handle(context, "x".repeat(1025))).statusCode).toBe(413);
    expect((await handler.handle({ ...context, contentLength: 1 }, "{}")).statusCode).toBe(400);
  });
  it("rejects malformed JSON and schema-invalid enrollment requests", async () => {
    const handler = validHandler();
    expect((await handler.handle(context, "{")).statusCode).toBe(400);
    const invalid = await handler.handle(context, JSON.stringify({ ...request, activation_secret: "short" }));
    expect(invalid.statusCode).toBe(422);
  });
  it("completes the D-3 boundary with device PoP and returns the signed credential", async () => {
    const result = await validHandler().handle(context, JSON.stringify(request));
    expect(result.statusCode).toBe(200);
    const body = result.body.result as { credential_id: string; credential: unknown };
    expect(body.credential_id).toBeTruthy();
    expect(SignedDeviceTrustCredentialSchema.safeParse(body.credential).success).toBe(true);
  });
  it("consumes the one-shot activation and rejects replay", async () => {
    const handler = validHandler(true);
    expect((await handler.handle(context, JSON.stringify(request))).statusCode).toBe(200);
    const replay = await handler.handle({ ...context, requestId: "018f0000-0000-7000-8000-000000000032" }, JSON.stringify(request));
    expect(replay.statusCode).toBe(409);
    expect(replay.body.result_code).toBe("ACTIVATION_NOT_CONSUMABLE");
  });
  it("does not expose issuer or database exceptions", async () => {
    const repository: CentralDeviceEnrollmentRepository = { findDevice: async () => { throw new Error("database password leaked"); }, consumeActivationAndIssueCredential: async () => false };
    const failingIssuer = new CentralDeviceCredentialIssuer(repository, ISSUER.privateKey, { now: () => new Date("2099-09-16T12:00:00Z") });
    const result = await new DeviceEnrollmentHttpHandler(failingIssuer, { authorize: () => true, maxBodyBytes: 16 * 1024, maxCredentialLifetimeMs: 60 * 60 * 1000, now: () => new Date("2099-09-16T12:00:00Z") }).handle(context, JSON.stringify(request));
    expect(result.statusCode).toBe(500);
    expect(JSON.stringify(result.body)).not.toContain("database password leaked");
  });
});
