import type { CompanyScope, TenantScope, UserRoleAssignment } from "@pos-platform/domain";

/**
 * No SQLite/PostgreSQL adapter implements this — same DDL NO-GO gate as
 * every other repository in this project, plus there is no login/session
 * flow (UC-AUTH-001) that would ever populate real assignments. This port
 * exists so the RoleBased*Authorization classes are real, testable rule
 * engines today, ready to receive a real adapter once both gates lift.
 *
 * Two lookup methods, not one generic one: Cash is branch-scoped
 * (TenantScope), Catalog is company-scoped (CompanyScope) — a single
 * method accepting "either" would blur a real domain distinction
 * (tenant-model.md's "compartido por empresa" vs "separado por sucursal")
 * behind a fake common shape.
 */
export interface UserRoleAssignmentRepository {
  listActiveAssignments(userId: string, scope: TenantScope): Promise<readonly UserRoleAssignment[]>;
  listActiveAssignmentsForCompany(userId: string, scope: CompanyScope): Promise<readonly UserRoleAssignment[]>;
}
