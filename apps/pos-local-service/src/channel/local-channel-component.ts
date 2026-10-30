import { randomUUID } from "node:crypto";
import {
  compareContractVersions,
  negotiateProtocolVersion,
  type ContractError,
  type IpcRequest,
  type WindowsScmHandoffProvision,
} from "@pos-platform/contracts";
import type { RuntimeComponent, RuntimeState } from "../lifecycle.js";
import type { LocalDatabaseComponent } from "../local-database-component.js";
import type { ServiceConfig } from "../config.js";
import type { OperationConfirmationComponent } from "../operations/operation-confirmation-component.js";
import type { CommercialComponent } from "../commercial/commercial-component.js";
import { CommercialRequestHandler } from "../commercial/commercial-request-handler.js";
import { LocalChannelAuthenticator, localChannelEndpoint } from "@pos-platform/local-channel";
import { SqliteReplayStateStore } from "./sqlite-replay-state.js";
import { LocalChannelServer, type ChannelRequestContext } from "./server.js";
import { loadOrCreateWindowsLocalChannelSecret } from "./secret.js";
import type {NativeCommercialCoordinator} from "../security/native-commercial-coordinator.js";
import {WindowsScmChannelTransport} from "./windows-scm-transport.js";

const LOCAL_SCHEMA_VERSION = "5";
const RESULT_SCHEMA_VERSION = "1.0.0";

function incompatibleStatus(
  request: Extract<IpcRequest, { message_type: "runtime.handshake" }>,
  config: ServiceConfig,
): "UPDATE_DESKTOP_REQUIRED" | "UPDATE_SERVICE_REQUIRED" {
  return compareContractVersions(request.payload.protocol_max, config.protocol_min) < 0
    ? "UPDATE_DESKTOP_REQUIRED"
    : "UPDATE_SERVICE_REQUIRED";
}

export class LocalChannelComponent implements RuntimeComponent {
  readonly name = "local-channel";
  readonly endpoint: string;

  private server: LocalChannelServer | undefined;
  private authenticator: LocalChannelAuthenticator | undefined;
  private unregisterSessionCloser:(()=>void)|undefined;
  private startupToken: symbol | undefined;
  private starting:Promise<void>|undefined;
  private stopping:Promise<void>|undefined;
  private stoppedResult:Promise<void>|undefined;
  private closeActive:(()=>Promise<void>)|undefined;
  private readonly commercialHandler: CommercialRequestHandler;

  constructor(
    private readonly config: ServiceConfig,
    private readonly localDatabase: LocalDatabaseComponent,
    private readonly runtimeState: () => RuntimeState,
    private readonly operationConfirmation: OperationConfirmationComponent,
    private readonly commercial: CommercialComponent,
    private readonly nativeCommercial?:Pick<NativeCommercialCoordinator,"handle"|"release"|"stop"> & {recovered?:(connectionId:string)=>void},
    private readonly scmProvision?:WindowsScmHandoffProvision,
  ) {
    this.commercialHandler = new CommercialRequestHandler(config, commercial);
    this.endpoint = localChannelEndpoint(config.installation_id);
  }

  async start(): Promise<void> {
    if(this.server||this.authenticator||this.unregisterSessionCloser||this.startupToken||this.starting||this.stopping||this.closeActive)throw Error("LOCAL_CHANNEL_ALREADY_STARTED");
    this.stoppedResult=undefined;
    const operation=this.startAttempt();this.starting=operation;
    try{await operation;}finally{if(this.starting===operation)this.starting=undefined;}
  }

