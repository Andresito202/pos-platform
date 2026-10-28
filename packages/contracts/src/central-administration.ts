import * as z from "zod";
import { UtcDateTimeSchema, UuidSchema } from "./primitives.js";

/**
 * Central administration contract.
 *
 * This is a shared vocabulary for the Central Authority control plane.
 * It is deliberately NOT an HTTP API and it does not grant permissions.
 *
 * Authority rules:
 * - platform administration is performed by a trusted PLATFORM_ACCOUNT actor;
 * - tenant users/roles/grants remain separate from platform authority;
 * - License is the contractual authority for plan/effective entitlements;
 * - a "plan" is therefore a license reference/contract input here, not a
 *   client-editable Plan aggregate;
 * - no operation in this contract permits a local client to mutate central
 *   authorization or licensing state.
 */
export const CentralAdministrationOperation = Object.freeze({
  TENANT_INITIALIZE: "TENANT_INITIALIZE",
  USER_MANAGE: "USER_MANAGE",
  ROLE_MANAGE: "ROLE_MANAGE",
  ROLE_PERMISSION_GRANT_MANAGE: "ROLE_PERMISSION_GRANT_MANAGE",
  LICENSE_ISSUE: "LICENSE_ISSUE",
  LICENSE_RENEW: "LICENSE_RENEW",
  LICENSE_SUSPEND: "LICENSE_SUSPEND",
  LICENSE_REACTIVATE: "LICENSE_REACTIVATE",
  LICENSE_RESTRICT: "LICENSE_RESTRICT",
  LICENSE_REVOKE: "LICENSE_REVOKE",
  LICENSE_TERMINATE: "LICENSE_TERMINATE",
  LICENSE_CHANGE_PLAN: "LICENSE_CHANGE_PLAN",
  LICENSE_GRANT_GRACE: "LICENSE_GRANT_GRACE",
} as const);

export type CentralAdministrationOperation =
  (typeof CentralAdministrationOperation)[keyof typeof CentralAdministrationOperation];

export const CENTRAL_ADMINISTRATION_ACTOR_TYPE = "PLATFORM_ACCOUNT" as const;

export const CENTRAL_ADMINISTRATION_AUTHORITY = Object.freeze({
  actorType: CENTRAL_ADMINISTRATION_ACTOR_TYPE,
  tenantAuthority: "CENTRAL",
  authorizationAuthority: "CENTRAL",
  licensingAuthority: "CENTRAL",
  planAuthority: "LICENSE_CONTRACT",
  entitlementAuthority: "LICENSE",
  clientMayMutate: false,
  localMayIssueLicense: false,
  localMayChangePlan: false,
  localMayGrantEntitlement: false,
} as const);

/**
 * D-3 boundary: PlatformAccount is the administrative representation of an
 * existing identity.users row. The account does not receive a second
 * credential, MFA store, session store or tenant membership.
 *
 * identity.users.status remains the account lifecycle source of truth;
 * identity.user_credentials and identity.mfa_factors remain the credential
 * and MFA sources of truth.
 */
export const PLATFORM_ACCOUNT_IDENTITY_MODEL = Object.freeze({
  identityTable: "identity.users",
  credentialTable: "identity.user_credentials",
  mfaTable: "identity.mfa_factors",
  sessionTable: "identity.sessions",
  refreshTokenTable: "identity.session_refresh_tokens",
  securityEventTable: "identity.security_events",
  accountIdIsUserId: true,
  tenantMembershipRequired: false,
  tenantContextRequired: false,
} as const);

/**
 * Authenticated administrative session context.
 *
 * This is a central identity/session assertion, not a bearer token and not an
 * authorization snapshot. Permissions, roles and entitlements are deliberately
 * absent. The service resolves D-1 operations from the central authority.
 */
export const PlatformAdministrationSessionSchema = z.strictObject({
  session_id: UuidSchema,
  platform_account_id: UuidSchema,
  actor_type: z.literal("PLATFORM_ACCOUNT"),
  tenant_id: z.null(),
  tenant_membership_id: z.null(),
  mfa_status: z.literal("SATISFIED"),
  last_reauthenticated_at: UtcDateTimeSchema,
  expires_at: UtcDateTimeSchema,
}).superRefine((session, context) => {
  if (Date.parse(session.expires_at) <= Date.parse(session.last_reauthenticated_at)) {
    context.addIssue({
      code: "custom",
      path: ["expires_at"],
      message: "expires_at must be later than last_reauthenticated_at",
    });
  }
});

