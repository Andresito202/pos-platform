import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import type { SyncBatchRequest, SyncOperation } from "@pos-platform/contracts";
import { canonicalJson } from "@pos-platform/local-channel";
import { DurableSyncStore, type SyncScope } from "../src/sync/durable-sync-store.js";
import { DurableSyncComponent } from "../src/sync/durable-sync-component.js";
import { LocalDatabaseComponent } from "../src/local-database-component.js";

const directories: string[] = [];
async function directory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "pos-sync-"));
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

function operation(sequence: number, suffix: string, idempotencyKey = `sale:${suffix}`): SyncOperation {
  const payload = { sale_id: suffix, total: 1000 + sequence };
  return {
    operation_id: `018f0000-0000-7000-8000-0000000001${suffix}`,
    tenant_id: scope.tenantId,
    company_id: scope.companyId,
    branch_id: scope.branchId,
    device_id: scope.deviceId,
    installation_id: scope.installationId,
    session_id: "018f0000-0000-7000-8000-000000000006",
    actor_id: "018f0000-0000-7000-8000-000000000007",
    aggregate_type: "SALE",
    aggregate_id: `018f0000-0000-7000-8000-0000000002${suffix}`,
    operation_type: "SALE_CONFIRM",
    authority_policy: "LOCAL_AUTHORITATIVE_UNTIL_SYNC",
    local_sequence: sequence,
    idempotency_key: idempotencyKey,
    expected_version: null,
    payload_schema_version: "1.0.0",
    payload,
    payload_checksum: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
    causation_id: null,
    correlation_id: `018f0000-0000-7000-8000-0000000003${suffix}`,
    occurred_at_local: "2026-08-28T20:00:00Z",
    recorded_at_local: "2026-08-28T20:00:01Z",
  };
}

function accepted(batch: SyncBatchRequest, acknowledged: number) {
  return {
    batch_id: batch.batch_id,
    tenant_id: batch.tenant_id,
    device_id: batch.device_id,
    acknowledged_through_local_sequence: acknowledged,
    results: batch.operations.map((item) => ({
      operation_id: item.operation_id,
      correlation_id: item.correlation_id,
      server_status: "SERVER_ACCEPTED" as const,
      server_result_code: "COMMITTED",
      aggregate_id: item.aggregate_id,
      previous_version: null,
      new_version: item.local_sequence,
      received_at_server: "2026-08-28T20:01:00Z",
      committed_at_server: "2026-08-28T20:01:01Z",
      retryable: false,
      review_required: false,
    })),
  };
}

