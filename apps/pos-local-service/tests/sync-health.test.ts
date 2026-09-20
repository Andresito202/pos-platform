import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import type { SyncBatchRequest, SyncOperation } from "@pos-platform/contracts";
import { DurableSyncStore, type SyncScope } from "../src/sync/durable-sync-store.js";
import { SyncHealthReader } from "../src/sync/sync-health.js";

/**
 * Las señales que hacen visible el atasco.
 *
 * `sync-outbox-semantics.test.ts` probó que una dead letter **detiene toda la
 * cola detrás de ella** y que el bloqueo sobrevive al reinicio. Lo que faltaba
 * era que alguien pudiera enterarse: nada medía la profundidad de la cola, la
 * edad de lo más viejo sin confirmar ni la distancia al checkpoint, que son
 * las tres señales que `UC-SYNC-003` §Observabilidad nombra por su nombre.
 *
 * La prueba central de este archivo es justamente ésa: **con la cola
 * bloqueada, las tres señales se mueven en la dirección correcta**. Sin ellas,
 * un comercio puede pasar días sin sincronizar y el POS se ve igual de sano.
 */

const directories: string[] = [];
const databases: LocalDatabase[] = [];
async function directory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "pos-sync-health-"));
  directories.push(value);
  return value;
}
afterEach(() => {
  for (const database of databases.splice(0)) {
    try { database.close(); } catch { /* no debe ocultar el fallo real */ }
  }
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true });
});

const scope: SyncScope = {
  tenantId: "018f0000-0000-7000-8000-000000000001",
  companyId: "018f0000-0000-7000-8000-000000000002",
  branchId: "018f0000-0000-7000-8000-000000000003",
  deviceId: "018f0000-0000-7000-8000-000000000004",
  installationId: "018f0000-0000-7000-8000-000000000005",
};
/** Otro comercio, para comprobar que las señales no se mezclan. */
const otherScope: SyncScope = { ...scope, tenantId: "018f0000-0000-7000-8000-0000000000d1" };

const T0 = new Date("2026-09-20T10:00:00.000Z");

function operation(sequence: number, suffix: string, from: SyncScope = scope): SyncOperation {
  const payload = { sale_id: suffix, total: 1000 + sequence };
  return {
    operation_id: `018f0000-0000-7000-8000-0000000001${suffix}`,
    tenant_id: from.tenantId, company_id: from.companyId, branch_id: from.branchId,
    device_id: from.deviceId, installation_id: from.installationId,
    session_id: "018f0000-0000-7000-8000-000000000006",
    actor_id: "018f0000-0000-7000-8000-000000000007",
    aggregate_type: "SALE", aggregate_id: `018f0000-0000-7000-8000-0000000002${suffix}`,
    operation_type: "SALE_CONFIRM", authority_policy: "LOCAL_AUTHORITATIVE_UNTIL_SYNC",
    local_sequence: sequence, idempotency_key: `sale:${from.tenantId}:${suffix}`,
    expected_version: null, payload_schema_version: "1.0.0", payload,
    payload_checksum: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
    causation_id: null, correlation_id: `018f0000-0000-7000-8000-0000000003${suffix}`,
    occurred_at_local: T0.toISOString(), recorded_at_local: T0.toISOString(),
  } as SyncOperation;
}

function accepted(batch: SyncBatchRequest, acknowledged: number) {
  return {
    batch_id: batch.batch_id, tenant_id: batch.tenant_id, device_id: batch.device_id,
    acknowledged_through_local_sequence: acknowledged,
    results: batch.operations.map((item) => ({
      operation_id: item.operation_id, correlation_id: item.correlation_id,
      server_status: "SERVER_ACCEPTED" as const, server_result_code: "COMMITTED",
      aggregate_id: item.aggregate_id, previous_version: null, new_version: item.local_sequence,
      received_at_server: T0.toISOString(), committed_at_server: T0.toISOString(),
      retryable: false, review_required: false,
    })),
  };
}

async function env(now: () => Date = () => T0) {
  const database = LocalDatabase.open({ dataDirectory: await directory() });
  databases.push(database);
  return {
    database,
    store: new DurableSyncStore(database, { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 1 }, now),
    health: new SyncHealthReader(database, now),
  };
}

