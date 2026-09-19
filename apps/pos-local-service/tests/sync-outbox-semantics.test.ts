import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import type { SyncOperation } from "@pos-platform/contracts";
import { DurableSyncStore, type SyncScope } from "../src/sync/durable-sync-store.js";

/**
 * Las tres propiedades operativas del outbox que nadie estaba sosteniendo.
 *
 * ## Qué cubre `sync-store.test.ts` y qué faltaba
 *
 * Aquel fichero prueba idempotencia, contigüidad, checkpoint monótono,
 * recuperación de envíos interrumpidos y reintentos acotados. Lo que no
 * probaba nadie, y es lo que decide si un comercio pierde ventas:
 *
 * 1. **Atomicidad.** El asiento de outbox vive en la transacción del negocio.
 *    `sqlite-sale-store.ts` lo escribe como paso 7 dentro del mismo
 *    `transaction()` que crea la venta, y `DurableSyncStore.enqueue` abre su
 *    propia transacción anidada. Que eso funcione depende de que
 *    better-sqlite3 anide por `SAVEPOINT`: si no lo hiciera, una venta
 *    revertida dejaría un evento huérfano anunciando al central una venta que
 *    nunca existió.
 * 2. **Orden estricto y bloqueo de cabeza de línea.** `claimBatch` exige
 *    `local_sequence` contigua desde el checkpoint. La consecuencia —una
 *    operación en `DEAD_LETTER` **detiene toda la cola detrás de ella**— es
 *    correcta según `DEC-007`, que no admite reordenar, y su única salida es
 *    `requeueDeadLetter`, la revisión manual que exige `UC-SYNC-003`. Pero
 *    nadie lo había escrito, y es la diferencia entre «hay un evento atascado»
 *    y «desde ayer no sube ni una venta».
 * 3. **Un fallo de transporte no pierde nada.** El evento sigue en disco con
 *    su payload intacto.
 *
 * Ninguna de las tres exige decidir nada: son propiedades del código que ya
 * está en `main`. Lo que sí sigue sin decidirse —la **duración** de la
 * retención (`DEC-007` §100 punto 11)— no se toca aquí.
 */

const directories: string[] = [];
async function directory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "pos-outbox-"));
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

function operation(sequence: number, suffix: string): SyncOperation {
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
    idempotency_key: `sale:${suffix}`,
    expected_version: null,
    payload_schema_version: "1.0.0",
    payload,
    payload_checksum: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
    causation_id: null,
    correlation_id: `018f0000-0000-7000-8000-0000000003${suffix}`,
    occurred_at_local: "2026-08-28T20:00:00Z",
    recorded_at_local: "2026-08-28T20:00:01Z",
  } as SyncOperation;
}

function outboxCount(database: LocalDatabase): number {
  return (database.native.prepare(
    "SELECT COUNT(*) AS n FROM local_sync_outbox",
  ).get() as { n: number }).n;
}

// ── A · Atomicidad ───────────────────────────────────────────────────────────

describe("atomicidad — el evento vive y muere con la operación de negocio", () => {
  it("una operación de negocio revertida no deja evento en el outbox", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    const store = new DurableSyncStore(database);

    // La forma exacta de `sqlite-sale-store.ts`: escritura de negocio, luego
    // `enqueue`, todo dentro de una transacción del llamador. Aquí el negocio
    // falla después de encolar, que es el caso peligroso.
    const business = database.native.transaction(() => {
      store.enqueue(operation(1, "01"));
      throw new Error("la regla de negocio rechazó la operación");
    });

    expect(() => { business(); }).toThrow("la regla de negocio rechazó");

    // Sin esto, el central recibiría el anuncio de una venta que no existe.
    expect(outboxCount(database)).toBe(0);
    database.close();
  });

  it("y una que confirma deja exactamente uno, en la misma transacción", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    const store = new DurableSyncStore(database);

    const business = database.native.transaction(() => {
      store.enqueue(operation(1, "01"));
      return "COMMITTED";
    });

    expect(business()).toBe("COMMITTED");
    expect(outboxCount(database)).toBe(1);
    expect(store.outboxState(operation(1, "01").operation_id)?.status).toBe("PENDING");
    database.close();
  });
});

// ── B · Orden y cabeza de línea ──────────────────────────────────────────────

