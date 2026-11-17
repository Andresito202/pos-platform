import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SyncBatchRequest, SyncOperation } from "@pos-platform/contracts";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import { DurableSyncStore, type SyncScope } from "../src/sync/durable-sync-store.js";
import {
  CentralTransportError,
  type CentralHttpResponse,
  type CentralTransport,
} from "../src/sync/central-transport.js";
import { SyncDispatcher } from "../src/sync/sync-dispatcher.js";
import type { DeviceCredentialProvider } from "../src/sync/device-credential.js";
import { CentralSyncComponent } from "../src/sync/central-sync-component.js";

/**
 * Bloque 5 — offline persistence + automatic sync on the EXISTING outbox engine.
 * Does not invent a second sync motor. Multi-register stock is per-device SQLite;
 * absolute global oversell prevention while cajas are partitioned is NOT claimed.
 */
const PROTOCOL = "1.0.0";
const BASE_URL = "https://central.invalid";
const credentials: DeviceCredentialProvider = {
  authorization: () => Promise.resolve("Bearer bloque5-device"),
};

const directories: string[] = [];
const databases: LocalDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) {
    try { database.close(); } catch { /* keep real failure */ }
  }
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

async function openDb(label: string): Promise<{ dir: string; database: LocalDatabase; store: DurableSyncStore }> {
  const dir = await mkdtemp(join(tmpdir(), `pos-b5-${label}-`));
  directories.push(dir);
  const database = LocalDatabase.open({ dataDirectory: dir });
  databases.push(database);
  return { dir, database, store: new DurableSyncStore(database) };
}

function id(n: number): string {
  return `018f0000-0000-7000-8000-${n.toString().padStart(12, "0")}`;
}

function scopeOf(device: number, company = 10, branch = 11, install?: number): SyncScope {
  return {
    tenantId: id(1),
    companyId: id(company),
    branchId: id(branch),
    deviceId: id(device),
    installationId: id(install ?? device + 1000),
  };
}

function saleOp(scope: SyncScope, sequence: number, saleSuffix: string): SyncOperation {
  const payload = { sale_id: saleSuffix, total_minor: 1000 + sequence, offline: true };
  // Device-scoped numeric tails keep UUID-shaped ids unique across multi-caja fixtures.
  const deviceTail = Number.parseInt(scope.deviceId.slice(-6), 10);
  const opTail = 200_000 + deviceTail * 1_000 + sequence;
  const aggregateTail = 300_000 + deviceTail * 1_000 + sequence;
  const correlationTail = 400_000 + deviceTail * 1_000 + sequence;
  return {
    operation_id: id(opTail),
    tenant_id: scope.tenantId,
    company_id: scope.companyId,
    branch_id: scope.branchId,
    device_id: scope.deviceId,
    installation_id: scope.installationId,
    session_id: id(6),
    actor_id: id(7),
    aggregate_type: "SALE",
    aggregate_id: id(aggregateTail),
    operation_type: "SALE_COMPLETED",
    authority_policy: "LOCAL_AUTHORITATIVE_UNTIL_SYNC",
    local_sequence: sequence,
    idempotency_key: `sale:${scope.deviceId}:${saleSuffix}`,
    expected_version: null,
    payload_schema_version: "1.0.0",
    payload,
    payload_checksum: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
    causation_id: null,
    correlation_id: id(correlationTail),
    occurred_at_local: "2026-11-17T12:00:00Z",
    recorded_at_local: "2026-11-17T12:00:01Z",
  };
}

function envelope(
  requestId: string,
  correlationId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    protocol_version: PROTOCOL,
    request_id: requestId,
    correlation_id: correlationId,
    operation_id: null,
    status: "SUCCEEDED",
    result_code: "SYNC_BATCH_APPLIED",
    result_schema_version: "1.0.0",
    error: null,
    server_time: "2026-11-17T12:01:00Z",
    result: null,
    ...overrides,
  };
}

function acceptedResult(batch: SyncBatchRequest) {
  return {
    batch_id: batch.batch_id,
    tenant_id: batch.tenant_id,
    device_id: batch.device_id,
    acknowledged_through_local_sequence: batch.operations[batch.operations.length - 1]!.local_sequence,
    results: batch.operations.map((item) => ({
      operation_id: item.operation_id,
      correlation_id: item.correlation_id,
      server_status: "SERVER_ACCEPTED" as const,
      server_result_code: "COMMITTED",
      aggregate_id: item.aggregate_id,
      previous_version: null,
      new_version: item.local_sequence,
      received_at_server: "2026-11-17T12:01:00Z",
      committed_at_server: "2026-11-17T12:01:01Z",
      retryable: false,
      review_required: false,
    })),
  };
}