  private async startAttempt():Promise<void>{
    if (process.platform !== "win32") {
      throw new Error("production local channel requires Windows");
    }

    const secret = loadOrCreateWindowsLocalChannelSecret(
      this.config.data_directory,
      this.config.installation_id,
    );
    const authenticator = new LocalChannelAuthenticator(secret, undefined, {
      replayStateStore: new SqliteReplayStateStore(this.localDatabase.database),
    });
    let scmTransport:WindowsScmChannelTransport|undefined;
    try{if(this.scmProvision)scmTransport=new WindowsScmChannelTransport(this.scmProvision,this.localDatabase.database,secret);}
    catch(error){authenticator.destroy();throw error;}
    finally{secret.fill(0);}

    const server = new LocalChannelServer(
      this.endpoint,
      authenticator,
      (request, signal, context) => this.handle(request, signal, context),
      { min: this.config.protocol_min, max: this.config.protocol_max },
      undefined,
      undefined,
      undefined,
      // El cierre de la conexión invalida su vínculo de sesión (`DEC-015` §5.6).
      (connectionId) => {try{this.commercial.bindings.release(connectionId);}finally{this.nativeCommercial?.release(connectionId);}},
      scmTransport,
    );

    const startupToken=Symbol("local-channel-start");
    this.startupToken=startupToken;
    let unregister:(()=>void)|undefined;
    let cleanup:Promise<void>|undefined;
    // One attempt owns these resources, including while start() is pending.
    // Cache cleanup before running callbacks so repeated/reentrant stops join it.
    const close=():Promise<void>=>cleanup??=(Promise.resolve().then(async()=>{
      const failures:unknown[]=[];
      try{unregister?.();}catch(error){failures.push(error);}
      finally{if(this.unregisterSessionCloser===unregister)this.unregisterSessionCloser=undefined;}
      try{await server.stop();}catch(error){failures.push(error);}
      finally{
        authenticator.destroy();
        if(this.server===server){this.server=undefined;this.authenticator=undefined;}
        if(failures.length===0&&this.closeActive===close)this.closeActive=undefined;
        if(this.startupToken===startupToken)this.startupToken=undefined;
      }
      if(failures.length===1)throw failures[0];
      if(failures.length>1)throw new AggregateError(failures,"local channel cleanup failed");
    }));
    this.server=server;this.authenticator=authenticator;this.closeActive=close;
    try {
      unregister=this.commercial.registerNativeSessionCloser((connections,initiator)=>{
        try{scmTransport?.revokeConnections(connections,initiator);}
        finally{for(const id of connections){if(id===initiator)server.retireConnection(id);else server.disconnectConnection(id);}}
      });
      this.unregisterSessionCloser=unregister;
      await server.start();
      if(this.startupToken!==startupToken)throw Error("LOCAL_CHANNEL_START_CANCELLED");
    } catch (error) {
      try{await close();}catch(cleanupError){throw new AggregateError([error,cleanupError],"local channel start and cleanup failed");}
      throw error;
    } finally {
      if(this.startupToken===startupToken)this.startupToken=undefined;
    }
  }

  async stop():Promise<void>{
    if(this.stopping)return this.stopping;
    if(this.stoppedResult)return this.stoppedResult;
    this.startupToken=undefined;
    const operation=this.stopAttempt();this.stopping=operation;this.stoppedResult=operation;
    try{await operation;}finally{if(this.stopping===operation)this.stopping=undefined;}
  }

  private async stopAttempt():Promise<void>{
    const failures:unknown[]=[];
    try{this.nativeCommercial?.stop();}catch(error){failures.push(error);}
    try{await this.closeActive?.();}catch(error){failures.push(error);}
    // A cancelled start must finish its own cleanup before another attempt is
    // admitted. Its original failure still belongs to the start() caller.
    try{await this.starting;}catch{/* start caller observes cancellation/failure */}
    if(failures.length===1)throw failures[0];
    if(failures.length>1)throw new AggregateError(failures,"local channel stop failed");
  }

