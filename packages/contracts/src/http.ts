import * as z from "zod";
import { createRequestEnvelopeSchema, createResponseEnvelopeSchema } from "./envelope.js";
import { type ContractError, type ErrorCategory } from "./errors.js";
import {
  ContractVersionSchema,
  IdempotencyKeySchema,
  StableCodeSchema,
  UtcDateTimeSchema,
  UuidSchema,
} from "./primitives.js";

const HEADER_VALUE_PATTERN = /^[^\r\n]+$/;
const CURSOR_PATTERN = /^[^\u0000-\u001f\u007f]+$/;
const RETRY_AFTER_SECONDS_PATTERN = /^(0|[1-9]\d*)$/;

export const OpaqueAuthorizationHeaderSchema = z.string().min(1).max(4096).regex(HEADER_VALUE_PATTERN);
export const RetryAfterSecondsHeaderSchema = z.string().max(10).regex(RETRY_AFTER_SECONDS_PATTERN);

export const CentralHttpRequestHeadersSchema = z.strictObject({
  authorization: OpaqueAuthorizationHeaderSchema,
  "content-type": z.literal("application/json"),
  accept: z.literal("application/json"),
  "x-pos-api-version": ContractVersionSchema,
  "x-request-id": UuidSchema,
  "x-correlation-id": UuidSchema,
  "x-pos-device-id": UuidSchema,
  "x-pos-installation-id": UuidSchema,
  "idempotency-key": IdempotencyKeySchema.optional(),
});

export const CentralHttpResponseHeadersSchema = z.strictObject({
  "content-type": z.literal("application/json"),
  "x-pos-api-version": ContractVersionSchema,
  "x-request-id": UuidSchema,
  "x-correlation-id": UuidSchema,
  "retry-after": RetryAfterSecondsHeaderSchema.optional(),
});

export const VerifiedDevicePrincipalSchema = z.strictObject({
  tenant_id: UuidSchema,
  device_id: UuidSchema,
  installation_id: UuidSchema,
  authentication_method: StableCodeSchema,
});

export const RateLimitScopeSchema = z.enum(["TENANT", "DEVICE", "ACTOR", "INTEGRATION"]);

export const HttpRateLimitStateSchema = z.strictObject({
  policy_id: StableCodeSchema,
  scope: RateLimitScopeSchema,
  limit: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  remaining: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  reset_at: UtcDateTimeSchema,
}).superRefine((state, context) => {
  if (state.remaining > state.limit) {
    context.addIssue({
      code: "custom",
      path: ["remaining"],
      message: "remaining quota cannot exceed limit",
    });
  }
});

export const HTTP_STATUS_BY_ERROR_CATEGORY = {
  VALIDATION: 400,
  AUTHENTICATION: 401,
  AUTHORIZATION: 403,
  CONFLICT: 409,
  NOT_FOUND: 404,
  DEPENDENCY_UNAVAILABLE: 503,
  RATE_LIMITED: 429,
  INCOMPATIBLE_VERSION: 409,
  INTEGRITY: 422,
  UNKNOWN_OUTCOME: null,
  INTERNAL: 500,
} as const satisfies Record<ErrorCategory, number | null>;

export function httpStatusForErrorCategory(category: ErrorCategory): number | null {
  return HTTP_STATUS_BY_ERROR_CATEGORY[category];
}

function byteCountSchema(maxBytes: number) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new RangeError("maxBytes must be a positive safe integer");
  }
  return z.number().int().nonnegative().max(maxBytes);
}

type CentralHttpRequestOptions = Readonly<{
  maxBodyBytes: number;
  requireIdempotency: boolean;
}>;

export function createCentralDeviceHttpRequestSchema<T extends z.ZodType>(
  payloadSchema: T,
  options: CentralHttpRequestOptions,
) {
  const bodySchema = createRequestEnvelopeSchema(payloadSchema);
  return z.strictObject({
    headers: CentralHttpRequestHeadersSchema,
    received_body_bytes: byteCountSchema(options.maxBodyBytes),
    body: bodySchema,
  }).superRefine((request, context) => {
    const { headers, body } = request;
    const matches: ReadonlyArray<readonly [unknown, unknown, string]> = [
      [headers["x-request-id"], body.request_id, "x-request-id"],
      [headers["x-correlation-id"], body.correlation_id, "x-correlation-id"],
      [headers["x-pos-api-version"], body.protocol_version, "x-pos-api-version"],
      [headers["x-pos-device-id"], body.device_id, "x-pos-device-id"],
      [headers["idempotency-key"], body.idempotency_key, "idempotency-key"],
    ];
    for (const [headerValue, bodyValue, headerName] of matches) {
      if (headerValue !== bodyValue) {
        context.addIssue({
          code: "custom",
          path: ["headers", headerName],
          message: `${headerName} must match the request envelope`,
        });
      }
    }
    if (body.tenant_id === undefined) {
      context.addIssue({ code: "custom", path: ["body", "tenant_id"], message: "central device requests require tenant_id" });
    }
    if (body.device_id === undefined) {
      context.addIssue({ code: "custom", path: ["body", "device_id"], message: "central device requests require device_id" });
    }
    if (options.requireIdempotency && (body.operation_id === undefined || body.idempotency_key === undefined)) {
      context.addIssue({
        code: "custom",
        path: ["body", "idempotency_key"],
        message: "this central request requires operation_id and idempotency_key",
      });
    }
  });
}