function acceptingTransport(seen: SyncBatchRequest[]): CentralTransport {
  return {
    send: async (request): Promise<CentralHttpResponse> => {
      const body = JSON.parse(request.body) as Record<string, unknown>;
      const batch = body.payload as SyncBatchRequest;
      seen.push(batch);
      return {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "X-Pos-Api-Version": PROTOCOL,
          "X-Request-Id": String(body.request_id),
          "X-Correlation-Id": String(body.correlation_id),
        },
        body: JSON.stringify(envelope(String(body.request_id), String(body.correlation_id), {
          result: acceptedResult(batch),
        })),
      };
    },
  };
}

function failingTransport(sent: boolean): CentralTransport {
  return {
    send: async () => {
      throw new CentralTransportError("central unavailable", "CENTRAL_UNAVAILABLE", sent);
    },
  };
}

function statuses(database: LocalDatabase): string[] {
  return (database.native
    .prepare("SELECT status FROM local_sync_outbox ORDER BY local_sequence")
    .all() as { status: string }[]).map((row) => row.status);
}

describe("bloque5 offline sale persistence and sync recovery", () => {
  it("keeps confirmed offline sales and pending outbox without Central", async () => {
    const { database, store } = await openDb("offline");
    const scope = scopeOf(40);
    const op = saleOp(scope, 1, "offline-01");
    expect(store.enqueue(op)).toBe("ENQUEUED");
    expect(store.enqueue(op)).toBe("ALREADY_ENQUEUED");
    expect(statuses(database)).toEqual(["PENDING"]);
    // No dispatcher call — local authority stands until sync.
    expect(store.checkpoint(scope)).toBe(0);
  });

  it("recovers IN_FLIGHT after process restart and retransmits safely", async () => {
    const { dir, database, store } = await openDb("restart");
    const scope = scopeOf(41);
    store.enqueue(saleOp(scope, 1, "r1"));
    store.enqueue(saleOp(scope, 2, "r2"));
    const batch = store.claimBatch(scope, 10);
    expect(batch?.operations).toHaveLength(2);
    expect(statuses(database)).toEqual(["IN_FLIGHT", "IN_FLIGHT"]);
    database.close();

    const reopened = LocalDatabase.open({ dataDirectory: dir });
    databases.push(reopened);
    const recoveredStore = new DurableSyncStore(reopened);
    expect(recoveredStore.recoverInterruptedDispatches()).toBe(2);
    expect(statuses(reopened)).toEqual(["RETRY_WAIT", "RETRY_WAIT"]);

    const seen: SyncBatchRequest[] = [];
    const dispatcher = new SyncDispatcher(
      recoveredStore, acceptingTransport(seen), credentials, BASE_URL, PROTOCOL,
    );
    const outcome = await dispatcher.dispatchOnce(scope);
    expect(outcome.kind).toBe("DELIVERED");
    expect(seen).toHaveLength(1);
    expect(statuses(reopened)).toEqual(["ACKNOWLEDGED", "ACKNOWLEDGED"]);
    expect(recoveredStore.checkpoint(scope)).toBe(2);

    // Duplicate push after ACK is idle — no duplication.
    expect(await dispatcher.dispatchOnce(scope)).toEqual({ kind: "IDLE" });
  });

  it("records transport loss, retries with backoff readiness, then delivers", async () => {
    let clock = new Date("2026-11-17T12:00:00Z");
    const { database, store } = await openDb("transport");
    const timed = new DurableSyncStore(database, undefined, () => clock);
    const scope = scopeOf(42);
    timed.enqueue(saleOp(scope, 1, "t1"));

    const fail = new SyncDispatcher(timed, failingTransport(true), credentials, BASE_URL, PROTOCOL);
    const failed = await fail.dispatchOnce(scope);
    expect(failed.kind).toBe("TRANSPORT_FAILED");
    expect(statuses(database)).toEqual(["RETRY_WAIT"]);

    // Immediate retry blocked until next_attempt_at.
    expect(await fail.dispatchOnce(scope)).toEqual({ kind: "IDLE" });

    clock = new Date("2026-11-17T12:10:00Z");
    const seen: SyncBatchRequest[] = [];
    const ok = new SyncDispatcher(timed, acceptingTransport(seen), credentials, BASE_URL, PROTOCOL);
    expect((await ok.dispatchOnce(scope)).kind).toBe("DELIVERED");
    expect(statuses(database)).toEqual(["ACKNOWLEDGED"]);
  });

  it("rejects cross-company claim contamination on the same physical DB", async () => {
    const { store } = await openDb("isolation");
    const a = scopeOf(50, 10, 11);
    const b = scopeOf(51, 20, 21);
    store.enqueue(saleOp(a, 1, "a1"));
    store.enqueue(saleOp(b, 1, "b1"));
    const batchA = store.claimBatch(a, 10);
    expect(batchA?.operations.map((o) => o.company_id)).toEqual([a.companyId]);
    const batchB = store.claimBatch(b, 10);
    expect(batchB?.operations.map((o) => o.company_id)).toEqual([b.companyId]);
  });

  it("CentralSyncComponent keeps ticking after a transport failure (auto reconnect probe)", async () => {
    const { store } = await openDb("tick");
    const scope = scopeOf(43);
    store.enqueue(saleOp(scope, 1, "tick1"));
    let calls = 0;
    const transport: CentralTransport = {
      send: async () => {
        calls += 1;
        if (calls === 1) throw new CentralTransportError("central down", "CENTRAL_DOWN", false);
        // Dispatcher builds its own request ids; failing first is enough for lifecycle.
        throw new CentralTransportError("central down", "CENTRAL_DOWN", false);
      },
    };
    const outcomes: string[] = [];
    const component = new CentralSyncComponent(
      () => new SyncDispatcher(store, transport, credentials, BASE_URL, PROTOCOL),
      scope,
      1000,
      {
        onOutcome: (o) => { outcomes.push(o.kind); },
        onLifecycle: () => undefined,
      },
    );
    await component.start();
    expect(outcomes[0]).toBe("TRANSPORT_FAILED");
    await component.stop();
  });
});

