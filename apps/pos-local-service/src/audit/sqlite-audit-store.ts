import type { LocalDatabase } from "@pos-platform/database-sqlite";
import type { SyncScope } from "../sync/durable-sync-store.js";

export interface AuditEventQuery {
  readonly query: string;
  readonly actionCode: string | null;
  readonly resourceType: string | null;
  readonly actorType: "USER" | "DEVICE" | "SYSTEM" | null;
  readonly from: string | null;
  readonly to: string | null;
  readonly limit: number;
  readonly offset: number;
}

export interface LocalAuditEvent {
  readonly sequence: number;
  readonly actorType: "USER" | "DEVICE" | "SYSTEM";
  readonly actorId: string | null;
  readonly sessionId: string;
  readonly actionCode: string;
  readonly resourceType: string;
  readonly resourceId: string | null;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly reasonCode: string | null;
  readonly createdAt: string;
}

interface AuditRow {
  sequence: number;
  actor_type: "USER" | "DEVICE" | "SYSTEM";
  actor_id: string | null;
  session_id: string;
  action_code: string;
  resource_type: string;
  resource_id: string | null;
  correlation_id: string;
  causation_id: string | null;
  reason_code: string | null;
  created_at: string;
}

export class SqliteAuditStore {
  constructor(private readonly database: LocalDatabase) {}

  list(scope: SyncScope, query: AuditEventQuery): { readonly events: readonly LocalAuditEvent[]; readonly hasMore: boolean } {
    const normalized = query.query.trim();
    const like = normalized === "" ? null : `%${normalized}%`;
    const rows = this.database.native.prepare(
      `SELECT sequence, actor_type, actor_id, session_id, action_code, resource_type,
              resource_id, correlation_id, causation_id, reason_code, created_at
       FROM local_operation_audit
       WHERE tenant_id=? AND company_id=? AND branch_id=?
         AND (? IS NULL OR action_code LIKE ? OR resource_type LIKE ? OR reason_code LIKE ?)
         AND (? IS NULL OR action_code=?)
         AND (? IS NULL OR resource_type=?)
         AND (? IS NULL OR actor_type=?)
         AND (? IS NULL OR created_at>=?)
         AND (? IS NULL OR created_at<=?)
       ORDER BY sequence DESC
       LIMIT ? OFFSET ?`,
    ).all(
      scope.tenantId, scope.companyId, scope.branchId,
      like, like, like, like,
      query.actionCode, query.actionCode,
      query.resourceType, query.resourceType,
      query.actorType, query.actorType,
      query.from, query.from,
      query.to, query.to,
      query.limit + 1, query.offset,
    ) as AuditRow[];

    const hasMore = rows.length > query.limit;
    const visible = hasMore ? rows.slice(0, query.limit) : rows;
    return {
      events: visible.map((row) => ({
        sequence: row.sequence,
        actorType: row.actor_type,
        actorId: row.actor_id,
        sessionId: row.session_id,
        actionCode: row.action_code,
        resourceType: row.resource_type,
        resourceId: row.resource_id,
        correlationId: row.correlation_id,
        causationId: row.causation_id,
        reasonCode: row.reason_code,
        createdAt: row.created_at,
      })),
      hasMore,
    };
  }
}