describe("señales de sincronización — la cola deja de ser invisible", () => {
  it("una cola vacía no reporta edad cero, reporta ausencia", async () => {
    const { health } = await env();
    const snapshot = health.read(scope);
    expect(snapshot.outboxDepth).toBe(0);
    // `null` y no `0`: cero significaría «hay algo recién encolado».
    expect(snapshot.oldestPendingAgeMs).toBeNull();
    expect(snapshot.checkpointLag).toBe(0);
  });

  it("mide profundidad, edad de lo más antiguo y distancia al checkpoint", async () => {
    // El reloj avanza diez minutos entre encolar y medir.
    let clock = T0;
    const { store, health } = await env(() => clock);
    store.enqueue(operation(1, "01"));
    clock = new Date(T0.getTime() + 60_000);
    store.enqueue(operation(2, "02"));
    clock = new Date(T0.getTime() + 600_000);

    const snapshot = health.read(scope);
    expect(snapshot.outboxDepth).toBe(2);
    expect(snapshot.pending).toBe(2);
    // La edad es la de la **más antigua**, no la de la última.
    expect(snapshot.oldestPendingAgeMs).toBe(600_000);
    expect(snapshot.highestLocalSequence).toBe(2);
    expect(snapshot.checkpointSequence).toBe(0);
    expect(snapshot.checkpointLag).toBe(2);
  });

  it("confirmar baja la profundidad y cierra la distancia al checkpoint", async () => {
    const { store, health } = await env();
    store.enqueue(operation(1, "01"));
    store.enqueue(operation(2, "02"));
    const batch = store.claimBatch(scope, 10);
    store.recordResponse(batch as NonNullable<typeof batch>, accepted(batch as SyncBatchRequest, 2));

    const snapshot = health.read(scope);
    expect(snapshot.outboxDepth).toBe(0);
    expect(snapshot.oldestPendingAgeMs).toBeNull();
    expect(snapshot.checkpointSequence).toBe(2);
    expect(snapshot.checkpointLag).toBe(0);
    expect(snapshot.verdicts.serverAccepted).toBe(2);
  });

  // ── La prueba que da sentido a todo el archivo ──────────────────────────
  it("con la cola bloqueada por una dead letter, las tres señales lo gritan", async () => {
    let clock = T0;
    const { store, health } = await env(() => clock);
    store.enqueue(operation(1, "01"));
    store.enqueue(operation(2, "02"));
    store.enqueue(operation(3, "03"));

    // La primera agota su único intento y queda en dead letter.
    const batch = store.claimBatch(scope, 1);
    store.recordTransportFailure(batch as NonNullable<typeof batch>, "NETWORK_DOWN");
    expect(store.claimBatch(scope, 10)).toBeNull();

    // Pasa un día entero sin que nada suba.
    clock = new Date(T0.getTime() + 24 * 60 * 60_000);
    const stuck = health.read(scope);

    expect(stuck.deadLetter).toBe(1);
    // Nada se confirmó: las tres operaciones siguen contando.
    expect(stuck.outboxDepth).toBe(3);
    // Un día de antigüedad, que es el número que un operador reconoce.
    expect(stuck.oldestPendingAgeMs).toBe(24 * 60 * 60_000);
    // Y el checkpoint no se movió: la distancia es todo lo encolado.
    expect(stuck.checkpointSequence).toBe(0);
    expect(stuck.checkpointLag).toBe(3);

    // Liberar la cabeza de línea vuelve a permitir avanzar, y las señales lo
    // reflejan en cuanto el central confirma.
    store.requeueDeadLetter(operation(1, "01").operation_id);
    const resumed = store.claimBatch(scope, 10);
    store.recordResponse(resumed as NonNullable<typeof resumed>, accepted(resumed as SyncBatchRequest, 3));

    const healthy = health.read(scope);
    expect(healthy.outboxDepth).toBe(0);
    expect(healthy.deadLetter).toBe(0);
    expect(healthy.checkpointLag).toBe(0);
    expect(healthy.oldestPendingAgeMs).toBeNull();
  });

  it("un reintento programado se distingue de un atasco definitivo", async () => {
    const { store, health } = await env();
    // Política con margen: el primer fallo programa reintento, no agota.
    const database = (await env()).database;
    const generous = new DurableSyncStore(
      database, { maxAttempts: 5, baseDelayMs: 1_000, maxDelayMs: 60_000 }, () => T0,
    );
    const reader = new SyncHealthReader(database, () => T0);
    generous.enqueue(operation(1, "01"));
    const batch = generous.claimBatch(scope, 10);
    generous.recordTransportFailure(batch as NonNullable<typeof batch>, "CONNECTION_RESET");

    const snapshot = reader.read(scope);
    expect(snapshot.retryWaiting).toBe(1);
    expect(snapshot.deadLetter).toBe(0);
    expect(snapshot.outboxDepth).toBe(1);

    // Y con la política agotadiza, el mismo fallo es dead letter.
    store.enqueue(operation(1, "01"));
    const strict = store.claimBatch(scope, 10);
    store.recordTransportFailure(strict as NonNullable<typeof strict>, "CONNECTION_RESET");
    expect(health.read(scope).deadLetter).toBe(1);
  });

  it("las señales de un comercio no incluyen las de otro", async () => {
    const { store, health } = await env();
    store.enqueue(operation(1, "01"));
    store.enqueue(operation(2, "02"));
    store.enqueue(operation(1, "0a", otherScope));

    expect(health.read(scope).outboxDepth).toBe(2);
    expect(health.read(otherScope).outboxDepth).toBe(1);
    expect(health.read(otherScope).highestLocalSequence).toBe(1);
  });

  it("los veredictos se cuentan donde viven, y los que el outbox no representa también", async () => {
    const { store, database, health } = await env();
    store.enqueue(operation(1, "01"));
    const batch = store.claimBatch(scope, 10) as SyncBatchRequest;
    // `REVIEW_REQUIRED` no existe en el `CHECK` del outbox —cinco estados— y
    // sí en el del inbox. Contarlo como veredicto recibido es lo único
    // honesto: es lo que de verdad hay.
    store.recordResponse(batch, {
      batch_id: batch.batch_id, tenant_id: batch.tenant_id, device_id: batch.device_id,
      acknowledged_through_local_sequence: null,
      results: batch.operations.map((item) => ({
        operation_id: item.operation_id, correlation_id: item.correlation_id,
        server_status: "REVIEW_REQUIRED" as const, server_result_code: "MANUAL_REVIEW",
        aggregate_id: item.aggregate_id, previous_version: null, new_version: null,
        received_at_server: T0.toISOString(), committed_at_server: T0.toISOString(),
        retryable: false, review_required: true,
      })),
    });

    const snapshot = health.read(scope);
    expect(snapshot.verdicts.reviewRequired).toBe(1);
    expect(snapshot.verdicts.serverAccepted).toBe(0);
    // Y el checkpoint no avanzó sobre una revisión pendiente.
    expect(snapshot.checkpointSequence).toBe(0);
    expect((database.native.prepare(
      "SELECT COUNT(*) AS n FROM local_sync_inbox",
    ).get() as { n: number }).n).toBe(1);
  });
});