describe("orden — una dead letter detiene la cola, y sólo la revisión la reanuda", () => {
  it("nada detrás de una dead letter se envía, y tras reencolar el orden es exacto", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    // Un solo intento: el primer fallo de transporte agota la política.
    const store = new DurableSyncStore(database, { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 1 });

    store.enqueue(operation(1, "01"));
    store.enqueue(operation(2, "02"));
    store.enqueue(operation(3, "03"));

    const first = store.claimBatch(scope, 1);
    expect(first?.operations.map((item) => item.local_sequence)).toEqual([1]);

    store.recordTransportFailure(first as NonNullable<typeof first>, "NETWORK_DOWN");
    expect(store.outboxState(operation(1, "01").operation_id)?.status).toBe("DEAD_LETTER");

    // Aquí está la propiedad que importa: 2 y 3 están sanas y PENDING, y aun
    // así no sale nada. `DEC-007` no admite reordenar, de modo que saltarse la
    // 1 para enviar la 2 sería una violación, no una optimización.
    expect(store.outboxState(operation(2, "02").operation_id)?.status).toBe("PENDING");
    expect(store.claimBatch(scope, 10)).toBeNull();

    // La única salida es la revisión manual de `UC-SYNC-003`.
    store.requeueDeadLetter(operation(1, "01").operation_id);
    const resumed = store.claimBatch(scope, 10);
    expect(resumed?.operations.map((item) => item.local_sequence)).toEqual([1, 2, 3]);

    database.close();
  });

  it("el bloqueo sobrevive al reinicio: no se desatasca solo", async () => {
    const dataDirectory = await directory();
    const database = LocalDatabase.open({ dataDirectory });
    const store = new DurableSyncStore(database, { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 1 });

    store.enqueue(operation(1, "01"));
    store.enqueue(operation(2, "02"));
    const claimed = store.claimBatch(scope, 1);
    store.recordTransportFailure(claimed as NonNullable<typeof claimed>, "NETWORK_DOWN");
    database.close();

    // Otro proceso, misma base. `recoverInterruptedDispatches` sólo rescata
    // `IN_FLIGHT`; una dead letter no es un envío interrumpido y no se toca.
    const reopened = LocalDatabase.open({ dataDirectory });
    const restarted = new DurableSyncStore(reopened, { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 1 });
    expect(restarted.recoverInterruptedDispatches()).toBe(0);
    expect(restarted.outboxState(operation(1, "01").operation_id)?.status).toBe("DEAD_LETTER");
    expect(restarted.claimBatch(scope, 10)).toBeNull();
    reopened.close();
  });
});

// ── C · El transporte falla y no se pierde nada ──────────────────────────────

describe("transporte — un fallo deja el evento intacto y reintentable", () => {
  it("el payload sobrevive al fallo y al reinicio, byte a byte", async () => {
    const dataDirectory = await directory();
    const database = LocalDatabase.open({ dataDirectory });
    const store = new DurableSyncStore(database, { maxAttempts: 5, baseDelayMs: 1_000, maxDelayMs: 60_000 });

    const original = operation(1, "01");
    store.enqueue(original);
    const before = store.outboxState(original.operation_id);

    const batch = store.claimBatch(scope, 10);
    expect(batch?.operations).toHaveLength(1);
    store.recordTransportFailure(batch as NonNullable<typeof batch>, "CONNECTION_RESET");

    const after = store.outboxState(original.operation_id);
    expect(after?.status).toBe("RETRY_WAIT");
    // Ni el contenido ni el orden se tocan cuando falla el transporte: lo
    // único que cambia es cuándo se vuelve a intentar.
    expect(after?.operation_json).toBe(before?.operation_json);
    expect(after?.local_sequence).toBe(before?.local_sequence);
    expect(after?.attempt_count).toBe(1);
    expect(after?.next_attempt_at).not.toBeNull();
    expect(outboxCount(database)).toBe(1);
    database.close();

    // Y sigue ahí tras el reinicio, sin duplicarse.
    const reopened = LocalDatabase.open({ dataDirectory });
    const restarted = new DurableSyncStore(reopened);
    expect(outboxCount(reopened)).toBe(1);
    expect(restarted.outboxState(original.operation_id)?.operation_json).toBe(before?.operation_json);
    reopened.close();
  });

  it("agotar los intentos deja dead letter con su evidencia, no un borrado", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    const store = new DurableSyncStore(database, { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 1 });

    const original = operation(1, "01");
    store.enqueue(original);
    const batch = store.claimBatch(scope, 10);
    store.recordTransportFailure(batch as NonNullable<typeof batch>, "CONNECTION_RESET");

    // `UC-SYNC-003`: una dead letter no se elimina automáticamente. El evento
    // sigue en el outbox y además deja asiento propio con su motivo.
    expect(outboxCount(database)).toBe(1);
    const deadLetter = database.native.prepare(
      "SELECT reason_code, attempts, recovered_at FROM local_sync_dead_letter WHERE operation_id=?",
    ).get(original.operation_id) as { reason_code: string; attempts: number; recovered_at: string | null };
    expect(deadLetter.reason_code).toBe("CONNECTION_RESET");
    expect(deadLetter.attempts).toBe(1);
    expect(deadLetter.recovered_at).toBeNull();
    database.close();
  });
});