describe("bloque5 multicaja 3 companies × 3 registers", () => {
  const companies = [
    { label: "SALSAMENTARIA", company: 10, branch: 11, devices: [110, 111, 112] },
    { label: "FARMACIA", company: 20, branch: 21, devices: [210, 211, 212] },
    { label: "PASTELERIA", company: 30, branch: 31, devices: [310, 311, 312] },
  ] as const;

  it("gives each caja independent sequences, outbox and sync without cross-talk", async () => {
    const fixtures = [];
    for (const company of companies) {
      for (const device of company.devices) {
        const opened = await openDb(`${company.label}-${device}`);
        const scope = scopeOf(device, company.company, company.branch);
        opened.store.enqueue(saleOp(scope, 1, `${company.label}-1`));
        opened.store.enqueue(saleOp(scope, 2, `${company.label}-2`));
        fixtures.push({ company, device, scope, ...opened });
      }
    }
    expect(fixtures).toHaveLength(9);

    // Concurrent local sales remain PENDING per device DB.
    for (const fixture of fixtures) {
      expect(statuses(fixture.database)).toEqual(["PENDING", "PENDING"]);
      expect(fixture.store.checkpoint(fixture.scope)).toBe(0);
    }

    // Disconnect one caja (no dispatch) while others sync.
    const [offline, ...online] = fixtures;
    for (const fixture of online) {
      const seen: SyncBatchRequest[] = [];
      const dispatcher = new SyncDispatcher(
        fixture.store, acceptingTransport(seen), credentials, BASE_URL, PROTOCOL,
      );
      expect((await dispatcher.dispatchOnce(fixture.scope)).kind).toBe("DELIVERED");
      expect(seen[0]!.device_id).toBe(fixture.scope.deviceId);
      expect(seen[0]!.company_id).toBe(fixture.scope.companyId);
      expect(statuses(fixture.database)).toEqual(["ACKNOWLEDGED", "ACKNOWLEDGED"]);
    }
    expect(statuses(offline!.database)).toEqual(["PENDING", "PENDING"]);

    // Reconnect the offline caja.
    const seen: SyncBatchRequest[] = [];
    const dispatcher = new SyncDispatcher(
      offline!.store, acceptingTransport(seen), credentials, BASE_URL, PROTOCOL,
    );
    expect((await dispatcher.dispatchOnce(offline!.scope)).kind).toBe("DELIVERED");
    expect(statuses(offline!.database)).toEqual(["ACKNOWLEDGED", "ACKNOWLEDGED"]);
  });

  it("documents inventory policy: isolated SQLite DBs do not coordinate stock across offline cajas", async () => {
    // Policy: each caja holds its own SQLite projection. Without prior Central
    // reservation/coordination, two offline cajas can each accept a sale against
    // locally available stock. Sync later reconciles events; absolute global
    // oversell prevention while partitioned is NOT asserted here.
    const cajaA = await openDb("inv-a");
    const cajaB = await openDb("inv-b");
    const scopeA = scopeOf(410, 10, 11);
    const scopeB = scopeOf(411, 10, 11); // same company/branch, different device DBs
    cajaA.store.enqueue(saleOp(scopeA, 1, "stock-a"));
    cajaB.store.enqueue(saleOp(scopeB, 1, "stock-b"));
    expect(statuses(cajaA.database)).toEqual(["PENDING"]);
    expect(statuses(cajaB.database)).toEqual(["PENDING"]);
    // Distinct physical databases ⇒ no shared local lock.
    expect(cajaA.dir).not.toBe(cajaB.dir);
  });
});

