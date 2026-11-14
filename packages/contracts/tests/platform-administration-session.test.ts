import { describe, expect, it } from "vitest";
import {
  assertPlatformAdministrationSessionUsable,
  CENTRAL_ADMINISTRATION_SESSION_POLICY,
  PLATFORM_ACCOUNT_IDENTITY_MODEL,
  PlatformAdministrationSessionSchema,
} from "../src/index.js";

const SESSION = "018f0000-0000-7000-8000-0000000000b0";
const ACCOUNT = "018f0000-0000-7000-8000-0000000000a1";

const VALID_SESSION = {
  session_id: SESSION,
  platform_account_id: ACCOUNT,
  actor_type: "PLATFORM_ACCOUNT" as const,
  tenant_id: null,
  tenant_membership_id: null,
  mfa_status: "SATISFIED" as const,
  last_reauthenticated_at: "2026-10-08T12:00:00Z",
  expires_at: "2026-10-08T13:00:00Z",
};

describe("PlatformAccount administration boundary", () => {
  it("maps PlatformAccount to the existing identity.users identity", () => {
    expect(PLATFORM_ACCOUNT_IDENTITY_MODEL.identityTable).toBe("identity.users");
    expect(PLATFORM_ACCOUNT_IDENTITY_MODEL.accountIdIsUserId).toBe(true);
    expect(PLATFORM_ACCOUNT_IDENTITY_MODEL.tenantMembershipRequired).toBe(false);
  });

  it("reuses the existing credential, MFA, session and security-event stores", () => {
    expect(PLATFORM_ACCOUNT_IDENTITY_MODEL.credentialTable).toBe("identity.user_credentials");
    expect(PLATFORM_ACCOUNT_IDENTITY_MODEL.mfaTable).toBe("identity.mfa_factors");
    expect(PLATFORM_ACCOUNT_IDENTITY_MODEL.sessionTable).toBe("identity.sessions");
    expect(PLATFORM_ACCOUNT_IDENTITY_MODEL.refreshTokenTable).toBe("identity.session_refresh_tokens");
    expect(PLATFORM_ACCOUNT_IDENTITY_MODEL.securityEventTable).toBe("identity.security_events");
  });

  it("accepts a global platform session with satisfied MFA and reauthentication", () => {
    expect(PlatformAdministrationSessionSchema.parse(VALID_SESSION)).toEqual(VALID_SESSION);
  });

  it("requires a global session: tenant and membership context are structurally null", () => {
    expect(() => PlatformAdministrationSessionSchema.parse({
      ...VALID_SESSION,
      tenant_id: ACCOUNT,
    })).toThrow();

    expect(() => PlatformAdministrationSessionSchema.parse({
      ...VALID_SESSION,
      tenant_membership_id: ACCOUNT,
    })).toThrow();
  });

  it("requires MFA to be satisfied", () => {
    expect(() => PlatformAdministrationSessionSchema.parse({
      ...VALID_SESSION,
      mfa_status: "PENDING",
    })).toThrow();
  });

  it("requires a real reauthentication timestamp", () => {
    expect(() => PlatformAdministrationSessionSchema.parse({
      ...VALID_SESSION,
      last_reauthenticated_at: null,
    })).toThrow();
  });

  it("requires expiry to be strictly later than the reauthentication timestamp", () => {
    expect(() => PlatformAdministrationSessionSchema.parse({
      ...VALID_SESSION,
      expires_at: "2026-10-08T11:59:59Z",
    })).toThrow();

    expect(() => PlatformAdministrationSessionSchema.parse({
      ...VALID_SESSION,
      expires_at: VALID_SESSION.last_reauthenticated_at,
    })).toThrow();
  });

  it("does not carry roles, permissions or entitlements", () => {
    expect(() => PlatformAdministrationSessionSchema.parse({
      ...VALID_SESSION,
      permissions: [],
    })).toThrow();

    expect(() => PlatformAdministrationSessionSchema.parse({
      ...VALID_SESSION,
      roles: [],
    })).toThrow();

    expect(() => PlatformAdministrationSessionSchema.parse({
      ...VALID_SESSION,
      entitlements: [],
    })).toThrow();
  });

  it("rejects an expired platform session at runtime", () => {
    expect(() => assertPlatformAdministrationSessionUsable(
      VALID_SESSION,
      new Date("2026-10-08T13:00:00.000Z"),
      15 * 60 * 1000,
    )).toThrow("PLATFORM_ADMINISTRATION_SESSION_EXPIRED");
  });

  it("rejects reauthentication older than the caller-approved maximum", () => {
    expect(() => assertPlatformAdministrationSessionUsable(
      VALID_SESSION,
      new Date("2026-10-08T12:16:00.000Z"),
      15 * 60 * 1000,
    )).toThrow("PLATFORM_ADMINISTRATION_REAUTHENTICATION_STALE");
  });

  it("rejects a reauthentication timestamp in the future", () => {
    expect(() => assertPlatformAdministrationSessionUsable(
      VALID_SESSION,
      new Date("2026-10-08T11:59:59.000Z"),
      15 * 60 * 1000,
    )).toThrow("PLATFORM_ADMINISTRATION_REAUTHENTICATION_IN_FUTURE");
  });

  it("accepts a live session when reauthentication is within the supplied limit", () => {
    expect(assertPlatformAdministrationSessionUsable(
      VALID_SESSION,
      new Date("2026-10-08T12:15:00.000Z"),
      15 * 60 * 1000,
    )).toEqual(VALID_SESSION);
  });

  it("rejects invalid clocks and invalid reauthentication limits", () => {
    expect(() => assertPlatformAdministrationSessionUsable(
      VALID_SESSION,
      new Date(Number.NaN),
      15 * 60 * 1000,
    )).toThrow("PLATFORM_ADMINISTRATION_INVALID_CLOCK");

    expect(() => assertPlatformAdministrationSessionUsable(
      VALID_SESSION,
      new Date("2026-10-08T12:00:00.000Z"),
      0,
    )).toThrow("PLATFORM_ADMINISTRATION_INVALID_REAUTHENTICATION_POLICY");
  });

  it("makes the privileged session policy explicit and fail-closed", () => {
    expect(CENTRAL_ADMINISTRATION_SESSION_POLICY).toEqual({
      actorType: "PLATFORM_ACCOUNT",
      mfaRequired: true,
      reauthenticationRequired: true,
      tenantMembershipRequired: false,
      localClientMayInvokeDirectly: false,
      authorizationSource: "CENTRAL_ADMINISTRATION_OPERATION",
    });
  });
});