  private async handle(
    request: IpcRequest,
    signal: AbortSignal,
    context: ChannelRequestContext,
  ): Promise<unknown> {
    if (signal.aborted) throw new Error("local channel request aborted");

    switch (request.message_type) {
      case "commercial.native.begin":
      case "commercial.native.complete":
      case "commercial.native.commit":
      case "commercial.native.cancel":
      case "commercial.native.logout":
        if(this.nativeCommercial)return this.nativeCommercial.handle(request,context.connectionId,signal,context.assertAuthorized);
        return {protocol_version:request.protocol_version,request_id:request.request_id,correlation_id:request.correlation_id,
          operation_id:null,status:"REJECTED",result_code:"DENIED",result_schema_version:"1.0.0",server_time:new Date().toISOString(),
          error:{code:"NATIVE_COMMERCIAL_UNPROVISIONED",category:"AUTHENTICATION",retryable:false,user_message_key:"native.commercial.unprovisioned",
            field_errors:[],current_version:null,required_action:null,diagnostic_id:randomUUID()},
          result:{outcome:"DENIED",attempt_id:null,authorization_url:null}};
      case "authorization.capabilities.get":
      case "session.activate":
      case "cash.shift.open":
      case "cash.shift.close":
      case "sale.create":
      case "payment.register.cash":
      case "payment.register.transfer":
      case "payment.transfer.confirm":
      case "payment.cancel":
      case "payment.get":
      case "customer.register":
      case "customer.get":
      case "customer.find":
      case "customer.marketing.subscribe":
      case "customer.marketing.unsubscribe":
      case "customer.marketing.get":
      case "fiscal.document.issue":
      case "catalog.product.register":
      case "catalog.item.find":
      case "catalog.item.get":
      case "catalog.item.list":
      case "inventory.stock.receive":
      case "inventory.stock.adjust":
      case "inventory.stock.get":
      case "sales.receipt.get":
      case "hardware.command":
      case "audit.event.list":
      case "admin.metrics.get":
      case "license.offers.list":
        // La identidad se resuelve por `connectionId`, que asigna el servidor y
        // nunca viaja por el cable. La petición no puede aportarla.
        return this.commercialHandler.handle(request, context.connectionId, signal);
      case "session.recover": {
        const response=await this.commercialHandler.handle(request,context.connectionId,signal);
        if(response&&typeof response==="object"&&"result_code" in response&&response.result_code==="ACTIVE")this.nativeCommercial?.recovered?.(context.connectionId);
        return response;
      }

      case "runtime.handshake": {
        const identityTrusted =
          request.payload.installation_id === this.config.installation_id
          && request.payload.device_id === this.config.device_id;

        const negotiated = negotiateProtocolVersion(
          { min: this.config.protocol_min, max: this.config.protocol_max },
          { min: request.payload.protocol_min, max: request.payload.protocol_max },
        );

        let status:
          | "COMPATIBLE"
          | "UPDATE_DESKTOP_REQUIRED"
          | "UPDATE_SERVICE_REQUIRED"
          | "MIGRATION_REQUIRED"
          | "UNTRUSTED_INSTALLATION";

        if (!identityTrusted) status = "UNTRUSTED_INSTALLATION";
        else if (request.payload.schema_version !== LOCAL_SCHEMA_VERSION) status = "MIGRATION_REQUIRED";
        else if (negotiated === null) status = incompatibleStatus(request, this.config);
        else status = "COMPATIBLE";

        return {
          protocol_version: negotiated ?? this.config.protocol_max,
          request_id: request.request_id,
          correlation_id: request.correlation_id,
          operation_id: null,
          status: "SUCCEEDED",
          result_code: status,
          result_schema_version: RESULT_SCHEMA_VERSION,
          error: null,
          server_time: new Date().toISOString(),
          result: {
            status,
            negotiated_protocol_version: status === "COMPATIBLE" ? negotiated : null,
          },
        };
      }

      case "runtime.status.get":
        return {
          protocol_version: request.protocol_version,
          request_id: request.request_id,
          correlation_id: request.correlation_id,
          operation_id: null,
          status: "SUCCEEDED",
          result_code: "OK",
          result_schema_version: RESULT_SCHEMA_VERSION,
          error: null,
          server_time: new Date().toISOString(),
          result: {
            service_version: this.config.service_version,
            protocol_version: request.protocol_version,
            service_state: this.runtimeState(),
            schema_version: LOCAL_SCHEMA_VERSION,
          },
        };

      case "operation.result.get": {
        const row = this.localDatabase.database.native.prepare(
          `SELECT operation_id, idempotency_key, status, result_code
             FROM runtime_operations
            WHERE operation_id = ? AND idempotency_key = ?`,
        ).get(
          request.payload.operation_id,
          request.payload.idempotency_key,
        ) as {
          operation_id: string;
          idempotency_key: string;
          status: "PENDING" | "SUCCEEDED" | "REJECTED" | "UNKNOWN";
          result_code: string;
        } | undefined;

        return {
          protocol_version: request.protocol_version,
          request_id: request.request_id,
          correlation_id: request.correlation_id,
          operation_id: request.payload.operation_id,
          status: "SUCCEEDED",
          result_code: row?.result_code ?? "NOT_FOUND",
          result_schema_version: RESULT_SCHEMA_VERSION,
          error: null,
          server_time: new Date().toISOString(),
          result: row ?? {
            operation_id: request.payload.operation_id,
            idempotency_key: request.payload.idempotency_key,
            status: "NOT_FOUND",
            result_code: "NOT_FOUND",
          },
        };
      }

      case "operation.confirm": {
        if (request.operation_id === undefined || request.idempotency_key === undefined) {
          return this.rejected(request, "OPERATION_CONFIRM_MISSING_IDEMPOTENCY", {
            code: "OPERATION_CONFIRM_MISSING_IDEMPOTENCY",
            category: "VALIDATION",
            retryable: false,
            user_message_key: "operation.confirm.missing_idempotency",
            field_errors: [],
            current_version: null,
            required_action: null,
            diagnostic_id: randomUUID(),
          });
        }

        const outcome = this.operationConfirmation.store.confirm(
          {
            scope: {
              tenantId: this.config.tenant_id,
              companyId: this.config.company_id,
              branchId: this.config.branch_id,
              deviceId: this.config.device_id,
              installationId: this.config.installation_id,
            },
            sessionId: context.transportSessionId,
            actorId: this.config.device_id,
          },
          {
            operationId: request.operation_id,
            idempotencyKey: request.idempotency_key,
            correlationId: request.correlation_id,
            causationId: request.causation_id ?? null,
            operationType: request.payload.operation_type,
            payload: request.payload.payload,
          },
        );

        if (outcome.kind === "IDEMPOTENCY_CONFLICT") {
          return this.rejected(request, "OPERATION_IDEMPOTENCY_CONFLICT", {
            code: "OPERATION_IDEMPOTENCY_CONFLICT",
            category: "CONFLICT",
            retryable: false,
            user_message_key: "operation.confirm.idempotency_conflict",
            field_errors: [],
            current_version: null,
            required_action: null,
            diagnostic_id: randomUUID(),
          }, outcome.operationId);
        }

        return {
          protocol_version: request.protocol_version,
          request_id: request.request_id,
          correlation_id: request.correlation_id,
          operation_id: outcome.operationId,
          status: "SUCCEEDED",
          result_code: outcome.resultCode,
          result_schema_version: RESULT_SCHEMA_VERSION,
          error: null,
          server_time: new Date().toISOString(),
          result: { operation_id: outcome.operationId, status: "SUCCEEDED", result_code: outcome.resultCode },
        };
      }

      default: {
        // Exhaustividad garantizada por el compilador. Sin esta rama, un
        // `message_type` del contrato sin `case` no falla de forma visible: el
        // `switch` cae al final, `handle` resuelve `undefined`, `validateResponse`
        // lo rechaza y `server.ts` cierra el socket. Así estuvieron los cinco
        // `payment.*` desde `BLOQUE 4E`.
        //
        // Con la asignación a `never`, ese mismo olvido deja de compilar: `tsc`
        // señala esta línea al añadir un tipo al contrato sin enrutarlo. La
        // garantía pasa de ser una prueba —que además sólo corre en Windows— a
        // ser una propiedad del tipo, verificada en cada `pnpm typecheck`.
        const unrouted: never = request;
        throw new Error(
          `local channel message type not routed: ${
            String((unrouted as { message_type?: unknown }).message_type)
          }`,
        );
      }
    }
  }

  private rejected(
    request: Extract<IpcRequest, { message_type: "operation.confirm" }>,
    resultCode: string,
    error: ContractError,
    operationId: string | null = null,
  ) {
    return {
      protocol_version: request.protocol_version,
      request_id: request.request_id,
      correlation_id: request.correlation_id,
      operation_id: operationId,
      status: "REJECTED",
      result_code: resultCode,
      result_schema_version: RESULT_SCHEMA_VERSION,
      error,
      server_time: new Date().toISOString(),
      result: null,
    };
  }
}
