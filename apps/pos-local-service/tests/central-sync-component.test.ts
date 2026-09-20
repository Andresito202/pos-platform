import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SyncOperation } from "@pos-platform/contracts";
import { LocalDatabaseComponent } from "../src/local-database-component.js";
import { DurableSyncComponent } from "../src/sync/durable-sync-component.js";
import type { SyncScope } from "../src/sync/durable-sync-store.js";
import type { CentralHttpResponse, CentralTransport } from "../src/sync/central-transport.js";
import {
  UnprovisionedDeviceCredentialProvider,
  type DeviceCredentialProvider,
} from "../src/sync/device-credential.js";
import { SyncDispatcher, type DispatchOutcome } from "../src/sync/sync-dispatcher.js";
import {
  CentralSyncComponent,
  type DispatchReason,
} from "../src/sync/central-sync-component.js";

const directories: string[] = [];
async function directory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "pos-central-sync-"));
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

function operation(sequence: number): SyncOperation {
  const suffix = String(sequence).padStart(2, "0");
  const payload = { sale_id: suffix };
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
    idempotency_key: `sale:${suffix}`,
    expected_version: null,
    payload_schema_version: "1.0.0",
    payload,
    payload_checksum: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
    causation_id: null,
    correlation_id: `018f0000-0000-7000-8000-0000000003${suffix}`,
    occurred_at_local: "2026-09-14T12:00:00Z",
    recorded_at_local: "2026-09-14T12:00:01Z",
  };
}

const credentials: DeviceCredentialProvider = {
  authorization: () => Promise.resolve("Bearer test-only"),
};

function acceptingTransport(sent: { count: number }): CentralTransport {
  return {
    send: (request): Promise<CentralHttpResponse> => {
      sent.count += 1;
      const body = JSON.parse(request.body) as Record<string, unknown>;
      const batch = body.payload as {
        batch_id: string; tenant_id: string; device_id: string;
        operations: { operation_id: string; correlation_id: string; aggregate_id: string; local_sequence: number }[];
      };
      const envelope = {
        protocol_version: "1.0.0",
        request_id: body.request_id,
        correlation_id: body.correlation_id,
        operation_id: null,
        status: "SUCCEEDED",
        result_code: "SYNC_BATCH_APPLIED",
        result_schema_version: "1.0.0",
        error: null,
        server_time: "2026-09-14T12:00:05Z",
        result: {
          batch_id: batch.batch_id,
          tenant_id: batch.tenant_id,
          device_id: batch.device_id,
          acknowledged_through_local_sequence:
            batch.operations[batch.operations.length - 1]!.local_sequence,
          results: batch.operations.map((item) => ({
            operation_id: item.operation_id,
            correlation_id: item.correlation_id,
            server_status: "SERVER_ACCEPTED",
            server_result_code: "COMMITTED",
            aggregate_id: item.aggregate_id,
            previous_version: null,
            new_version: item.local_sequence,
            received_at_server: "2026-09-14T12:00:03Z",
            committed_at_server: "2026-09-14T12:00:04Z",
            retryable: false,
            review_required: false,
          })),
        },
      };
      return Promise.resolve({
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-pos-api-version": "1.0.0",
          "x-request-id": String(body.request_id),
          "x-correlation-id": String(body.correlation_id),
        },
        body: JSON.stringify(envelope),
      });
    },
  };
}

interface Recorder {
  readonly outcomes: DispatchOutcome[];
  readonly lifecycle: { reason: DispatchReason; detail: Record<string, unknown> }[];
}
function recorder(): Recorder & { onOutcome(o: DispatchOutcome): void; onLifecycle(r: DispatchReason, d: Readonly<Record<string, unknown>>): void } {
  const outcomes: DispatchOutcome[] = [];
  const lifecycle: { reason: DispatchReason; detail: Record<string, unknown> }[] = [];
  return {
    outcomes,
    lifecycle,
    onOutcome: (outcome) => { outcomes.push(outcome); },
    onLifecycle: (reason, detail) => { lifecycle.push({ reason, detail: { ...detail } }); },
  };
}