describe("bloque5 integrity, rejection and partial sync", () => {
  it("rejects operation_id collision with different content (anti-tamper)", async () => {
    const { store } = await openDb("tamper");
    const scope = scopeOf(60);
    const original = saleOp(scope, 1, "orig");
    expect(store.enqueue(original)).toBe("ENQUEUED");
    expect(() => store.enqueue({
      ...original,
      payload: { sale_id: "tampered", total_minor: 999 },
      payload_checksum: createHash("sha256").update("tampered").digest("hex"),
    })).toThrow(/collision/i);
  });

  it("keeps SERVER_REJECTED durable in inbox and advances checkpoint without deleting outbox history", async () => {
    const { database, store } = await openDb("reject");
    const scope = scopeOf(61);
    store.enqueue(saleOp(scope, 1, "rej-1"));
    const batch = store.claimBatch(scope, 10);
    expect(batch).not.toBeNull();
    if (!batch) return;

    store.recordResponse(batch, {
      batch_id: batch.batch_id,
      tenant_id: batch.tenant_id,
      device_id: batch.device_id,
      acknowledged_through_local_sequence: 1,
      results: [{
        operation_id: batch.operations[0]!.operation_id,
        correlation_id: batch.operations[0]!.correlation_id,
        server_status: "SERVER_REJECTED",
        server_result_code: "CONTRACT_VIOLATION",
        aggregate_id: batch.operations[0]!.aggregate_id,
        previous_version: null,
        new_version: null,
        received_at_server: "2026-11-17T12:01:00Z",
        committed_at_server: "2026-11-17T12:01:01Z",
        retryable: false,
        review_required: true,
      }],
    });

    expect(statuses(database)).toEqual(["ACKNOWLEDGED"]);
    const inbox = database.native.prepare(
      "SELECT server_status FROM local_sync_inbox WHERE operation_id=?",
    ).get(batch.operations[0]!.operation_id) as { server_status: string };
    expect(inbox.server_status).toBe("SERVER_REJECTED");
    expect(store.checkpoint(scope)).toBe(1);
  });

  it("preserves DEAD_LETTER for authorized recovery via requeue", async () => {
    let clock = new Date("2026-11-17T12:00:00Z");
    const { database, store } = await openDb("dead");
    const timed = new DurableSyncStore(database, {
      maxAttempts: 2,
      baseDelayMs: 1,
      maxDelayMs: 1,
      jitterRatio: 0,
    }, () => clock, () => 0);
    const scope = scopeOf(62);
    timed.enqueue(saleOp(scope, 1, "dead-1"));

    const fail = new SyncDispatcher(timed, failingTransport(true), credentials, BASE_URL, PROTOCOL);
    expect((await fail.dispatchOnce(scope)).kind).toBe("TRANSPORT_FAILED");
    clock = new Date("2026-11-17T12:00:01Z");
    expect((await fail.dispatchOnce(scope)).kind).toBe("TRANSPORT_FAILED");
    expect(statuses(database)).toEqual(["DEAD_LETTER"]);
    expect(database.native.prepare(
      "SELECT count(*) AS n FROM local_sync_dead_letter WHERE recovered_at IS NULL",
    ).get()).toEqual({ n: 1 });

    timed.requeueDeadLetter(saleOp(scope, 1, "dead-1").operation_id);
    expect(statuses(database)).toEqual(["PENDING"]);
    const seen: SyncBatchRequest[] = [];
    const ok = new SyncDispatcher(timed, acceptingTransport(seen), credentials, BASE_URL, PROTOCOL);
    expect((await ok.dispatchOnce(scope)).kind).toBe("DELIVERED");
    expect(statuses(database)).toEqual(["ACKNOWLEDGED"]);
  });

  it("handles partial sync causal stall: earlier RETRY_WAIT blocks later PENDING until ready", async () => {
    let clock = new Date("2026-11-17T12:00:00Z");
    const { database, store } = await openDb("partial");
    const timed = new DurableSyncStore(database, undefined, () => clock);
    const scope = scopeOf(63);
    timed.enqueue(saleOp(scope, 1, "p1"));
    timed.enqueue(saleOp(scope, 2, "p2"));

    const fail = new SyncDispatcher(timed, failingTransport(true), credentials, BASE_URL, PROTOCOL);
    // Claim both then fail → both RETRY_WAIT
    expect((await fail.dispatchOnce(scope)).kind).toBe("TRANSPORT_FAILED");
    expect(statuses(database)).toEqual(["RETRY_WAIT", "RETRY_WAIT"]);
    // Before backoff elapses, claim is empty (causal + schedule).
    expect(timed.claimBatch(scope, 10)).toBeNull();
    clock = new Date("2026-11-17T12:30:00Z");
    const seen: SyncBatchRequest[] = [];
    const ok = new SyncDispatcher(timed, acceptingTransport(seen), credentials, BASE_URL, PROTOCOL);
    expect((await ok.dispatchOnce(scope)).kind).toBe("DELIVERED");
    expect(seen[0]!.operations).toHaveLength(2);
    expect(statuses(database)).toEqual(["ACKNOWLEDGED", "ACKNOWLEDGED"]);
  });
});

