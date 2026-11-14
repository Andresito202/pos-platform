import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import type { AuthorizationSnapshotClaims } from "@pos-platform/contracts";
import { SqliteAuditStore } from "../src/audit/sqlite-audit-store.js";
import { ListAuditEventsUseCase, PERMISSION_AUDIT_EVENT_READ } from "../src/audit/list-audit-events-use-case.js";
import type { StoredAuthorizationSnapshot } from "../src/authorization/authorization-snapshot-store.js";
import type { SyncScope } from "../src/sync/durable-sync-store.js";

const TENANT = "018f0000-0000-7000-8000-000000000001";
const COMPANY = "018f0000-0000-7000-8000-000000000002";
const BRANCH = "018f0000-0000-7000-8000-000000000003";
const DEVICE = "018f0000-0000-7000-8000-000000000004";
const INSTALL = "018f0000-0000-7000-8000-000000000005";
const USER = "018f0000-0000-7000-8000-000000000006";
const SESSION = "018f0000-0000-7000-8000-000000000008";
const CORRELATION = "018f0000-0000-7000-8000-00000000cc01";
const RESOURCE = "018f0000-0000-7000-8000-000000000009";

const SCOPE: SyncScope = {
  tenantId: TENANT, companyId: COMPANY, branchId: BRANCH,
  deviceId: DEVICE, installationId: INSTALL,
};
const NOW = new Date("2026-09-07T10:00:00.000Z");

const directories: string[] = [];
const databases: LocalDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) {
    try { database.close(); } catch { /* no debe ocultar el fallo real */ }
  }
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

function auth(permissions: string[] = [PERMISSION_AUDIT_EVENT_READ]): StoredAuthorizationSnapshot {
  const claims: AuthorizationSnapshotClaims = {
    snapshot_id: "018f0000-0000-7000-8000-0000000000ff",
    user_id: USER, installation_id: INSTALL, device_id: DEVICE,
    sequence: 1, issued_at: "2026-09-07T00:00:00.000Z",
    expires_at: "2026-09-08T00:00:00.000Z", key_id: "AUTHZ_KEY_1",
    assignments: [{
      tenant_id: TENANT, company_id: COMPANY, branch_id: BRANCH,
      status: "ACTIVE", valid_from: "2026-09-01T00:00:00.000Z", valid_until: null,
      role_status: "ACTIVE",
      permissions: permissions.map((code) => ({ code, status: "ACTIVE" as const })),
    }],
  } as AuthorizationSnapshotClaims;
  return { claims, signature: "stub", activatedAt: NOW.toISOString() };
}

async function buildEnv() {
  const dir = await mkdtemp(join(tmpdir(), "pos-audit-"));
  directories.push(dir);
  const database = LocalDatabase.open({ dataDirectory: dir });
  databases.push(database);
  const store = new SqliteAuditStore(database);
  return { database, list: new ListAuditEventsUseCase(store) };
}

function insertAudit(database: LocalDatabase, tenantId = TENANT): void {
  database.native.prepare(
    `INSERT INTO local_operation_audit(
      tenant_id, company_id, branch_id, device_id, actor_type, actor_id, session_id,
      action_code, resource_type, resource_id, correlation_id, causation_id,
      reason_code, details_json, created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    tenantId, COMPANY, BRANCH, DEVICE, "USER", USER, SESSION,
    "SALE_CREATED", "SALE", RESOURCE, CORRELATION, null, null, "{}", NOW.toISOString(),
  );
}

describe("lectura de auditoría administrativa", () => {
  it("devuelve sólo evidencia del scope efectivo y nunca details_json", async () => {
    const { database, list } = await buildEnv();
    insertAudit(database);
    const result = list.execute(SCOPE, auth(), {
      query: "", actionCode: null, resourceType: null, actorType: null,
      from: null, to: null, limit: 50, offset: 0,
    }, NOW);

    expect(result.kind).toBe("FOUND");
    if (result.kind !== "FOUND") return;
    expect(result.events).toHaveLength(1);
    const event = result.events[0];
    expect(event).toBeDefined();
    if (event === undefined) throw new Error("expected one audit event");
    expect(event.actionCode).toBe("SALE_CREATED");
    expect(event).not.toHaveProperty("detailsJson");
  });

  it("deniega sin el permiso dedicado", async () => {
    const { list } = await buildEnv();
    const result = list.execute(SCOPE, auth([]), {
      query: "", actionCode: null, resourceType: null, actorType: null,
      from: null, to: null, limit: 50, offset: 0,
    }, NOW);
    expect(result.kind).toBe("UNAUTHORIZED");
  });

  it("filtra actor y pagina sobre filas reales", async () => {
    const { database, list } = await buildEnv();
    insertAudit(database);
    const result = list.execute(SCOPE, auth(), {
      query: "", actionCode: "SALE_CREATED", resourceType: "SALE", actorType: "USER",
      from: null, to: null, limit: 1, offset: 0,
    }, NOW);

    expect(result.kind).toBe("FOUND");
    if (result.kind !== "FOUND") return;
    expect(result.events).toHaveLength(1);
    expect(result.hasMore).toBe(false);
  });

  it("no expone otra tenant aunque comparta empresa y sucursal", async () => {
    const { database, list } = await buildEnv();
    insertAudit(database);
    insertAudit(database, "018f0000-0000-7000-8000-000000000010");
    const result = list.execute(SCOPE, auth(), {
      query: "", actionCode: null, resourceType: null, actorType: null,
      from: null, to: null, limit: 50, offset: 0,
    }, NOW);

    expect(result.kind).toBe("FOUND");
    if (result.kind !== "FOUND") return;
    expect(result.events).toHaveLength(1);
  });
});
