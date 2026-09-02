import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import { DurableSyncStore, type SyncScope } from "../src/sync/durable-sync-store.js";
import { DurableSyncComponent } from "../src/sync/durable-sync-component.js";
import { LocalDatabaseComponent } from "../src/local-database-component.js";
import {
  OperationConfirmationStore,
  type OperationConfirmationContext,
  type OperationConfirmationRequest,
} from "../src/operations/operation-confirmation-store.js";
import { OperationConfirmationComponent } from "../src/operations/operation-confirmation-component.js";

const directories: string[] = [];
async function directory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "pos-operations-"));
  directories.push(value);
  return value;
}
afterEach(() => {
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

const scope: SyncScope = {
  tenantId: "018f0000-0000-7000-8000-000000000001",
  companyId: "018f0000-0000-7000-8000-000000000002",
  branchId: "018f0000-0000-7000-8000-000000000003",
  deviceId: "018f0000-0000-7000-8000-000000000004",
  installationId: "018f0000-0000-7000-8000-000000000005",
};

const context: OperationConfirmationContext = {
  scope,
  sessionId: "018f0000-0000-7000-8000-000000000006",
  actorId: scope.deviceId,
};

function confirmationRequest(suffix: string, note: string): OperationConfirmationRequest {
  return {
    operationId: `018f0000-0000-7000-8000-0000000001${suffix}`,
    idempotencyKey: `generic:confirm:${suffix}`,
    correlationId: `018f0000-0000-7000-8000-0000000002${suffix}`,
    causationId: null,
    operationType: "RUNTIME_OPERATION_CONFIRMED",
    payload: { note },
  };
}

describe("OperationConfirmationStore", () => {
  it("confirms an operation atomically: runtime_operations, outbox and audit in one commit", async () => {
    const dir = await directory();
    const database = LocalDatabase.open({ dataDirectory: dir });
    const durableSync = new DurableSyncStore(database);
    const store = new OperationConfirmationStore(database, durableSync, () => new Date("2026-09-01T20:00:00Z"));

    const request = confirmationRequest("01", "example");
    const outcome = store.confirm(context, request);
    expect(outcome).toEqual({ kind: "CONFIRMED", operationId: request.operationId, resultCode: "CONFIRMED" });

    expect(database.native.prepare(
      "SELECT status, result_code FROM runtime_operations WHERE operation_id=?",
    ).get(request.operationId)).toEqual({ status: "SUCCEEDED", result_code: "CONFIRMED" });

    expect(database.native.prepare(
      "SELECT status, local_sequence, tenant_id FROM local_sync_outbox WHERE operation_id=?",
    ).get(request.operationId)).toEqual({ status: "PENDING", local_sequence: 1, tenant_id: scope.tenantId });

    expect(database.native.prepare(
      "SELECT actor_type, actor_id, action_code, resource_id, tenant_id FROM local_operation_audit WHERE resource_id=?",
    ).get(request.operationId)).toEqual({
      actor_type: "DEVICE",
      actor_id: scope.deviceId,
      action_code: "OPERATION_CONFIRMED",
      resource_id: request.operationId,
      tenant_id: scope.tenantId,
    });

    database.close();
  });

  it("replays idempotently without duplicating writes", async () => {
    const dir = await directory();
    const database = LocalDatabase.open({ dataDirectory: dir });
    const durableSync = new DurableSyncStore(database);
    const store = new OperationConfirmationStore(database, durableSync);

    const request = confirmationRequest("01", "example");
    expect(store.confirm(context, request).kind).toBe("CONFIRMED");
    expect(store.confirm(context, request)).toEqual({
      kind: "ALREADY_CONFIRMED",
      operationId: request.operationId,
      resultCode: "CONFIRMED",
    });

    expect(database.native.prepare("SELECT count(*) AS count FROM runtime_operations").get()).toEqual({ count: 1 });
    expect(database.native.prepare("SELECT count(*) AS count FROM local_sync_outbox").get()).toEqual({ count: 1 });
    expect(database.native.prepare("SELECT count(*) AS count FROM local_operation_audit").get()).toEqual({ count: 1 });
    database.close();
  });

  it("rejects an idempotency conflict without writing anything", async () => {
    const dir = await directory();
    const database = LocalDatabase.open({ dataDirectory: dir });
    const durableSync = new DurableSyncStore(database);
    const store = new OperationConfirmationStore(database, durableSync);

    const first = confirmationRequest("01", "example");
    expect(store.confirm(context, first).kind).toBe("CONFIRMED");

    const conflicting = { ...confirmationRequest("02", "different"), idempotencyKey: first.idempotencyKey };
    expect(store.confirm(context, conflicting)).toEqual({
      kind: "IDEMPOTENCY_CONFLICT",
      operationId: conflicting.operationId,
    });

    expect(database.native.prepare("SELECT count(*) AS count FROM runtime_operations").get()).toEqual({ count: 1 });
    expect(database.native.prepare("SELECT count(*) AS count FROM local_sync_outbox").get()).toEqual({ count: 1 });
    expect(database.native.prepare("SELECT count(*) AS count FROM local_operation_audit").get()).toEqual({ count: 1 });
    database.close();
  });

  it("rolls back the business write when the outbox enqueue fails", async () => {
    const dir = await directory();
    const database = LocalDatabase.open({ dataDirectory: dir });
    const durableSync = new DurableSyncStore(database);
    const store = new OperationConfirmationStore(database, durableSync);

    const request = confirmationRequest("01", "example");
    // Seed a conflicting outbox row under the same operation_id with different
    // content, so the nested DurableSyncStore.enqueue() call inside
    // OperationConfirmationStore.confirm() throws — proving the outer
    // transaction rolls back runtime_operations and the audit insert too,
    // not just the inner outbox savepoint.
    database.native.prepare(
      `INSERT INTO local_sync_outbox(
        operation_id,tenant_id,company_id,branch_id,device_id,installation_id,
        operation_type,idempotency_key,local_sequence,operation_json,payload_checksum,
        status,attempt_count,next_attempt_at,last_error_code,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,1,?,?,'PENDING',0,NULL,NULL,?,?)`,
    ).run(
      request.operationId,
      scope.tenantId, scope.companyId, scope.branchId, scope.deviceId, scope.installationId,
      "UNRELATED_TYPE", "unrelated:key", "{}",
      createHash("sha256").update("{}").digest("hex"),
      "2026-09-01T20:00:00Z", "2026-09-01T20:00:00Z",
    );

    expect(() => store.confirm(context, request)).toThrow("sync operation_id collision with different content");

    expect(database.native.prepare(
      "SELECT count(*) AS count FROM runtime_operations WHERE operation_id=?",
    ).get(request.operationId)).toEqual({ count: 0 });
    expect(database.native.prepare(
      "SELECT count(*) AS count FROM local_operation_audit WHERE resource_id=?",
    ).get(request.operationId)).toEqual({ count: 0 });
    // The seed row itself must survive untouched — only the attempted insert rolled back.
    expect(database.native.prepare(
      "SELECT count(*) AS count FROM local_sync_outbox WHERE operation_id=?",
    ).get(request.operationId)).toEqual({ count: 1 });

    database.close();
  });

  it("recovers an in-flight confirmation automatically on restart, then acknowledges it", async () => {
    const dir = await directory();
    let database = LocalDatabase.open({ dataDirectory: dir });
    const durableSync = new DurableSyncStore(database);
    const store = new OperationConfirmationStore(database, durableSync);
    const request = confirmationRequest("01", "example");
    store.confirm(context, request);
    expect(durableSync.claimBatch(scope, 1)).not.toBeNull();
    expect(durableSync.outboxState(request.operationId)?.status).toBe("IN_FLIGHT");
    database.close();

    const databaseComponent = new LocalDatabaseComponent(dir);
    await databaseComponent.start();
    const syncComponent = new DurableSyncComponent(databaseComponent);
    await syncComponent.start();
    expect(syncComponent.store.outboxState(request.operationId)?.status).toBe("RETRY_WAIT");

    const batch = syncComponent.store.claimBatch(scope, 1)!;
    syncComponent.store.recordResponse(batch, {
      batch_id: batch.batch_id,
      tenant_id: batch.tenant_id,
      device_id: batch.device_id,
      acknowledged_through_local_sequence: 1,
      results: batch.operations.map((item) => ({
        operation_id: item.operation_id,
        correlation_id: item.correlation_id,
        server_status: "SERVER_ACCEPTED" as const,
        server_result_code: "COMMITTED",
        aggregate_id: item.aggregate_id,
        previous_version: null,
        new_version: item.local_sequence,
        received_at_server: "2026-09-01T20:01:00Z",
        committed_at_server: "2026-09-01T20:01:01Z",
        retryable: false,
        review_required: false,
      })),
    });
    expect(syncComponent.store.outboxState(request.operationId)?.status).toBe("ACKNOWLEDGED");

    await syncComponent.stop();
    await databaseComponent.stop();
    database = LocalDatabase.open({ dataDirectory: dir });
    database.close();
  });

  it("keeps local_operation_audit append-only", async () => {
    const dir = await directory();
    const database = LocalDatabase.open({ dataDirectory: dir });
    const durableSync = new DurableSyncStore(database);
    const store = new OperationConfirmationStore(database, durableSync);
    store.confirm(context, confirmationRequest("01", "example"));

    expect(() => database.native.prepare(
      "UPDATE local_operation_audit SET reason_code='X' WHERE sequence=1",
    ).run()).toThrow("append-only");
    expect(() => database.native.prepare(
      "DELETE FROM local_operation_audit WHERE sequence=1",
    ).run()).toThrow("append-only");
    database.close();
  });

  it("wires OperationConfirmationComponent through the runtime lifecycle", async () => {
    const dir = await directory();
    const localDatabase = new LocalDatabaseComponent(dir);
    await localDatabase.start();
    const durableSync = new DurableSyncComponent(localDatabase);
    await durableSync.start();
    const operationConfirmation = new OperationConfirmationComponent(localDatabase, durableSync);
    expect(() => operationConfirmation.store).toThrow("not ready");
    await operationConfirmation.start();

    const request = confirmationRequest("01", "example");
    expect(operationConfirmation.store.confirm(context, request).kind).toBe("CONFIRMED");

    await operationConfirmation.stop();
    expect(() => operationConfirmation.store).toThrow("not ready");
    await durableSync.stop();
    await localDatabase.stop();
  });
});