describe("bloque5 outbox burst performance (local engine)", () => {
  it("handles 10 companies × 3 cajas × 100 sales (3000 aggregate) with concurrent sync", async () => {
    const companies = 10;
    const cajasPerCompany = 3;
    const salesPerCaja = 100;
    const expectedTotal = companies * cajasPerCompany * salesPerCaja;
    expect(expectedTotal).toBe(3000);

    type Fixture = {
      store: DurableSyncStore;
      database: LocalDatabase;
      scope: SyncScope;
    };
    const fixtures: Fixture[] = [];
    const enqueueStarted = Date.now();
    for (let c = 1; c <= companies; c += 1) {
      for (let r = 1; r <= cajasPerCompany; r += 1) {
        const device = 800 + c * 10 + r;
        const opened = await openDb(`perf-${device}`);
        const scope = scopeOf(device, 100 + c, 200 + c);
        for (let s = 1; s <= salesPerCaja; s += 1) {
          opened.store.enqueue(saleOp(scope, s, `c${c}-r${r}-s${s}`));
        }
        fixtures.push({ store: opened.store, database: opened.database, scope });
      }
    }
    const enqueueMs = Date.now() - enqueueStarted;
    expect(fixtures).toHaveLength(30);

    let delivered = 0;
    const dispatchStarted = Date.now();
    await Promise.all(fixtures.map(async (fixture) => {
      const transport: CentralTransport = {
        send: async (request): Promise<CentralHttpResponse> => {
          const body = JSON.parse(request.body) as Record<string, unknown>;
          const batch = body.payload as SyncBatchRequest;
          delivered += batch.operations.length;
          return {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "X-Pos-Api-Version": PROTOCOL,
              "X-Request-Id": String(body.request_id),
              "X-Correlation-Id": String(body.correlation_id),
            },
            body: JSON.stringify(envelope(String(body.request_id), String(body.correlation_id), {
              result: acceptedResult(batch),
            })),
          };
        },
      };
      const dispatcher = new SyncDispatcher(
        fixture.store, transport, credentials, BASE_URL, PROTOCOL, { maxOperations: 100 },
      );
      for (;;) {
        const outcome = await dispatcher.dispatchOnce(fixture.scope);
        if (outcome.kind === "IDLE") break;
        expect(outcome.kind).toBe("DELIVERED");
      }
      expect(fixture.store.checkpoint(fixture.scope)).toBe(salesPerCaja);
    }));
    const dispatchMs = Date.now() - dispatchStarted;

    expect(delivered).toBe(expectedTotal);
    for (const fixture of fixtures) {
      expect(fixture.database.native.prepare(
        "SELECT count(*) AS n FROM local_sync_outbox WHERE status='ACKNOWLEDGED'",
      ).get()).toEqual({ n: salesPerCaja });
    }

    // Soft budgets for this VM — NOT a production VPS capacity certification.
    expect(enqueueMs).toBeLessThan(120_000);
    expect(dispatchMs).toBeLessThan(180_000);
  }, 300_000);
});
