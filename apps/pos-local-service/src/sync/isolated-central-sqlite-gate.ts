/**
 * Isolated integration fixture called by the Central persistence gate only.
 * Uses the real local SQLite store, SyncDispatcher and FetchCentralTransport.
 * The transport adapter rewrites the synthetic HTTPS origin to loopback HTTP
 * solely inside this lab fixture; no production TLS policy is relaxed.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import { canonicalJson } from "@pos-platform/local-channel";
import type { SyncOperation } from "@pos-platform/contracts";
import { CentralTransportError, type CentralTransport } from "./central-transport.js";
import type { DeviceCredentialProvider } from "./device-credential.js";
import { DurableSyncStore, type SyncScope } from "./durable-sync-store.js";
import { FetchCentralTransport } from "./fetch-central-transport.js";
import { SyncDispatcher } from "./sync-dispatcher.js";

export interface IsolatedSqliteGateInput {
  scope: SyncScope;
  baseUrl: string;
  uuidV7(): string;
  authorization(context: { method: "POST"; path: string; requestId: string; correlationId: string; body: string }): Promise<string>;
}

export interface IsolatedSqliteGateResult {
  operationId: string;
  idempotencyKey: string;
  localCheckpoint: number;
  localInboxRows: number;
}

export async function runIsolatedSqliteGate(input: IsolatedSqliteGateInput): Promise<IsolatedSqliteGateResult> {
  const endpoint = new URL(input.baseUrl);
  if (endpoint.origin !== "http://127.0.0.1:18787" || endpoint.pathname !== "/") {
    throw new Error("ISOLATED_SQLITE_GATE_LOOPBACK_ONLY");
  }
  const directory = mkdtempSync(join(tmpdir(), "camacho-sqlite-central-gate-"));
  const database = LocalDatabase.open({ dataDirectory: directory });
  try {
    let clock = new Date();
    const store = new DurableSyncStore(database, { maxAttempts: 4, baseDelayMs: 1_000, maxDelayMs: 1_000 }, () => clock);
    const payload = { gate: "SQLITE_OUTBOX_CENTRAL", nonce: input.uuidV7() };
    const operationId = input.uuidV7();
    const operation: SyncOperation = {
      operation_id: operationId,
      tenant_id: input.scope.tenantId,
      company_id: input.scope.companyId,
      branch_id: input.scope.branchId,
      device_id: input.scope.deviceId,
      installation_id: input.scope.installationId,
      session_id: input.uuidV7(),
      actor_id: input.uuidV7(),
      aggregate_type: "SYNC_GATE",
      aggregate_id: input.uuidV7(),
      operation_type: "SYNC.TEST",
      authority_policy: "APPEND_ONLY_SHARED",
      local_sequence: 1,
      idempotency_key: `sqlite-sync-gate-${operationId}`,
      expected_version: null,
      payload_schema_version: "1.0.0",
      payload,
      payload_checksum: createHash("sha256").update(canonicalJson(payload)).digest("hex"),
      causation_id: null,
      correlation_id: input.uuidV7(),
      occurred_at_local: clock.toISOString(),
      recorded_at_local: clock.toISOString(),
    };
    if (store.enqueue(operation) !== "ENQUEUED") throw new Error("SQLITE_ENQUEUE_FAILED");

    const credentials: DeviceCredentialProvider = {
      isProvisioned: () => true,
      authorization: input.authorization,
    };
    const http = new FetchCentralTransport();
    let suppressFirstResponse = true;
    const transport: CentralTransport = {
      async send(request) {
        const remote = await http.send({ ...request, url: new URL("/v1/sync/batches", endpoint).toString() });
        if (suppressFirstResponse) {
          suppressFirstResponse = false;
          if (remote.status !== 200) throw new Error(`SQLITE_FIRST_HTTP_STATUS=${remote.status}`);
          // Central committed but the terminal did not receive the response.
          throw new CentralTransportError("lab discarded committed response", "LAB_RESPONSE_LOST_AFTER_COMMIT", true);
        }
        if (remote.status !== 200) {
          let remoteCode = "NON_JSON";
          try {
            const parsed = JSON.parse(remote.body) as { result_code?: string; error?: { code?: string } };
            remoteCode = parsed.error?.code ?? parsed.result_code ?? "UNKNOWN";
          } catch { /* Do not emit entire remote body or device evidence. */ }
          console.error(`LAB_SQLITE_RETRY_HTTP_STATUS=${remote.status} CODE=${remoteCode}`);
        }
        return remote;
      },
    };
    const dispatcher = new SyncDispatcher(store, transport, credentials, "https://central.invalid", "1.0.0");
    const first = await dispatcher.dispatchOnce(input.scope);
    if (first.kind !== "TRANSPORT_FAILED" || first.code !== "LAB_RESPONSE_LOST_AFTER_COMMIT") {
      throw new Error(`SQLITE_RESPONSE_LOSS_NOT_DETECTED:${first.kind}`);
    }
    if (store.checkpoint(input.scope) !== 0 || store.outboxState(operationId)?.status !== "RETRY_WAIT") {
      throw new Error("SQLITE_ADVANCED_CHECKPOINT_BEFORE_ACK");
    }
    clock = new Date(clock.getTime() + 2_000);
    const second = await dispatcher.dispatchOnce(input.scope);
    if (second.kind !== "DELIVERED" || second.acknowledgedThrough !== 1) {
      throw new Error(`SQLITE_RETRY_NOT_DELIVERED:${JSON.stringify(second)}`);
    }
    if (store.checkpoint(input.scope) !== 1 || store.outboxState(operationId)?.status !== "ACKNOWLEDGED") {
      throw new Error("SQLITE_CHECKPOINT_NOT_ACKNOWLEDGED");
    }
    const inbox = database.native.prepare("SELECT count(*) AS count FROM local_sync_inbox WHERE operation_id=?")
      .get(operationId) as { count: number };
    if (inbox.count !== 1) throw new Error("SQLITE_INBOX_NOT_DEDUPLICATED");
    if ((await dispatcher.dispatchOnce(input.scope)).kind !== "IDLE") {
      throw new Error("SQLITE_OUTBOX_NOT_IDLE_AFTER_ACK");
    }
    return { operationId, idempotencyKey: operation.idempotency_key, localCheckpoint: 1, localInboxRows: 1 };
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}
