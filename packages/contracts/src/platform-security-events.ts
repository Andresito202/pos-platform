import * as z from "zod";
import { UtcDateTimeSchema, UuidSchema, StableCodeSchema } from "./primitives.js";

/**
 * Versioned vocabulary for identity.security_events.
 *
 * This is a data contract only. It does not authenticate actors, persist events,
 * or authorize an operation. The central service must write security events
 * atomically with the relevant security transition where the use case requires it.
 */
export const PlatformSecurityEventCode = Object.freeze({
  LOGIN_SUCCEEDED: "PLATFORM_LOGIN_SUCCEEDED",
  LOGIN_FAILED: "PLATFORM_LOGIN_FAILED",
  CREDENTIAL_REJECTED: "PLATFORM_CREDENTIAL_REJECTED",
  MFA_REQUIRED: "PLATFORM_MFA_REQUIRED",
  MFA_REJECTED: "PLATFORM_MFA_REJECTED",
  MFA_ENROLLED: "PLATFORM_MFA_ENROLLED",
  WEBAUTHN_ASSERTION_VERIFIED: "PLATFORM_WEBAUTHN_ASSERTION_VERIFIED",
  MFA_REVOKED: "PLATFORM_MFA_REVOKED",
  REAUTHENTICATION_FAILED: "PLATFORM_REAUTHENTICATION_FAILED",
  REAUTHENTICATION_SUCCEEDED: "PLATFORM_REAUTHENTICATION_SUCCEEDED",
  SESSION_ISSUED: "PLATFORM_SESSION_ISSUED",
  SESSION_EXPIRED: "PLATFORM_SESSION_EXPIRED",
  SESSION_REVOKED: "PLATFORM_SESSION_REVOKED",
  BROWSER_SESSION_ISSUED: "PLATFORM_BROWSER_SESSION_ISSUED",
  BROWSER_SESSION_ROTATED: "PLATFORM_BROWSER_SESSION_ROTATED",
  AUTHORIZATION_CODE_ISSUED: "PLATFORM_AUTHORIZATION_CODE_ISSUED",
  AUTHORIZATION_CODE_REDEEMED: "PLATFORM_AUTHORIZATION_CODE_REDEEMED",
  AUTHORIZATION_CODE_REJECTED: "PLATFORM_AUTHORIZATION_CODE_REJECTED",
  AUTHORIZATION_SNAPSHOT_ISSUED: "PLATFORM_AUTHORIZATION_SNAPSHOT_ISSUED",
  ACCESS_ISSUED: "PLATFORM_ACCESS_ISSUED",
  REFRESH_ROTATED: "PLATFORM_REFRESH_ROTATED",
  REFRESH_REUSE_DETECTED: "PLATFORM_REFRESH_REUSE_DETECTED",
  RECOVERY_REQUESTED: "PLATFORM_RECOVERY_REQUESTED",
  RECOVERY_APPROVED: "PLATFORM_RECOVERY_APPROVED",
  RECOVERY_COMPLETED: "PLATFORM_RECOVERY_COMPLETED",
  RECOVERY_REJECTED: "PLATFORM_RECOVERY_REJECTED",
  ABUSE_RATE_LIMITED: "PLATFORM_ABUSE_RATE_LIMITED",
  ABUSE_LOCKED: "PLATFORM_ABUSE_LOCKED",
} as const);

export const PlatformSecurityEventCodeSchema = z.enum(
  Object.values(PlatformSecurityEventCode) as [
    (typeof PlatformSecurityEventCode)[keyof typeof PlatformSecurityEventCode],
    ...((typeof PlatformSecurityEventCode)[keyof typeof PlatformSecurityEventCode])[],
  ],
);

export const PlatformSecurityEventResultSchema = z.enum([
  "SUCCEEDED",
  "REJECTED",
  "CHALLENGE_REQUIRED",
  "EXPIRED",
  "REVOKED",
  "DETECTED",
  "THROTTLED",
  "LOCKED",
]);

/**
 * Minimal metadata for an identity security event.
 *
 * Strict shape intentionally rejects credentials, MFA secrets, bearer/refresh
 * tokens and other unreviewed payload fields. The caller supplies timestamps;
 * persistence must set server_recorded_at from the trusted server clock.
 */
export const PlatformSecurityEventSchema = z.strictObject({
  user_id: UuidSchema.nullable(),
  session_id: UuidSchema.nullable(),
  tenant_id: UuidSchema.nullable(),
  event_code: PlatformSecurityEventCodeSchema,
  result: PlatformSecurityEventResultSchema,
  reason_code: StableCodeSchema.nullable(),
  correlation_id: UuidSchema,
  occurred_at: UtcDateTimeSchema,
  server_recorded_at: UtcDateTimeSchema,
}).superRefine((event, context) => {
  if (Date.parse(event.server_recorded_at) < Date.parse(event.occurred_at)) {
    context.addIssue({
      code: "custom",
      path: ["server_recorded_at"],
      message: "server_recorded_at must not precede occurred_at",
    });
  }
  if (event.tenant_id !== null && event.session_id === null) {
    context.addIssue({
      code: "custom",
      path: ["session_id"],
      message: "tenant-scoped security events require a session_id",
    });
  }
});

export type PlatformSecurityEventCode =
  (typeof PlatformSecurityEventCode)[keyof typeof PlatformSecurityEventCode];
export const PlatformSecurityEventWriteSchema = z.strictObject({
  user_id: UuidSchema.nullable(),
  session_id: UuidSchema.nullable(),
  tenant_id: UuidSchema.nullable(),
  event_code: PlatformSecurityEventCodeSchema,
  result: PlatformSecurityEventResultSchema,
  reason_code: StableCodeSchema.nullable(),
  correlation_id: UuidSchema,
  occurred_at: UtcDateTimeSchema,
}).superRefine((event, context) => {
  if (event.tenant_id !== null && event.session_id === null) {
    context.addIssue({
      code: "custom",
      path: ["session_id"],
      message: "tenant-scoped security events require a session_id",
    });
  }
});

export type PlatformSecurityEventWrite = z.infer<typeof PlatformSecurityEventWriteSchema>;
export type PlatformSecurityEvent = z.infer<typeof PlatformSecurityEventSchema>;
