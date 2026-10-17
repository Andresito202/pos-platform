import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createDeviceRequestAuthorization,
  deviceRequestProofBytes,
  parseDeviceRequestAuthorization,
  verifyDeviceRequestAuthorization,
} from "../src/request-proof.js";

const pair = generateKeyPairSync("ed25519");
const request = {
  method: "POST" as const,
  path: "/v1/sync/batches",
  requestId: "11111111-1111-4111-8111-111111111111",
  correlationId: "22222222-2222-4222-8222-222222222222",
  credentialId: "33333333-3333-4333-8333-333333333333",
  body: '{"amount":12}',
};
const now = new Date("2026-10-16T12:00:00.000Z");

describe("device request proof", () => {
  it("signs and verifies the exact HTTP request", () => {
    const authorization = createDeviceRequestAuthorization(request, pair.privateKey, now);
    expect(verifyDeviceRequestAuthorization(authorization, {
      method: request.method, path: request.path, requestId: request.requestId,
      correlationId: request.correlationId, body: request.body,
    }, createPublicKey(pair.publicKey), now)).toMatchObject({
      credentialId: request.credentialId, timestamp: now.toISOString(),
    });
  });

  it("rejects a body or route changed after signing", () => {
    const authorization = createDeviceRequestAuthorization(request, pair.privateKey, now);
    const common = {
      method: request.method, requestId: request.requestId,
      correlationId: request.correlationId, body: request.body,
    };
    expect(verifyDeviceRequestAuthorization(authorization, { ...common, path: "/v1/other" }, pair.publicKey, now)).toBeNull();
    expect(verifyDeviceRequestAuthorization(authorization, { ...common, path: request.path, body: '{"amount":13}' }, pair.publicKey, now)).toBeNull();
  });

  it("rejects stale proof and malformed authorization", () => {
    const authorization = createDeviceRequestAuthorization(request, pair.privateKey, now);
    expect(verifyDeviceRequestAuthorization(authorization, {
      method: request.method, path: request.path, requestId: request.requestId,
      correlationId: request.correlationId, body: request.body,
    }, pair.publicKey, new Date(now.getTime() + 120_001))).toBeNull();
    expect(parseDeviceRequestAuthorization("Bearer static-token")).toBeNull();
  });

  it("binds nonce, request id, correlation id and credential id into the signature", () => {
    const authorization = createDeviceRequestAuthorization(request, pair.privateKey, now);
    const parsed = parseDeviceRequestAuthorization(authorization);
    expect(parsed).not.toBeNull();
    const original = deviceRequestProofBytes({ ...request, timestamp: parsed!.timestamp, nonce: parsed!.nonce });
    const changed = deviceRequestProofBytes({ ...request, requestId: "44444444-4444-4444-8444-444444444444", timestamp: parsed!.timestamp, nonce: parsed!.nonce });
    expect(original.equals(changed)).toBe(false);
  });
});