async function runtime(): Promise<{ database: LocalDatabaseComponent; sync: DurableSyncComponent }> {
  const database = new LocalDatabaseComponent(await directory());
  await database.start();
  const sync = new DurableSyncComponent(database);
  await sync.start();
  return { database, sync };
}

describe("CentralSyncComponent — D-2", () => {
  it("sin credencial de dispositivo no temporiza y lo dice una sola vez", async () => {
    const { database, sync } = await runtime();
    sync.store.enqueue(operation(1));
    const sent = { count: 0 };
    const report = recorder();

    const component = new CentralSyncComponent(
      () => new SyncDispatcher(
        sync.store,
        acceptingTransport(sent),
        new UnprovisionedDeviceCredentialProvider(),
        "https://central.invalid",
        "1.0.0",
      ),
      scope,
      1_000,
      report,
    );

    await component.start();
    expect(report.lifecycle).toEqual([
      { reason: "NO_DEVICE_CREDENTIAL", detail: { code: "DEVICE_CREDENTIAL_UNPROVISIONED" } },
    ]);
    expect(report.outcomes).toHaveLength(0);
    expect(sent.count).toBe(0);

    // El outbox conserva la operacion intacta: acumular sin conexion es el
    // comportamiento correcto, no una degradacion.
    expect(sync.store.outboxState(operation(1).operation_id)).toMatchObject({
      status: "PENDING",
      attempt_count: 0,
    });

    // Esperar mas de un intervalo no produce ningun despacho: no hay temporizador.
    await new Promise((resolve) => { setTimeout(resolve, 60); });
    expect(sent.count).toBe(0);

    await component.stop();
    await sync.stop();
    await database.stop();
  });

  it("con credencial drena el outbox en el arranque y reporta el ciclo de vida", async () => {
    const { database, sync } = await runtime();
    sync.store.enqueue(operation(1));
    sync.store.enqueue(operation(2));
    const sent = { count: 0 };
    const report = recorder();

    const component = new CentralSyncComponent(
      () => new SyncDispatcher(sync.store, acceptingTransport(sent), credentials, "https://central.invalid", "1.0.0"),
      scope,
      60_000,
      report,
    );

    await component.start();
    expect(sent.count).toBe(1);
    expect(report.outcomes[0]).toMatchObject({ kind: "DELIVERED", operations: 2, acknowledgedThrough: 2 });
    expect(report.lifecycle.map((entry) => entry.reason)).toEqual(["STARTED"]);
    expect(sync.store.checkpoint(scope)).toBe(2);

    await component.stop();
    await sync.stop();
    await database.stop();
  });

  it("el temporizador vuelve a despachar lo que se encole despues del arranque", async () => {
    const { database, sync } = await runtime();
    const sent = { count: 0 };
    const report = recorder();

    const component = new CentralSyncComponent(
      () => new SyncDispatcher(sync.store, acceptingTransport(sent), credentials, "https://central.invalid", "1.0.0"),
      scope,
      1_000,
      report,
    );

    await component.start();
    // Arranque con el outbox vacio: sonda IDLE, sin trafico.
    expect(report.outcomes).toEqual([{ kind: "IDLE" }]);
    expect(sent.count).toBe(0);

    sync.store.enqueue(operation(1));
    await new Promise((resolve) => { setTimeout(resolve, 1_400); });

    expect(sent.count).toBe(1);
    expect(sync.store.checkpoint(scope)).toBe(1);

    await component.stop();
    await sync.stop();
    await database.stop();
  }, 10_000);

  it("stop espera al despacho en curso antes de ceder", async () => {
    const { database, sync } = await runtime();
    sync.store.enqueue(operation(1));
    const report = recorder();

    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const sent = { count: 0 };
    const accepting = acceptingTransport(sent);
    const slow: CentralTransport = {
      send: async (request) => {
        await gate;
        return accepting.send(request);
      },
    };

    const component = new CentralSyncComponent(
      () => new SyncDispatcher(sync.store, slow, credentials, "https://central.invalid", "1.0.0"),
      scope,
      1_000,
      report,
    );

    const starting = component.start();
    release?.();
    await starting;
    expect(sync.store.checkpoint(scope)).toBe(1);

    await component.stop();
    // Parar es idempotente y no deja nada en vuelo.
    await component.stop();
    await sync.stop();
    await database.stop();
  });
});
