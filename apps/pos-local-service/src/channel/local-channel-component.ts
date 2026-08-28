import {
  compareContractVersions,
  negotiateProtocolVersion,
  type IpcRequest,
} from "@pos-platform/contracts";
import type { RuntimeComponent, RuntimeState } from "../lifecycle.js";
import type { LocalDatabaseComponent } from "../local-database-component.js";
import type { ServiceConfig } from "../config.js";
import { LocalChannelAuthenticator } from "./authenticator.js";
import { localChannelEndpoint } from "./endpoint.js";
import { SqliteReplayStateStore } from "./replay-state.js";
import { LocalChannelServer } from "./server.js";
import { loadOrCreateWindowsLocalChannelSecret } from "./secret.js";

const LOCAL_SCHEMA_VERSION = "2";
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

  constructor(
    private readonly config: ServiceConfig,
    private readonly localDatabase: LocalDatabaseComponent,
    private readonly runtimeState: () => RuntimeState,
  ) {
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
      (request, signal) => this.handle(request, signal),
      { min: this.config.protocol_min, max: this.config.protocol_max },
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

  private async handle(request: IpcRequest, signal: AbortSignal): Promise<unknown> {
    if (signal.aborted) throw new Error("local channel request aborted");

    switch (request.message_type) {
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
    }
  }
}
