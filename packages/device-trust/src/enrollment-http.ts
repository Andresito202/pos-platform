import {
  DeviceEnrollmentRequestSchema,
  DeviceEnrollmentResultSchema,
  type DeviceEnrollmentResult,
} from "@pos-platform/contracts";
import { CentralDeviceCredentialIssuer } from "./enrollment.js";

export type DeviceEnrollmentTransportContext = {
  readonly authorization: string | null;
  readonly contentType: string | null;
  readonly contentLength: number | null;
  readonly requestId: string;
  readonly correlationId: string;
};

export type DeviceEnrollmentTransportResponse = {
  readonly statusCode: 200 | 400 | 401 | 403 | 409 | 413 | 422 | 500;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Record<string, unknown>;
};

export type DeviceEnrollmentTransportPolicy = {
  /** Transport authentication only; it is never treated as device identity. */
  authorize(context: DeviceEnrollmentTransportContext): boolean;
  /** Maximum serialized request body accepted by this boundary. */
  readonly maxBodyBytes: number;
  /** Maximum lifetime accepted for the issued credential. */
  readonly maxCredentialLifetimeMs: number;
};

function headers(context: DeviceEnrollmentTransportContext): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-pos-api-version": "1.0.0",
    "x-request-id": context.requestId,
    "x-correlation-id": context.correlationId,
  };
}

function response(
  context: DeviceEnrollmentTransportContext,
  statusCode: DeviceEnrollmentTransportResponse["statusCode"],
  body: Record<string, unknown>,
): DeviceEnrollmentTransportResponse {
  return { statusCode, headers: headers(context), body };
}

function rejection(
  context: DeviceEnrollmentTransportContext,
  statusCode: DeviceEnrollmentTransportResponse["statusCode"],
  code: string,
  retryable = false,
): DeviceEnrollmentTransportResponse {
  return response(context, statusCode, {
    protocol_version: "1.0.0",
    request_id: context.requestId,
    correlation_id: context.correlationId,
    status: "REJECTED",
    result_code: code,
    error: {
      code,
      retryable,
      user_message_key: "device_enrollment.rejected",
    },
    result: null,
  });
}

function errorCode(error: unknown): string {
  if (error instanceof Error && error.message.length <= 128 && /^[A-Z0-9_.-]+$/.test(error.message)) {
    return error.message;
  }
  return "DEVICE_ENROLLMENT_FAILED";
}

/**
 * Transport-neutral D-3 enrollment boundary.
 *
 * The future central-authority HTTP server owns TLS, socket limits and the
 * concrete transport authentication mechanism. This handler owns the protocol
 * boundary: size validation, transport authorization, strict request parsing,
 * credential lifetime policy, issuer invocation and strict response shaping.
 * It deliberately does not import Local Service and never treats a bearer token
 * as device identity; device identity is established by activation binding plus
 * the Ed25519 proof-of-possession verified by `CentralDeviceCredentialIssuer`.
 */
export class DeviceEnrollmentHttpHandler {
  constructor(
    private readonly issuer: CentralDeviceCredentialIssuer,
    private readonly policy: DeviceEnrollmentTransportPolicy,
  ) {
    if (!Number.isInteger(policy.maxBodyBytes) || policy.maxBodyBytes < 1024) {
      throw new Error("maxBodyBytes must be an integer >= 1024");
    }
    if (!Number.isSafeInteger(policy.maxCredentialLifetimeMs) || policy.maxCredentialLifetimeMs <= 0) {
      throw new Error("maxCredentialLifetimeMs must be a positive safe integer");
    }
  }

  async handle(
    context: DeviceEnrollmentTransportContext,
    rawBody: string,
  ): Promise<DeviceEnrollmentTransportResponse> {
    const serializedBytes = Buffer.byteLength(rawBody, "utf8");
    if (serializedBytes > this.policy.maxBodyBytes) {
      return rejection(context, 413, "DEVICE_ENROLLMENT_BODY_TOO_LARGE");
    }
    if (context.contentLength !== null && context.contentLength !== serializedBytes) {
      return rejection(context, 400, "DEVICE_ENROLLMENT_CONTENT_LENGTH_MISMATCH");
    }
    if (context.contentType !== "application/json") {
      return rejection(context, 400, "DEVICE_ENROLLMENT_CONTENT_TYPE_INVALID");
    }
    if (!this.policy.authorize(context)) {
      return rejection(context, 401, "DEVICE_ENROLLMENT_TRANSPORT_UNAUTHORIZED");
    }

    let input: unknown;
    try {
      input = JSON.parse(rawBody);
    } catch {
      return rejection(context, 400, "DEVICE_ENROLLMENT_INVALID_JSON");
    }

    const parsed = DeviceEnrollmentRequestSchema.safeParse(input);
    if (!parsed.success) {
      return rejection(context, 422, "DEVICE_ENROLLMENT_REQUEST_INVALID");
    }

    const issuedAt = Date.parse(parsed.data.challenge.issued_at);
    const expiresAt = Date.parse(parsed.data.challenge.expires_at);
    if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt) {
      return rejection(context, 422, "DEVICE_ENROLLMENT_CHALLENGE_TIME_INVALID");
    }

    const credentialExpiresAt = new Date(Date.now() + this.policy.maxCredentialLifetimeMs).toISOString();

    try {
      const result = await this.issuer.issue({
        request: parsed.data,
        challenge: parsed.data.challenge,
        expires_at: credentialExpiresAt,
      });
      const validated = DeviceEnrollmentResultSchema.parse(result) as DeviceEnrollmentResult;
      return response(context, 200, {
        protocol_version: "1.0.0",
        request_id: context.requestId,
        correlation_id: context.correlationId,
        status: "SUCCEEDED",
        result_code: "ENROLLED",
        result: validated,
      });
    } catch (error) {
      const code = errorCode(error);
      const statusCode: DeviceEnrollmentTransportResponse["statusCode"] =
        code === "ACTIVATION_NOT_CONSUMABLE" ? 409
          : code.startsWith("ENROLLMENT_") || code.startsWith("DEVICE_") || code === "CREDENTIAL_EXPIRY_INVALID" ? 422
          : 500;
      return rejection(context, statusCode, code, statusCode >= 500);
    }
  }
}
