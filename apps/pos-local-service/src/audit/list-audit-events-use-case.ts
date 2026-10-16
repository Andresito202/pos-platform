import { CanonicalPermission } from "@pos-platform/contracts";
import {
  createActor,
  createOperationScope,
  evaluatePermission,
  toRoleAssignments,
} from "@pos-platform/application";
import type { StoredAuthorizationSnapshot } from "../authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../sync/durable-sync-store.js";
import type { LocalAuditEvent, SqliteAuditStore, AuditEventQuery } from "./sqlite-audit-store.js";

/**
 * V1 audit read permission. It is deliberately separate from mutation/admin
 * permissions: reading evidence must never be implied by changing policy.
 */
export const PERMISSION_AUDIT_EVENT_READ = CanonicalPermission.AUDIT_EVENT_READ;

export type ListAuditEventsResult =
  | { readonly kind: "FOUND"; readonly events: readonly LocalAuditEvent[]; readonly hasMore: boolean }
  | { readonly kind: "UNAUTHORIZED"; readonly reason: string };

export class ListAuditEventsUseCase {
  constructor(private readonly auditStore: SqliteAuditStore) {}

  execute(
    scope: SyncScope,
    authSnapshot: StoredAuthorizationSnapshot,
    request: AuditEventQuery,
    at: Date = new Date(),
  ): ListAuditEventsResult {
    const decision = evaluatePermission({
      actor: createActor("USER", authSnapshot.claims.user_id),
      permission: PERMISSION_AUDIT_EVENT_READ,
      scope: createOperationScope(scope.tenantId, scope.companyId, scope.branchId),
      at,
      assignments: toRoleAssignments(authSnapshot.claims),
    });
    if (!decision.allowed) return { kind: "UNAUTHORIZED", reason: decision.reason };

    const result = this.auditStore.list(scope, request);
    return { kind: "FOUND", ...result };
  }
}
