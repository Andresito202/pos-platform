import { randomUUID } from "node:crypto";
import {
  compareContractVersions,
  negotiateProtocolVersion,
  type ContractError,
  type IpcRequest,
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
  private readonly commercialHandler: CommercialRequestHandler;

  constructor(
    private readonly config: ServiceConfig,
    private readonly localDatabase: LocalDatabaseComponent,
    private readonly runtimeState: () => RuntimeState,
    private readonly operationConfirmation: OperationConfirmationComponent,
    private readonly commercial: CommercialComponent,
  ) {
    this.commercialHandler = new CommercialRequestHandler(config, commercial);
    this.endpoint = localChannelEndpoint(config.installation_id);
  }

  async start(): Promise<void> {
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
    secret.fill(0);

    const server = new LocalChannelServer(
      this.endpoint,
      authenticator,
      (request, signal, context) => this.handle(request, signal, context),
      { min: this.config.protocol_min, max: this.config.protocol_max },
      undefined,
      undefined,
      undefined,
      // El cierre de la conexión invalida su vínculo de sesión (`DEC-015` §5.6).
      (connectionId) => this.commercial.bindings.release(connectionId),
    );

    try {
      await server.start();
      this.authenticator = authenticator;
      this.server = server;
    } catch (error) {
      authenticator.destroy();
      throw error;
    }
  }

  async stop(): Promise<void> {
    const server = this.server;
    const authenticator = this.authenticator;
    this.server = undefined;
    this.authenticator = undefined;

    try {
      await server?.stop();
    } finally {
      authenticator?.destroy();
    }
  }

  private async handle(
    request: IpcRequest,
    signal: AbortSignal,
    context: ChannelRequestContext,
  ): Promise<unknown> {
    if (signal.aborted) throw new Error("local channel request aborted");

    switch (request.message_type) {
      case "session.activate":
      case "session.recover":
      case "cash.shift.open":
      case "cash.shift.close":
      case "sale.create":
      case "payment.register.cash":
      case "payment.register.transfer":
      case "payment.register.qr":
      case "payment.transfer.confirm":
      case "payment.cancel":
      case "payment.get":
      case "payment.register.credit":
      case "credit.account.open":
      case "credit.account.get":
      case "credit.payment.register":
      case "customer.register":
      case "customer.get":
      case "customer.find":
      case "fiscal.document.issue":
      case "catalog.product.register":
      case "catalog.fiscal.attribute.set":
      case "catalog.presentation.add":
      case "catalog.conversion.declare":
      case "inventory.conversion.apply":
      case "catalog.item.find":
      case "catalog.item.get":
      case "catalog.item.import":
      case "inventory.stock.receive":
      case "inventory.stock.adjust":
      case "inventory.stock.get":
      case "inventory.lot.receive":
      case "inventory.lot.list":
      case "inventory.lot.trace":
      case "inventory.lot.expiring":
      case "fiscal.document.list":
      case "sales.receipt.get":
      case "sales.receipt.print":
      case "cash.drawer.open":
      case "sales.return.create":
        // La identidad se resuelve por `connectionId`, que asigna el servidor y
        // nunca viaja por el cable. La petición no puede aportarla.
        return this.commercialHandler.handle(request, context.connectionId, signal);

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
