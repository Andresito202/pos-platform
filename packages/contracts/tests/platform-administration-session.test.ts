import { describe, expect, it } from "vitest";
import {
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
