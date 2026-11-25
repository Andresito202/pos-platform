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
import { SyncOperationSchema, type SyncOperation } from "@pos-platform/contracts";
import { existsSync } from "node:fs";
import { repairLegacySaleOutbox } from "./outbox-recovery-repair.js";
import { SqliteCatalogStore } from "../catalog/sqlite-catalog-store.js";
import { SqliteInventoryStore } from "../inventory/sqlite-inventory-store.js";
import { SqliteCashShiftStore } from "../cash/sqlite-cash-shift-store.js";
import { SqliteSaleStore } from "../sales/sqlite-sale-store.js";
import { CreateSaleUseCase } from "../sales/create-sale-use-case.js";
import { CentralTransportError, type CentralTransport } from "./central-transport.js";
import type { DeviceCredentialProvider } from "./device-credential.js";
import { DurableSyncStore, type SyncScope } from "./durable-sync-store.js";
import { FetchCentralTransport } from "./fetch-central-transport.js";
import { SyncDispatcher } from "./sync-dispatcher.js";

export interface IsolatedSqliteGateInput {
  scope: SyncScope;
  baseUrl: string;
  uuidV7(): string;
  withCentralExclusion(operation: SyncOperation, apply: (observation: "NOT_OBSERVED" | "ALREADY_ACCEPTED" | "CONFLICT_OR_REVIEW_REQUIRED") => void): Promise<void>;
  authorization(context: { method: "POST"; path: string; requestId: string; correlationId: string; body: string }): Promise<string>;
}

export interface IsolatedSqliteGateResult {
  operationId: string;
  idempotencyKey: string;
  saleId: string;
  payableAmount: string;
  calculationChecksum: string;
  localCheckpoint: number;
  localInboxRows: number;
  recoveredInterruptedDispatches: number;
}

