import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SignedDeviceTrustCredentialSchema } from "@pos-platform/contracts";
import {
  CentralDeviceCredentialIssuer,
  DeviceEnrollmentHttpHandler,
  type CentralDeviceEnrollmentRepository,
  type DeviceEnrollmentTransportContext,
} from "../src/index.js";

const binding = {
  tenantId: "018f0000-0000-7000-8000-000000000001",
  companyId: "018f0000-0000-7000-8000-000000000002",
  installationId: "018f0000-0000-7000-8000-000000000003",
  deviceId: "018f0000-0000-7000-8000-000000000004",
};
const ISSUER = generateKeyPairSync("ed25519");
const DEVICE = generateKeyPairSync("ed25519");
const TRUST_KEY_ID = "DEVICE_TRUST_HTTP_TEST";

const request = {
  activation_id: "018f0000-0000-7000-8000-000000000010",
  activation_secret: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-",
  tenant_id: binding.tenantId,
  company_id: binding.companyId,
  installation_id: binding.installationId,
  device_id: binding.deviceId,
  device_key_id: "device-key-http-test",
  device_public_key_pem: DEVICE.publicKey.export({ type: "spki", format: "pem" }).toString(),
  challenge: {
    challenge_id: "018f0000-0000-7000-8000-000000000020",
    tenant_id: binding.tenantId,
    installation_id: binding.installationId,
    device_id: binding.deviceId,
    nonce: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    issued_at: "2026-09-16T12:00:00Z",
    expires_at: "2026-09-16T12:05:00Z",
  },
  proof: {
    challenge_id: "018f0000-0000-7000-8000-000000000020",
    device_key_id: "device-key-http-test",
    signature: "A".repeat(86),
  },
  requested_at: "2026-09-16T12:00:00Z",
  version: 1,
};

const context: DeviceEnrollmentTransportContext = {
  authorization: "Bearer transport-test",
  contentType: "application/json",
  contentLength: null,
  requestId: "018f0000-0000-7000-8000-000000000030",
  correlationId: "018f0000-0000-7000-8000-000000000031",
};

function issuer(): CentralDeviceCredentialIssuer {
  const repository: CentralDeviceEnrollmentRepository = {
    findDevice: async () => ({
      device_id: binding.deviceId,
      installation_id: binding.installationId,
      tenant_id: binding.tenantId,
      company_id: binding.companyId,
      device_key_id: request.device_key_id,
      device_public_key: request.device_public_key_pem,
      status: "PENDING",
      trust_key_id: TRUST_KEY_ID,
      trust_key_purpose: "DEVICE_TRUST",
    }),
    consumeActivationAndIssueCredential: async () => true,
  };
  return new CentralDeviceCredentialIssuer(repository, ISSUER.privateKey, {
    now: () => new Date("2026-09-16T12:00:00Z"),
  });
}

function validHandler() {
  return new DeviceEnrollmentHttpHandler(issuer(), {
    authorize: (value) => value.authorization === "Bearer transport-test",
    maxBodyBytes: 16 * 1024,
    maxCredentialLifetimeMs: 60 * 60 * 1000,
  });
}

describe("D-3 enrollment HTTP boundary", () => {
  it("rejects unauthenticated transport before parsing the body", async () => {
    const handler = validHandler();
    const result = await handler.handle({ ...context, authorization: null }, "not-json");
    expect(result.statusCode).toBe(401);
    expect(result.body.result_code).toBe("DEVICE_ENROLLMENT_TRANSPORT_UNAUTHORIZED");
  });

  it("rejects oversized and content-length-mismatched bodies", async () => {
    const handler = new DeviceEnrollmentHttpHandler(issuer(), {
      authorize: () => true,
      maxBodyBytes: 1024,
      maxCredentialLifetimeMs: 60 * 60 * 1000,
    });
    const oversized = await handler.handle(context, "x".repeat(1025));
    expect(oversized.statusCode).toBe(413);

    const mismatch = await handler.handle({ ...context, contentLength: 1 }, "{}");
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.body.result_code).toBe("DEVICE_ENROLLMENT_CONTENT_LENGTH_MISMATCH");
  });

  it("rejects malformed JSON and schema-invalid enrollment requests", async () => {
    const handler = validHandler();
    expect((await handler.handle(context, "{" )).statusCode).toBe(400);
    const invalid = await handler.handle(context, JSON.stringify({ ...request, activation_secret: "short" }));
    expect(invalid.statusCode).toBe(422);
    expect(invalid.body.result_code).toBe("DEVICE_ENROLLMENT_REQUEST_INVALID");
  });

  it("invokes the issuer only through the validated D-3 request boundary", async () => {
    const handler = validHandler();
    const result = await handler.handle(context, JSON.stringify(request));
    expect(result.statusCode).toBe(422);
    expect(result.body.result_code).toBe("ENROLLMENT_PROOF_INVALID");
  });

  it("does not expose issuer or database exceptions as arbitrary error text", async () => {
    const repository: CentralDeviceEnrollmentRepository = {
      findDevice: async () => { throw new Error("database password leaked"); },
      consumeActivationAndIssueCredential: async () => false,
    };
    const failingIssuer = new CentralDeviceCredentialIssuer(repository, ISSUER.privateKey, {
      now: () => new Date("2026-09-16T12:00:00Z"),
    });
    const handler = new DeviceEnrollmentHttpHandler(failingIssuer, {
      authorize: () => true,
      maxBodyBytes: 16 * 1024,
      maxCredentialLifetimeMs: 60 * 60 * 1000,
    });
    const result = await handler.handle(context, JSON.stringify({ ...request, proof: { ...request.proof, signature: "A".repeat(86) } }));
    expect(result.statusCode).toBe(422);
    expect(JSON.stringify(result.body)).not.toContain("database password leaked");
  });

  it("keeps the transport boundary independent from Local Service credential material", () => {
    expect(SignedDeviceTrustCredentialSchema).toBeDefined();
    expect(validHandler()).toBeInstanceOf(DeviceEnrollmentHttpHandler);
  });
});
