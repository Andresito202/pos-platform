import type { TenantScope, UserRoleAssignment } from "@pos-platform/domain";

/**
 * No SQLite/PostgreSQL adapter implements this — same DDL NO-GO gate as
 * every other repository in this project, plus there is no login/session
 * flow (UC-AUTH-001) that would ever populate real assignments. This port
 * exists so RoleBasedCashAuthorization is a real, testable rule engine
 * today, ready to receive a real adapter once both gates lift.
 */
export interface UserRoleAssignmentRepository {
  listActiveAssignments(userId: string, scope: TenantScope): Promise<readonly UserRoleAssignment[]>;
}
