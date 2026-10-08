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
