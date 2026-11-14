import { createHash, randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import {
  SyncBatchRequestSchema,
  createCentralDeviceHttpRequestSchema,
  validateCentralDevicePrincipal,
  type SyncBatchRequest,
  type SyncOperation,
} from "@pos-platform/contracts";
import { DurableSyncStore, type SyncScope } from "../src/sync/durable-sync-store.js";
import {
  CentralTransportError,
  type CentralHttpRequest,
  type CentralHttpResponse,
  type CentralTransport,
} from "../src/sync/central-transport.js";
import {
  UnprovisionedDeviceCredentialProvider,
  type DeviceCredentialProvider,
} from "../src/sync/device-credential.js";
import { SyncDispatcher } from "../src/sync/sync-dispatcher.js";

const BASE_URL = "https://central.invalid";
const PROTOCOL = "1.0.0";

const directories: string[] = [];
async function directory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "pos-dispatch-"));
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
    occurred_at_local: "2026-09-14T12:00:00Z",
    recorded_at_local: "2026-09-14T12:00:01Z",
  };
}

const credentials: DeviceCredentialProvider = {
  authorization: () => Promise.resolve("Bearer test-only-device-credential"),
};

/** Envelope de respuesta bien formado a partir de lo que el servidor recibio. */
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
    server_time: "2026-09-14T12:00:05Z",
    result: null,
    ...overrides,
  };
}

function ok(body: Record<string, unknown>, status = 200): CentralHttpResponse {
  return {
    status,
    // Caja mezclada a proposito: HTTP no garantiza minusculas y el cliente no
    // debe depender de ellas.
    headers: {
      "Content-Type": "application/json",
      "X-Pos-Api-Version": PROTOCOL,
      "x-request-id": String(body.request_id),
      "X-Correlation-Id": String(body.correlation_id),
    },
    body: JSON.stringify(body),
  };
}

/**
 * Doble de transporte que **valida la peticion con el mismo esquema con que la
 * validaria la autoridad**. Es lo mas cerca de una prueba de contrato que se
 * puede llegar sin servidor: si el cliente se desvia del contrato, el doble lo
 * rechaza igual que lo haria el servidor.
 */
class ContractCheckingTransport implements CentralTransport {
  readonly seen: CentralHttpRequest[] = [];
  constructor(private readonly respond: (batch: SyncBatchRequest, requestId: string, correlationId: string) => CentralHttpResponse) {}

  send(request: CentralHttpRequest): Promise<CentralHttpResponse> {
    this.seen.push(request);
    const body = JSON.parse(request.body) as Record<string, unknown>;
    const schema = createCentralDeviceHttpRequestSchema(SyncBatchRequestSchema, {
      maxBodyBytes: 4 * 1024 * 1024,
      requireIdempotency: false,
    });
    const parsed = schema.parse({
      contract_headers: request.headers,
      received_body_bytes: Buffer.byteLength(request.body, "utf8"),
      body,
    });
    const principalOk = validateCentralDevicePrincipal(
      { contract_headers: request.headers, received_body_bytes: Buffer.byteLength(request.body, "utf8"), body },
      {
        tenant_id: scope.tenantId,
        device_id: scope.deviceId,
        installation_id: scope.installationId,
        authentication_method: "TEST_ONLY",
      },
      SyncBatchRequestSchema,
      { maxBodyBytes: 4 * 1024 * 1024, requireIdempotency: false },
    );
    if (!principalOk) throw new Error("principal mismatch");
    return Promise.resolve(this.respond(
      parsed.body.payload as SyncBatchRequest,
      String(body.request_id),
      String(body.correlation_id),
    ));
  }
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
      received_at_server: "2026-09-14T12:00:03Z",
      committed_at_server: "2026-09-14T12:00:04Z",
      retryable: false,
      review_required: false,
    })),
  };
}

async function seeded(count: number): Promise<{ database: LocalDatabase; store: DurableSyncStore }> {
  const database = LocalDatabase.open({ dataDirectory: await directory() });
  const store = new DurableSyncStore(database);
  for (let index = 1; index <= count; index += 1) {
    store.enqueue(operation(index, String(index).padStart(2, "0")));
  }
  return { database, store };
}

function statuses(database: LocalDatabase): string[] {
  return (database.native
    .prepare("SELECT status FROM local_sync_outbox ORDER BY local_sequence")
    .all() as { status: string }[]).map((row) => row.status);
}