describe("DurableSyncStore", () => {
  it("enqueues idempotently and rejects semantic idempotency collisions", async () => {
    const dir = await directory();
    const database = LocalDatabase.open({ dataDirectory: dir });
    const store = new DurableSyncStore(database);

    const first = operation(1, "01");
    expect(store.enqueue(first)).toBe("ENQUEUED");
    expect(store.enqueue(first)).toBe("ALREADY_ENQUEUED");

    const collision = {
      ...operation(2, "02", first.idempotency_key),
      payload: { sale_id: "different", total: 9999 },
    };
    expect(() => store.enqueue(collision)).toThrow("idempotency conflict");
    expect(database.native.prepare("SELECT count(*) AS count FROM local_sync_outbox").get()).toEqual({ count: 1 });
    database.close();
  });

  it("persists payload_checksum from canonical payload bytes, ignoring a supplied wrong checksum", async () => {
    const dir = await directory();
    const database = LocalDatabase.open({ dataDirectory: dir });
    const store = new DurableSyncStore(database);
    const item = { ...operation(1, "03"), payload_checksum: "0".repeat(64) };
    const expected = createHash("sha256").update(canonicalJson(item.payload)).digest("hex");

    expect(item.payload_checksum).not.toBe(expected);
    expect(store.enqueue(item)).toBe("ENQUEUED");

    const persisted = database.native.prepare(
      "SELECT payload_checksum, operation_json FROM local_sync_outbox WHERE operation_id=?",
    ).get(item.operation_id) as { payload_checksum: string; operation_json: string };
    const operationJson = JSON.parse(persisted.operation_json) as SyncOperation;

    expect(persisted.payload_checksum).toBe(expected);
    expect(operationJson.payload_checksum).toBe(expected);
    database.close();
  });

  it("persists a contiguous outbox, durable inbox and monotonic checkpoint across restart", async () => {
    const dir = await directory();
    let database = LocalDatabase.open({ dataDirectory: dir });
    let store = new DurableSyncStore(database, undefined, () => new Date("2026-08-28T20:00:10Z"));
    store.enqueue(operation(1, "01"));
    store.enqueue(operation(2, "02"));

    const batch = store.claimBatch(scope, 10);
    expect(batch?.operations.map((item) => item.local_sequence)).toEqual([1, 2]);
    expect(batch).not.toBeNull();

    store.recordResponse(batch!, accepted(batch!, 2));
    expect(store.checkpoint(scope)).toBe(2);
    expect(store.outboxState(operation(1, "01").operation_id)?.status).toBe("ACKNOWLEDGED");

    store.recordResponse(batch!, accepted(batch!, 2));
    expect(database.native.prepare("SELECT count(*) AS count FROM local_sync_inbox").get()).toEqual({ count: 2 });
    expect(() => database.native.prepare(
      "UPDATE local_sync_inbox SET server_status='CONFLICT' WHERE sequence=1",
    ).run()).toThrow("append-only");

    database.close();
    database = LocalDatabase.open({ dataDirectory: dir });
    store = new DurableSyncStore(database);
    expect(store.checkpoint(scope)).toBe(2);
    expect(store.claimBatch(scope, 10)).toBeNull();
    database.close();
  });

  it("recovers interrupted dispatches and applies bounded exponential retries", async () => {
    const dir = await directory();
    let now = new Date("2026-08-28T20:00:00Z");
    const database = LocalDatabase.open({ dataDirectory: dir });
    const store = new DurableSyncStore(
      database,
      { maxAttempts: 3, baseDelayMs: 1_000, maxDelayMs: 4_000 },
      () => now,
    );
    const item = operation(1, "01");
    store.enqueue(item);

    const first = store.claimBatch(scope, 1)!;
    expect(store.outboxState(item.operation_id)?.status).toBe("IN_FLIGHT");
    expect(store.recoverInterruptedDispatches()).toBe(1);
    expect(store.outboxState(item.operation_id)?.status).toBe("RETRY_WAIT");

    const recovered = store.claimBatch(scope, 1)!;
    store.recordTransportFailure(recovered, "NETWORK_UNAVAILABLE");
    expect(store.outboxState(item.operation_id)).toMatchObject({
      status: "RETRY_WAIT",
      attempt_count: 2,
    });

    now = new Date("2026-08-28T20:00:02Z");
    const third = store.claimBatch(scope, 1)!;
    store.recordTransportFailure(third, "NETWORK_UNAVAILABLE");
    expect(store.outboxState(item.operation_id)).toMatchObject({
      status: "DEAD_LETTER",
      attempt_count: 3,
    });

    store.requeueDeadLetter(item.operation_id);
    expect(store.outboxState(item.operation_id)).toMatchObject({
      status: "PENDING",
      attempt_count: 0,
    });
    expect(database.native.prepare(
      "SELECT recovered_at FROM local_sync_dead_letter WHERE operation_id=?",
    ).get(item.operation_id)).toMatchObject({ recovered_at: expect.any(String) });
    database.close();
  });

  it("recovers IN_FLIGHT operations automatically during runtime component startup", async () => {
    const dir = await directory();
    let database = LocalDatabase.open({ dataDirectory: dir });
    const initialStore = new DurableSyncStore(database);
    const item = operation(1, "01");
    initialStore.enqueue(item);
    expect(initialStore.claimBatch(scope, 1)).not.toBeNull();
    expect(initialStore.outboxState(item.operation_id)?.status).toBe("IN_FLIGHT");
    database.close();

    const databaseComponent = new LocalDatabaseComponent(dir);
    await databaseComponent.start();
    const syncComponent = new DurableSyncComponent(databaseComponent);
    await syncComponent.start();
    expect(syncComponent.store.outboxState(item.operation_id)?.status).toBe("RETRY_WAIT");

    await syncComponent.stop();
    await databaseComponent.stop();
  });

  it("never checkpoints through retry/review/dead-letter results", async () => {
    const dir = await directory();
    const database = LocalDatabase.open({ dataDirectory: dir });
    const store = new DurableSyncStore(
      database,
      { maxAttempts: 3, baseDelayMs: 1_000, maxDelayMs: 4_000 },
      () => new Date("2026-08-28T20:00:00Z"),
    );
    const item = operation(1, "01");
    store.enqueue(item);
    const batch = store.claimBatch(scope, 1)!;

    const retry = {
      batch_id: batch.batch_id,
      tenant_id: batch.tenant_id,
      device_id: batch.deviceId,
      acknowledged_through_local_sequence: null,
      results: [{
        operation_id: item.operation_id,
        correlation_id: item.correlation_id,
        server_status: "RETRY_SCHEDULED" as const,
        server_result_code: "UPSTREAM_TEMPORARY",
        aggregate_id: item.aggregate_id,
        previous_version: null,
        new_version: null,
        received_at_server: "2026-08-28T20:01:00Z",
        committed_at_server: null,
        retryable: true,
        review_required: false,
      }],
    };
    store.recordResponse(batch, retry);
    expect(store.checkpoint(scope)).toBe(0);
    expect(store.outboxState(item.operation_id)?.status).toBe("RETRY_WAIT");
    database.close();
  });
});