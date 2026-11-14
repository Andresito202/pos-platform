import { createHash, randomBytes, sign, verify, type KeyObject } from "node:crypto";

/** Request-bound Ed25519 proof; the raw body bytes, path and request id are signed. */
export interface DeviceRequestProofInput {
  readonly method: "POST";
  readonly path: string;
  readonly requestId: string;
  readonly correlationId: string;
  readonly timestamp: string;
  readonly nonce: string;
  readonly credentialId: string;
  readonly body: string;
}

export interface ParsedDeviceRequestAuthorization {
  readonly credentialId: string;
  readonly timestamp: string;
  readonly nonce: string;
  readonly signature: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NONCE = /^[A-Za-z0-9_-]{43}$/;
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/;
const MAX_SKEW_MS = 120_000;

export function deviceRequestProofBytes(input: DeviceRequestProofInput): Buffer {
  if (input.method !== "POST" || !input.path.startsWith("/") || input.path.startsWith("//")) {
    throw new Error("DEVICE_PROOF_REQUEST_TARGET_INVALID");
  }
  if (!UUID.test(input.requestId) || !UUID.test(input.correlationId) || !UUID.test(input.credentialId)) {
    throw new Error("DEVICE_PROOF_IDENTIFIER_INVALID");
  }
  if (!Number.isFinite(Date.parse(input.timestamp)) || !NONCE.test(input.nonce)) {
    throw new Error("DEVICE_PROOF_FRESHNESS_FIELDS_INVALID");
  }
  const bodyHash = createHash("sha256").update(input.body, "utf8").digest("hex");
  return Buffer.from([
    "POS-DEVICE-REQUEST-V1",
    input.method,
    input.path,
    input.requestId,
    input.correlationId,
    input.timestamp,
    input.nonce,
    input.credentialId,
    bodyHash,
  ].join("\n"), "utf8");
}

export function createDeviceRequestAuthorization(
  input: Omit<DeviceRequestProofInput, "timestamp" | "nonce">,
  privateKey: KeyObject,
  now = new Date(),
): string {
  const timestamp = now.toISOString();
  const nonce = randomBytes(32).toString("base64url");
  const proof = { ...input, timestamp, nonce };
  const signature = sign(null, deviceRequestProofBytes(proof), privateKey).toString("base64url");
  return `DeviceProof ${proof.credentialId}.${timestamp}.${nonce}.${signature}`;
}

export function parseDeviceRequestAuthorization(value: string): ParsedDeviceRequestAuthorization | null {
  const match = /^DeviceProof ([0-9a-f-]{36})\.([0-9T:.Z-]{20,30})\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{86})$/i.exec(value);
  if (!match) return null;
  const [, credentialId, timestamp, nonce, signature] = match;
  if (!credentialId || !timestamp || !nonce || !signature || !UUID.test(credentialId)
    || !Number.isFinite(Date.parse(timestamp)) || !NONCE.test(nonce) || !SIGNATURE.test(signature)) return null;
  return { credentialId, timestamp, nonce, signature };
}

export function verifyDeviceRequestAuthorization(
  authorization: string,
  input: Omit<DeviceRequestProofInput, "timestamp" | "nonce" | "credentialId">,
  publicKey: KeyObject,
  now = new Date(),
): ParsedDeviceRequestAuthorization | null {
  const parsed = parseDeviceRequestAuthorization(authorization);
  if (!parsed) return null;
  const age = now.getTime() - Date.parse(parsed.timestamp);
  if (!Number.isFinite(age) || Math.abs(age) > MAX_SKEW_MS) return null;
  try {
    const proof: DeviceRequestProofInput = { ...input, ...parsed };
    if (!verify(null, deviceRequestProofBytes(proof), publicKey, Buffer.from(parsed.signature, "base64url"))) return null;
    return parsed;
  } catch {
    return null;
  }
}