describe("SyncDispatcher — D-2", () => {
  it("exige https y rechaza cualquier otro origen", async () => {
    const { database, store } = await seeded(0);
    expect(() => new SyncDispatcher(store, new ContractCheckingTransport(() => ok(envelope("x", "y"))), credentials, "http://central.invalid", PROTOCOL))
      .toThrow("https");
    database.close();
  });

  it("normaliza la barra final del origen antes de componer la ruta", async () => {
    const { database, store } = await seeded(1);
    const transport = new ContractCheckingTransport((batch, requestId, correlationId) =>
      ok(envelope(requestId, correlationId, { result: acceptedResult(batch) })));
    const dispatcher = new SyncDispatcher(store, transport, credentials, `${BASE_URL}/`, PROTOCOL);
    await dispatcher.dispatchOnce(scope);

    // Sin normalizar saldria `https://central.invalid//v1/sync/batches`, que un
    // servidor estricto responde con 404.
    expect(transport.seen[0]!.url).toBe("https://central.invalid/v1/sync/batches");
    database.close();
  });

  it("no reclama nada cuando el outbox esta vacio", async () => {
    const { database, store } = await seeded(0);
    const transport = new ContractCheckingTransport((batch, requestId, correlationId) =>
      ok(envelope(requestId, correlationId, { result: acceptedResult(batch) })));
    const dispatcher = new SyncDispatcher(store, transport, credentials, BASE_URL, PROTOCOL);

    expect(await dispatcher.dispatchOnce(scope)).toEqual({ kind: "IDLE" });
    expect(transport.seen).toHaveLength(0);
    database.close();
  });

  it("sin credencial de dispositivo no reclama el lote ni gasta un intento", async () => {
    const { database, store } = await seeded(2);
    const transport = new ContractCheckingTransport((batch, requestId, correlationId) =>
      ok(envelope(requestId, correlationId, { result: acceptedResult(batch) })));
    const dispatcher = new SyncDispatcher(
      store,
      transport,
      new UnprovisionedDeviceCredentialProvider(),
      BASE_URL,
      PROTOCOL,
    );

    const outcome = await dispatcher.dispatchOnce(scope);
    expect(outcome).toEqual({ kind: "NOT_AUTHENTICATED", code: "DEVICE_CREDENTIAL_UNPROVISIONED" });
    expect(transport.seen).toHaveLength(0);
    // Lo decisivo: el lote sigue PENDING, con cero intentos. Reclamar y luego
    // descubrir la falta de credencial habria consumido un intento por tic.
    expect(statuses(database)).toEqual(["PENDING", "PENDING"]);
    expect(store.outboxState(operation(1, "01").operation_id)?.attempt_count).toBe(0);
    database.close();
  });

  it("entrega el lote, asienta el resultado y avanza el checkpoint", async () => {
    const { database, store } = await seeded(3);
    const transport = new ContractCheckingTransport((batch, requestId, correlationId) =>
      ok(envelope(requestId, correlationId, { result: acceptedResult(batch) })));
    const dispatcher = new SyncDispatcher(store, transport, credentials, BASE_URL, PROTOCOL);

    const outcome = await dispatcher.dispatchOnce(scope);
    expect(outcome).toMatchObject({ kind: "DELIVERED", operations: 3, acknowledgedThrough: 3 });
    expect(statuses(database)).toEqual(["ACKNOWLEDGED", "ACKNOWLEDGED", "ACKNOWLEDGED"]);
    expect(store.checkpoint(scope)).toBe(3);
    expect(database.native.prepare("SELECT count(*) AS count FROM local_sync_inbox").get()).toEqual({ count: 3 });

    // Segunda pasada: ya no queda nada elegible.
    expect(await dispatcher.dispatchOnce(scope)).toEqual({ kind: "IDLE" });
    database.close();
  });

  it("acepta application/json con charset UTF-8 emitido por Central y avanza checkpoint", async () => {
    const { database, store } = await seeded(1);
    const transport = new ContractCheckingTransport((batch, requestId, correlationId) => {
      const response = ok(envelope(requestId, correlationId, { result: acceptedResult(batch) }));
      return {
        ...response,
        headers: { ...response.headers, "Content-Type": "application/json; charset=utf-8" },
      };
    });
    const dispatcher = new SyncDispatcher(store, transport, credentials, BASE_URL, PROTOCOL);
    expect(await dispatcher.dispatchOnce(scope))
      .toMatchObject({ kind: "DELIVERED", operations: 1, acknowledgedThrough: 1 });
    expect(store.checkpoint(scope)).toBe(1);
    database.close();
  });

  it("rechaza charset distinto de UTF-8 sin confirmar SQLite", async () => {
    const { database, store } = await seeded(1);
    const transport = new ContractCheckingTransport((batch, requestId, correlationId) => {
      const response = ok(envelope(requestId, correlationId, { result: acceptedResult(batch) }));
      return {
        ...response,
        headers: { ...response.headers, "Content-Type": "application/json; charset=iso-8859-1" },
      };
    });
    const dispatcher = new SyncDispatcher(store, transport, credentials, BASE_URL, PROTOCOL);
    expect(await dispatcher.dispatchOnce(scope))
      .toMatchObject({ kind: "TRANSPORT_FAILED", code: "RESPONSE_CONTRACT_VIOLATION" });
    expect(store.checkpoint(scope)).toBe(0);
    expect(statuses(database)).toEqual(["RETRY_WAIT"]);
    database.close();
  });

  it("envia exactamente lo que el contrato central exige", async () => {
    const { database, store } = await seeded(1);
    const transport = new ContractCheckingTransport((batch, requestId, correlationId) =>
      ok(envelope(requestId, correlationId, { result: acceptedResult(batch) })));
    const dispatcher = new SyncDispatcher(store, transport, credentials, BASE_URL, PROTOCOL);
    await dispatcher.dispatchOnce(scope);

    const sent = transport.seen[0]!;
    expect(sent.method).toBe("POST");
    expect(sent.url).toBe(`${BASE_URL}/v1/sync/batches`);
    expect(sent.headers["content-type"]).toBe("application/json");
    expect(sent.headers["x-pos-device-id"]).toBe(scope.deviceId);
    expect(sent.headers["x-pos-installation-id"]).toBe(scope.installationId);
    expect(sent.headers.authorization).toBe("Bearer test-only-device-credential");
    // Sin idempotencia de envelope: `batch_id` cambia en cada reclamacion, asi
    // que una idempotencia de lote seria falsa. La real viaja por operacion.
    expect(sent.headers["idempotency-key"]).toBeUndefined();
    const body = JSON.parse(sent.body) as Record<string, unknown>;
    expect(body.message_type).toBe("sync.batch.push");
    expect(body.idempotency_key).toBeUndefined();
    expect(body.operation_id).toBeUndefined();
    database.close();
  });

  it("un fallo de conexion devuelve el lote a la cola sin marcarlo enviado", async () => {
    const { database, store } = await seeded(2);
    const transport: CentralTransport = {
      send: () => Promise.reject(new CentralTransportError("nope", "CONNECTION_FAILURE", false)),
    };
    const dispatcher = new SyncDispatcher(store, transport, credentials, BASE_URL, PROTOCOL);

    const outcome = await dispatcher.dispatchOnce(scope);
    expect(outcome).toMatchObject({ kind: "TRANSPORT_FAILED", code: "CONNECTION_FAILURE", sent: false });
    expect(statuses(database)).toEqual(["RETRY_WAIT", "RETRY_WAIT"]);
    const row = store.outboxState(operation(1, "01").operation_id);
    expect(row?.attempt_count).toBe(1);
    expect(row?.next_attempt_at).not.toBeNull();
    expect(store.checkpoint(scope)).toBe(0);
    database.close();
  });

  it("un timeout se registra como enviado y tampoco asienta nada", async () => {
    const { database, store } = await seeded(1);
    const transport: CentralTransport = {
      send: () => Promise.reject(new CentralTransportError("slow", "READ_TIMEOUT", true)),
    };
    const dispatcher = new SyncDispatcher(store, transport, credentials, BASE_URL, PROTOCOL);

    expect(await dispatcher.dispatchOnce(scope))
      .toMatchObject({ kind: "TRANSPORT_FAILED", code: "READ_TIMEOUT", sent: true });
    expect(statuses(database)).toEqual(["RETRY_WAIT"]);
    expect(store.checkpoint(scope)).toBe(0);
    database.close();
  });

  it("una respuesta que no es JSON no asienta nada", async () => {
    const { database, store } = await seeded(1);
    const transport: CentralTransport = {
      send: () => Promise.resolve({ status: 200, headers: { "content-type": "application/json" }, body: "<html>502</html>" }),
    };
    const dispatcher = new SyncDispatcher(store, transport, credentials, BASE_URL, PROTOCOL);

    expect(await dispatcher.dispatchOnce(scope))
      .toMatchObject({ kind: "TRANSPORT_FAILED", code: "RESPONSE_NOT_JSON", sent: true });
    expect(statuses(database)).toEqual(["RETRY_WAIT"]);
    database.close();
  });

  it("una respuesta de otra peticion no se asienta sobre este lote", async () => {
    const { database, store } = await seeded(1);
    const foreign = randomUUID();
    const transport = new ContractCheckingTransport((batch, _requestId, correlationId) =>
      // `request_id` ajeno: coherente consigo misma, pero no es la respuesta a
      // *esta* peticion.
      ok(envelope(foreign, correlationId, { result: acceptedResult(batch) })));
    const dispatcher = new SyncDispatcher(store, transport, credentials, BASE_URL, PROTOCOL);

    expect(await dispatcher.dispatchOnce(scope))
      .toMatchObject({ kind: "TRANSPORT_FAILED", code: "RESPONSE_REQUEST_ID_MISMATCH" });
    expect(statuses(database)).toEqual(["RETRY_WAIT"]);
    expect(store.checkpoint(scope)).toBe(0);
    database.close();
  });

  it("una respuesta que no corresponde al lote se rechaza sin escribir el inbox", async () => {
    const { database, store } = await seeded(1);
    const transport = new ContractCheckingTransport((batch, requestId, correlationId) => {
      const result = acceptedResult(batch);
      return ok(envelope(requestId, correlationId, {
        result: {
          ...result,
          // `correlation_id` cambiado: `validateSyncBatchCorrespondence` lo corta.
          results: result.results.map((item) => ({ ...item, correlation_id: randomUUID() })),
        },
      }));
    });
    const dispatcher = new SyncDispatcher(store, transport, credentials, BASE_URL, PROTOCOL);

    expect(await dispatcher.dispatchOnce(scope))
      .toMatchObject({ kind: "TRANSPORT_FAILED", code: "RESPONSE_CORRESPONDENCE_VIOLATION" });
    expect(statuses(database)).toEqual(["RETRY_WAIT"]);
    expect(database.native.prepare("SELECT count(*) AS count FROM local_sync_inbox").get()).toEqual({ count: 0 });
    database.close();
  });

  it("un rechazo de la autoridad se distingue de un fallo de transporte", async () => {
    const { database, store } = await seeded(1);
    const transport = new ContractCheckingTransport((_batch, requestId, correlationId) =>
      ok(envelope(requestId, correlationId, {
        status: "REJECTED",
        result_code: "SYNC_BATCH_REJECTED",
        result: null,
        error: {
          code: "BATCH_SCHEMA_REJECTED",
          category: "VALIDATION",
          retryable: false,
          user_message_key: "sync.batch.rejected",
          field_errors: [],
          current_version: null,
          required_action: null,
          diagnostic_id: randomUUID(),
        },
      }), 400));
    const dispatcher = new SyncDispatcher(store, transport, credentials, BASE_URL, PROTOCOL);

    expect(await dispatcher.dispatchOnce(scope))
      .toEqual({ kind: "REJECTED", batchId: expect.any(String), code: "BATCH_SCHEMA_REJECTED" });
    expect(statuses(database)).toEqual(["RETRY_WAIT"]);
    expect(store.outboxState(operation(1, "01").operation_id)?.attempt_count).toBe(1);
    database.close();
  });

  it("ninguna rama deja operaciones inmovilizadas en IN_FLIGHT", async () => {
    const transports: ReadonlyArray<readonly [string, CentralTransport]> = [
      ["conexion", { send: () => Promise.reject(new CentralTransportError("x", "CONNECTION_FAILURE", false)) }],
      ["no-json", { send: () => Promise.resolve({ status: 200, headers: {}, body: "{" }) }],
      ["vacia", { send: () => Promise.resolve({ status: 200, headers: {}, body: "{}" }) }],
      ["explota", { send: () => { throw new TypeError("boom"); } }],
    ];

    for (const [label, transport] of transports) {
      const { database, store } = await seeded(2);
      const dispatcher = new SyncDispatcher(store, transport, credentials, BASE_URL, PROTOCOL);
      const outcome = await dispatcher.dispatchOnce(scope);
      expect(outcome.kind, label).toBe("TRANSPORT_FAILED");
      expect(statuses(database), label).not.toContain("IN_FLIGHT");
      expect(store.checkpoint(scope), label).toBe(0);
      database.close();
    }
  });

  it("los reintentos se agotan y la operacion acaba en dead letter, no perdida", async () => {
    const database = LocalDatabase.open({ dataDirectory: await directory() });
    let clock = new Date("2026-09-14T12:00:00Z");
    const store = new DurableSyncStore(
      database,
      { maxAttempts: 3, baseDelayMs: 1_000, maxDelayMs: 1_000 },
      () => clock,
    );
    store.enqueue(operation(1, "01"));

    const transport: CentralTransport = {
      send: () => Promise.reject(new CentralTransportError("down", "CONNECTION_FAILURE", false)),
    };
    const dispatcher = new SyncDispatcher(store, transport, credentials, BASE_URL, PROTOCOL);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const outcome = await dispatcher.dispatchOnce(scope);
      expect(outcome.kind).toBe("TRANSPORT_FAILED");
      clock = new Date(clock.getTime() + 60_000);
    }

    expect(statuses(database)).toEqual(["DEAD_LETTER"]);
    expect(database.native.prepare("SELECT count(*) AS count FROM local_sync_dead_letter").get())
      .toEqual({ count: 1 });
    // Nada se perdio: la operacion sigue completa y es recuperable.
    store.requeueDeadLetter(operation(1, "01").operation_id);
    expect(statuses(database)).toEqual(["PENDING"]);
    database.close();
  });
});