export function validateCentralDevicePrincipal(
  requestInput: unknown,
  principalInput: unknown,
  payloadSchema: z.ZodType,
  options: CentralHttpRequestOptions,
): boolean {
  const request = createCentralDeviceHttpRequestSchema(payloadSchema, options).parse(requestInput);
  const principal = VerifiedDevicePrincipalSchema.parse(principalInput);
  return request.body.tenant_id === principal.tenant_id
    && request.body.device_id === principal.device_id
    && request.headers["x-pos-device-id"] === principal.device_id
    && request.headers["x-pos-installation-id"] === principal.installation_id;
}

type CentralHttpResponseOptions = Readonly<{
  maxBodyBytes: number;
}>;

export function createCentralHttpResponseSchema<T extends z.ZodType>(
  resultSchema: T,
  options: CentralHttpResponseOptions,
) {
  const bodySchema = createResponseEnvelopeSchema(resultSchema);
  return z.strictObject({
    status_code: z.number().int().min(200).max(599),
    headers: CentralHttpResponseHeadersSchema,
    serialized_body_bytes: byteCountSchema(options.maxBodyBytes),
    rate_limit: HttpRateLimitStateSchema.nullable(),
    body: bodySchema,
  }).superRefine((response, context) => {
    const { body, headers, status_code: statusCode } = response;

    if (headers["x-request-id"] !== body.request_id) {
      context.addIssue({ code: "custom", path: ["headers", "x-request-id"], message: "response request id must match the envelope" });
    }
    if (headers["x-correlation-id"] !== body.correlation_id) {
      context.addIssue({ code: "custom", path: ["headers", "x-correlation-id"], message: "response correlation id must match the envelope" });
    }
    if (headers["x-pos-api-version"] !== body.protocol_version) {
      context.addIssue({ code: "custom", path: ["headers", "x-pos-api-version"], message: "response API version must match the envelope" });
    }

    if (body.status === "SUCCEEDED" && ![200, 201].includes(statusCode)) {
      context.addIssue({ code: "custom", path: ["status_code"], message: "SUCCEEDED responses require HTTP 200 or 201" });
    }
    if (body.status === "PENDING" && statusCode !== 202) {
      context.addIssue({ code: "custom", path: ["status_code"], message: "PENDING responses require HTTP 202" });
    }
    if (body.status === "UNKNOWN") {
      if (![200, 202].includes(statusCode)) {
        context.addIssue({ code: "custom", path: ["status_code"], message: "UNKNOWN is an application outcome and uses HTTP 200 or 202" });
      }
    }
    if (body.status === "REJECTED" && body.error !== null) {
      const expectedStatus = httpStatusForErrorCategory(body.error.category);
      if (expectedStatus === null || statusCode !== expectedStatus) {
        context.addIssue({
          code: "custom",
          path: ["status_code"],
          message: `HTTP status does not match error category ${body.error.category}`,
        });
      }
    }

    if (statusCode === 429) {
      if (body.error?.category !== "RATE_LIMITED") {
        context.addIssue({ code: "custom", path: ["body", "error"], message: "HTTP 429 requires RATE_LIMITED error" });
      }
      if (headers["retry-after"] === undefined) {
        context.addIssue({ code: "custom", path: ["headers", "retry-after"], message: "HTTP 429 requires Retry-After seconds" });
      }
      if (response.rate_limit !== null && response.rate_limit.remaining !== 0) {
        context.addIssue({ code: "custom", path: ["rate_limit", "remaining"], message: "HTTP 429 requires zero remaining quota when rate_limit is present" });
      }
    } else if (headers["retry-after"] !== undefined) {
      context.addIssue({ code: "custom", path: ["headers", "retry-after"], message: "Retry-After is reserved for HTTP 429 in this contract" });
    }

    if (body.error?.category === "RATE_LIMITED" && body.error.retry_after_ms !== undefined && headers["retry-after"] !== undefined) {
      const expectedSeconds = Math.ceil(body.error.retry_after_ms / 1000);
      if (Number(headers["retry-after"]) !== expectedSeconds) {
        context.addIssue({
          code: "custom",
          path: ["headers", "retry-after"],
          message: "Retry-After must equal ceil(retry_after_ms / 1000)",
        });
      }
    }
  });
}

function cursorSchema(maxCursorChars: number) {
  if (!Number.isSafeInteger(maxCursorChars) || maxCursorChars < 1) {
    throw new RangeError("maxCursorChars must be a positive safe integer");
  }
  return z.string().min(1).max(maxCursorChars).regex(CURSOR_PATTERN);
}

export function createCursorPaginationRequestSchema(maxPageSize: number, maxCursorChars: number) {
  if (!Number.isSafeInteger(maxPageSize) || maxPageSize < 1) {
    throw new RangeError("maxPageSize must be a positive safe integer");
  }
  return z.strictObject({
    cursor: cursorSchema(maxCursorChars).nullable(),
    page_size: z.number().int().positive().max(maxPageSize),
  });
}

export function createCursorPageSchema<T extends z.ZodType>(itemSchema: T, maxCursorChars: number) {
  return z.strictObject({
    items: z.array(itemSchema),
    next_cursor: cursorSchema(maxCursorChars).nullable(),
    has_more: z.boolean(),
  }).superRefine((page, context) => {
    if (page.has_more !== (page.next_cursor !== null)) {
      context.addIssue({
        code: "custom",
        path: ["next_cursor"],
        message: "has_more and next_cursor must agree",
      });
    }
  });
}

export function expectedRetryAfterSeconds(errorInput: ContractError): string | null {
  if (errorInput.category !== "RATE_LIMITED" || errorInput.retry_after_ms === undefined) return null;
  return String(Math.ceil(errorInput.retry_after_ms / 1000));
}