export async function runIsolatedSqliteGate(input: IsolatedSqliteGateInput): Promise<IsolatedSqliteGateResult> {
  const endpoint = new URL(input.baseUrl);
  if (endpoint.origin !== "http://127.0.0.1:18787" || endpoint.pathname !== "/") {
    throw new Error("ISOLATED_SQLITE_GATE_LOOPBACK_ONLY");
  }
  const directory = mkdtempSync(join(tmpdir(), "camacho-sqlite-central-gate-"));
  let database = LocalDatabase.open({ dataDirectory: directory });
  try {
    let clock = new Date();
    const policy = { maxAttempts: 4, baseDelayMs: 1_000, maxDelayMs: 1_000, jitterRatio: 0.2 };
    let store = new DurableSyncStore(database, policy, () => clock);
    // Seed only catalog inputs; the actual commercial use case produces the
    // sale, calculation, runtime operation, audit and outbox atomically.
    const productId = input.uuidV7();
    const presentationId = input.uuidV7();
    const actorId = input.uuidV7();
    const sessionId = input.uuidV7();
    const correlationId = input.uuidV7();
    const at = clock.toISOString();
    const scope = input.scope;
    database.native.prepare(`INSERT INTO catalog_product(
      id,tenant_id,company_id,code,name,status,stock_controlled,registered_by_actor_id,
      idempotency_key,correlation_id,version,created_at,updated_at)
      VALUES (?,?,?,'SYNC-GATE-PRODUCT','Gate product','ACTIVE',0,?,?,?,1,?,?)`)
      .run(productId,scope.tenantId,scope.companyId,actorId,`catalog-${productId}`,correlationId,at,at);
    database.native.prepare(`INSERT INTO catalog_presentation(
      id,tenant_id,product_id,name,unit_code,unit_precision,barcode,status,created_at,updated_at)
      VALUES (?,?,?,'Unit','UND',0,NULL,'ACTIVE',?,?)`)
      .run(presentationId,scope.tenantId,productId,at,at);
    database.native.prepare(`INSERT INTO catalog_price(
      id,tenant_id,presentation_id,amount,currency_code,status,created_at,updated_at)
      VALUES (?,?,?,'1025.000000','COP','ACTIVE',?,?)`)
      .run(input.uuidV7(),scope.tenantId,presentationId,at,at);
    const now = () => clock;
    const saleUseCase = new CreateSaleUseCase(
      new SqliteCatalogStore(database,store),
      new SqliteInventoryStore(database,store,now),
      new SqliteCashShiftStore(database,store,now),
      new SqliteSaleStore(database,store,now),now,
    );
    const validUntil = new Date(clock.getTime()+3600000).toISOString();
    const sale = saleUseCase.execute(scope,sessionId,{
      claims: { snapshot_id:input.uuidV7(),user_id:actorId,installation_id:scope.installationId,
        device_id:scope.deviceId,sequence:1,issued_at:at,expires_at:validUntil,key_id:"LAB_AUTHZ",
        assignments:[{tenant_id:scope.tenantId,company_id:scope.companyId,branch_id:scope.branchId,
          status:"ACTIVE",valid_from:at,valid_until:validUntil,role_status:"ACTIVE",
          permissions:[{code:"SALES_SALE_CREATE",status:"ACTIVE"}]}] },
      signature:"isolated-fixture",activatedAt:at,
    },{
      cashRegisterId:null,idempotencyKey:`sqlite-sync-gate-${correlationId}`,
      channel:"POS_LOCAL",businessDate:at.slice(0,10),timezoneId:"America/Bogota",
      utcOffsetMinutes:-300,documentSeries:"GATE-001",currencyCode:"COP",
      correlationId,causationId:null,
      lines:[{productId,presentationId,quantity:"1.000000"}],
    });
    if (sale.kind !== "CREATED" || sale.payableAmount !== "1050.000000") {
      throw new Error(`SQLITE_COMMERCIAL_SALE_FAILED:${sale.kind}`);
    }
    const row = database.native.prepare("SELECT operation_json FROM local_sync_outbox WHERE operation_type='SALE_CREATED'")
      .get() as {operation_json:string};
    const operation = SyncOperationSchema.parse(JSON.parse(row.operation_json));
    const operationId = operation.operation_id;
    if (operation.aggregate_id !== sale.saleId || operation.local_sequence !== 1
      || operation.payload_checksum !== createHash("sha256").update(canonicalJson(operation.payload)).digest("hex")) {
      throw new Error("SQLITE_COMMERCIAL_OUTBOX_INVALID");
    }
    // Persist offline first and reopen before any network activity.
    database.close();
    database = LocalDatabase.open({dataDirectory:directory});
    store = new DurableSyncStore(database,policy,now);

    // Reproduce the historical writer defect using the actual request checksum.
    const request = database.native.prepare("SELECT request_checksum FROM sales_sales WHERE id=?")
      .get(sale.saleId) as {request_checksum:string};
    database.native.prepare("UPDATE local_sync_outbox SET operation_json=?,payload_checksum=? WHERE operation_id=?")
      .run(canonicalJson({...operation,payload_checksum:request.request_checksum}),request.request_checksum,operationId);
    const snapshot = () => canonicalJson(database.native.prepare("SELECT * FROM local_sync_outbox WHERE operation_id=?").get(operationId));
    const originalSnapshot = snapshot();
    const expectRejected = async (run: () => Promise<unknown>, code: string) => {
      let rejected = false;
      try { await run(); } catch (error) {
        if (!(error instanceof Error) || !error.message.includes(code)) throw error;
        rejected = true;
      }
      if (!rejected || snapshot() !== originalSnapshot || store.checkpoint(scope) !== 0) {
        throw new Error("SQLITE_RECOVERY_NEGATIVE_MUTATED_STATE:" + code);
      }
    };
    // Exercise refusal paths independently of the successful Central integration.
    for (const observation of ["ALREADY_ACCEPTED","CONFLICT_OR_REVIEW_REQUIRED"] as const) {
      await expectRejected(() => repairLegacySaleOutbox(database,scope,operationId,async (_op,apply) => {
        apply(observation);
      }),"SYNC_RECOVERY_CENTRAL_REVIEW_REQUIRED");
    }
    await expectRejected(() => repairLegacySaleOutbox(database, {...scope,companyId:input.uuidV7()},
      operationId,input.withCentralExclusion),"SYNC_RECOVERY_EVIDENCE_REQUIRED");
    // A failure in the append-only audit must roll back the checksum update.
    database.native.exec(`CREATE TEMP TRIGGER recovery_gate_audit_failure BEFORE INSERT ON local_operation_audit
      WHEN NEW.action_code='SYNC_OUTBOX_CHECKSUM_REPAIRED'
      BEGIN SELECT RAISE(ABORT,'RECOVERY_GATE_AUDIT_FAILURE'); END;`);
    try {
      await expectRejected(() => repairLegacySaleOutbox(database,scope,operationId,input.withCentralExclusion),
        "RECOVERY_GATE_AUDIT_FAILURE");
    } finally {
      database.native.exec("DROP TRIGGER recovery_gate_audit_failure");
    }
    console.log("SQLITE_RECOVERY_REFUSAL_AND_ROLLBACK=VERIFIED");
    const repair = await repairLegacySaleOutbox(database,scope,operationId,input.withCentralExclusion);
    if (!existsSync(repair.backupPath) || store.checkpoint(scope) !== 0) throw new Error("SQLITE_RECOVERY_BACKUP_OR_CHECKPOINT_INVALID");
    const repaired = database.native.prepare("SELECT operation_json,payload_checksum,status FROM local_sync_outbox WHERE operation_id=?")
      .get(operationId) as {operation_json:string;payload_checksum:string;status:string};
    if (repaired.operation_json !== canonicalJson(operation) || repaired.payload_checksum !== operation.payload_checksum
      || repaired.status !== "PENDING") throw new Error("SQLITE_RECOVERY_CONTENT_CHANGED");
    const audit = database.native.prepare("SELECT count(*) AS count FROM local_operation_audit WHERE action_code='SYNC_OUTBOX_CHECKSUM_REPAIRED' AND resource_id=?")
      .get(operationId) as {count:number};
    if (audit.count !== 1) throw new Error("SQLITE_RECOVERY_AUDIT_MISSING");
    console.log("SQLITE_LEGACY_REPAIR_WITH_CENTRAL_EXCLUSION=VERIFIED");

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
    let dispatcher = new SyncDispatcher(store, transport, credentials, "https://central.invalid", "1.0.0");
    const first = await dispatcher.dispatchOnce(input.scope);
    if (first.kind !== "TRANSPORT_FAILED" || first.code !== "LAB_RESPONSE_LOST_AFTER_COMMIT") {
      throw new Error(`SQLITE_RESPONSE_LOSS_NOT_DETECTED:${first.kind}`);
    }
    if (store.checkpoint(input.scope) !== 0 || store.outboxState(operationId)?.status !== "RETRY_WAIT") {
      throw new Error("SQLITE_ADVANCED_CHECKPOINT_BEFORE_ACK");
    }
    // Simulate a crash after claiming the retry, before any second HTTP send.
    // Closing and reopening the actual SQLite database preserves IN_FLIGHT.
    clock = new Date(clock.getTime() + 2_000);
    const interrupted = store.claimBatch(input.scope, 100);
    if (!interrupted || store.outboxState(operationId)?.status !== "IN_FLIGHT") {
      throw new Error("SQLITE_INTERRUPTED_CLAIM_NOT_IN_FLIGHT");
    }
    database.close();
    database = LocalDatabase.open({ dataDirectory: directory });
    store = new DurableSyncStore(database, policy, () => clock);
    if (store.checkpoint(input.scope) !== 0 || store.outboxState(operationId)?.status !== "IN_FLIGHT") {
      throw new Error("SQLITE_RESTART_LOST_IN_FLIGHT");
    }
    const recoveredInterruptedDispatches = store.recoverInterruptedDispatches();
    if (recoveredInterruptedDispatches !== 1 || store.outboxState(operationId)?.status !== "RETRY_WAIT") {
      throw new Error("SQLITE_RESTART_RECOVERY_FAILED");
    }
    dispatcher = new SyncDispatcher(store, transport, credentials, "https://central.invalid", "1.0.0");
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
    const persistedSale = database.native.prepare("SELECT payable_amount,calculation_checksum FROM sales_sales WHERE id=?")
      .get(sale.saleId) as {payable_amount:string;calculation_checksum:string};
    if (persistedSale.payable_amount !== sale.payableAmount || persistedSale.calculation_checksum !== sale.calculationChecksum) {
      throw new Error("SQLITE_COMMERCIAL_TOTAL_CHANGED");
    }
    return { operationId, idempotencyKey: operation.idempotency_key, saleId: sale.saleId,
      payableAmount: sale.payableAmount, calculationChecksum: sale.calculationChecksum,
      localCheckpoint: 1, localInboxRows: 1, recoveredInterruptedDispatches };
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}
