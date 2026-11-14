import { describe, expect, it } from "vitest";
import {
  PlatformSecurityEventCode,
  PlatformSecurityEventSchema,
} from "../src/index.js";

const EVENT = {
  user_id: "018f0000-0000-7000-8000-0000000000a1",
  session_id: "018f0000-0000-7000-8000-0000000000b0",
  tenant_id: null,
  event_code: PlatformSecurityEventCode.LOGIN_FAILED,
  result: "REJECTED" as const,
  reason_code: "INVALID_CREDENTIAL" as const,
  correlation_id: "018f0000-0000-7000-8000-0000000000c2",
  occurred_at: "2026-10-08T12:00:00Z",
  server_recorded_at: "2026-10-08T12:00:01Z",
};

describe("Platform identity security event contract", () => {
  it("defines stable event codes for the ratified D-3 lifecycle", () => {
    expect(Object.values(PlatformSecurityEventCode)).toEqual(expect.arrayContaining([
      "PLATFORM_LOGIN_SUCCEEDED",
      "PLATFORM_LOGIN_FAILED",
      "PLATFORM_CREDENTIAL_REJECTED",
      "PLATFORM_MFA_REQUIRED",
      "PLATFORM_MFA_REJECTED",
      "PLATFORM_MFA_ENROLLED",
      "PLATFORM_MFA_REVOKED",
      "PLATFORM_REAUTHENTICATION_FAILED",
      "PLATFORM_REAUTHENTICATION_SUCCEEDED",
      "PLATFORM_SESSION_ISSUED",
      "PLATFORM_SESSION_EXPIRED",
      "PLATFORM_SESSION_REVOKED",
      "PLATFORM_REFRESH_ROTATED",
      "PLATFORM_REFRESH_REUSE_DETECTED",
      "PLATFORM_RECOVERY_REQUESTED",
      "PLATFORM_RECOVERY_COMPLETED",
      "PLATFORM_RECOVERY_REJECTED",
      "PLATFORM_ABUSE_RATE_LIMITED",
      "PLATFORM_ABUSE_LOCKED",
    ]));
  });

  it("accepts minimal security-event metadata", () => {
    expect(PlatformSecurityEventSchema.parse(EVENT)).toEqual(EVENT);
  });

  it("rejects a server-recorded timestamp before the event timestamp", () => {
    expect(() => PlatformSecurityEventSchema.parse({
      ...EVENT,
      server_recorded_at: "2026-10-08T11:59:59Z",
    })).toThrow();
  });

  it("requires session context when a security event is tenant-scoped", () => {
    expect(() => PlatformSecurityEventSchema.parse({
      ...EVENT,
      tenant_id: "018f0000-0000-7000-8000-0000000000d3",
      session_id: null,
    })).toThrow();
  });

  it("rejects credentials and tokens rather than allowing them into event metadata", () => {
    expect(() => PlatformSecurityEventSchema.parse({
      ...EVENT,
      password: "must-not-be-logged",
    })).toThrow();

    expect(() => PlatformSecurityEventSchema.parse({
      ...EVENT,
      refresh_token: "must-not-be-logged",
    })).toThrow();

    expect(() => PlatformSecurityEventSchema.parse({
      ...EVENT,
      mfa_secret: "must-not-be-logged",
    })).toThrow();
  });
});