export type PlatformAdministrationSession =
  z.infer<typeof PlatformAdministrationSessionSchema>;

const positiveLimit=z.number().int().positive().max(2_147_483_647);
/** Approved 2026-10-27 extension: server-managed GLOBAL HTTPS policy, not a
 * session, permission assertion, secret or browser-supplied approval. */
export const GlobalAdministrationProvisionSchema=z.strictObject({
  profile:z.literal("CAMACHO_GLOBAL_ADMINISTRATION_V1"),policy_reference:z.string().min(1).max(256),
  expected_database:z.string().min(1).max(63),rp_id:z.string().min(1).max(253),rejection_verifier_file:z.string().min(1).max(4096),
  migration_checksum:z.string().regex(/^[a-f0-9]{64}$/),
  renderer:z.strictObject({directory:z.string().min(1).max(4096),maximum_asset_bytes:positiveLimit}).optional(),
  fulfillment_policies:z.array(z.strictObject({policy_reference:z.string().min(1).max(256),tax_policy_reference:z.string().min(1).max(256),
    support_policy_reference:z.string().min(1).max(256)})).min(1).max(64).optional(),
  limits:z.strictObject({challenge_ms:positiveLimit,session_ms:positiveLimit,mfa_age_ms:positiveLimit,reauthentication_ms:positiveLimit,
    browser_ms:positiveLimit,idle_ms:positiveLimit,sql_lock_ms:positiveLimit,sql_statement_ms:positiveLimit,maximum_body_bytes:positiveLimit,
    maximum_pending_flows:positiveLimit,request_window_ms:positiveLimit,requests_per_window:positiveLimit,maximum_buckets:positiveLimit,
    login_window_ms:positiveLimit,maximum_login_per_address:positiveLimit,maximum_login_per_account:positiveLimit}),
}).refine(p=>p.limits.sql_statement_ms>p.limits.sql_lock_ms,"statement timeout must exceed lock timeout");

/**
 * Every D-1 administrative operation requires a fully authenticated platform
 * session. No tenant membership is substituted for platform authority.
 */
export const CENTRAL_ADMINISTRATION_SESSION_POLICY = Object.freeze({
  actorType: "PLATFORM_ACCOUNT",
  mfaRequired: true,
  reauthenticationRequired: true,
  tenantMembershipRequired: false,
  localClientMayInvokeDirectly: false,
  authorizationSource: "CENTRAL_ADMINISTRATION_OPERATION",
} as const);


/**
 * Runtime guard for a platform-administration session.
 *
 * Schema validation alone cannot establish freshness against the current clock.
 * The caller must supply the approved maximum reauthentication age; this
 * function deliberately does not invent a global timeout or authorize an
 * operation. The caller must still resolve the requested D-1 operation.
 */
export function assertPlatformAdministrationSessionUsable(
  input: unknown,
  now: Date,
  maxReauthenticationAgeMs: number,
): PlatformAdministrationSession {
  const session = PlatformAdministrationSessionSchema.parse(input);
  const nowMs = now.getTime();

  if (!Number.isFinite(nowMs)) {
    throw new Error("PLATFORM_ADMINISTRATION_INVALID_CLOCK");
  }
  if (!Number.isSafeInteger(maxReauthenticationAgeMs) || maxReauthenticationAgeMs <= 0) {
    throw new Error("PLATFORM_ADMINISTRATION_INVALID_REAUTHENTICATION_POLICY");
  }

  const expiresAt = Date.parse(session.expires_at);
  const reauthenticatedAt = Date.parse(session.last_reauthenticated_at);

  if (expiresAt <= nowMs) {
    throw new Error("PLATFORM_ADMINISTRATION_SESSION_EXPIRED");
  }
  if (reauthenticatedAt > nowMs) {
    throw new Error("PLATFORM_ADMINISTRATION_REAUTHENTICATION_IN_FUTURE");
  }
  if (nowMs - reauthenticatedAt > maxReauthenticationAgeMs) {
    throw new Error("PLATFORM_ADMINISTRATION_REAUTHENTICATION_STALE");
  }

  return session;
}
