import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ServiceLifecycle } from "../lifecycle.js";
import { LocalDatabaseComponent } from "../local-database-component.js";
import { DurableSyncComponent } from "../sync/durable-sync-component.js";
import { CommercialComponent } from "../commercial/commercial-component.js";
import { CommercialRequestHandler } from "../commercial/commercial-request-handler.js";
import { LocalOperatorPasswordGate } from "../security/local-operator-password-gate.js";
import { LocalOperatorSessionRegistry } from "../security/local-operator-session-registry.js";
import { AndroidKeystoreKeyProvider } from "../security/android-keystore-key-provider.js";
import { EncryptedFileSecretStore } from "../security/encrypted-secret-store.js";
import { LicenseCapacityGate, type OperationalLicenseInformation, readLicenseCapacityProvision } from "../security/license-capacity-gate.js";
import { parseServiceConfig, type ServiceConfig } from "../config.js";
import type { IpcRequest } from "@pos-platform/contracts";

export type AndroidHostStatus = {
  readonly state: "STARTING" | "READY" | "STOPPED" | "FAILED";
  readonly commercial_access:
    | "BLOCKED_PENDING_TRUSTED_PROVISIONING"
    | "BLOCKED_PENDING_BUSINESS_AUTHORITY"
    | "OPERATOR_LOCAL"
    | "BUSINESS_READY";
  readonly local_security: "NOT_PROVISIONED" | "PROVISIONED";
  readonly external_channel: "CLOSED";
  readonly engine: "EMBEDDED_NODE_SQLITE";
  readonly modules: readonly string[];
};

/**
 * Android commercial host over the canonical Local Service graph.
 * Unprovisioned installs stay fail-closed. No mock sessions or sales.
 */
export class AndroidCommercialHost {
  private readonly database: LocalDatabaseComponent;
  private readonly lifecycle: ServiceLifecycle;
  private durableSync: DurableSyncComponent | undefined;
  private commercial: CommercialComponent | undefined;
  private handler: CommercialRequestHandler | undefined;
  private operators: LocalOperatorSessionRegistry | undefined;
  private config: ServiceConfig | undefined;
  private connectionId = randomUUID();
  private statusValue: AndroidHostStatus = {
    state: "STARTING",
    commercial_access: "BLOCKED_PENDING_TRUSTED_PROVISIONING",
    local_security: "NOT_PROVISIONED",
    external_channel: "CLOSED",
    engine: "EMBEDDED_NODE_SQLITE",
    modules: ["local-database"],
  };

  constructor(
    private readonly directory: string,
    private readonly provider: AndroidKeystoreKeyProvider,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.database = new LocalDatabaseComponent(directory);
    this.lifecycle = new ServiceLifecycle([this.database]);
  }

  async start(): Promise<void> {
    await this.lifecycle.start();
    const modules: string[] = ["local-database"];
    const provisionPath = join(this.directory, "android-commercial-provision.env");
    const authStore = join(this.directory, "..", "security", "local-operators.json");
    let access: AndroidHostStatus["commercial_access"] = "BLOCKED_PENDING_TRUSTED_PROVISIONING";
    let security: AndroidHostStatus["local_security"] = "NOT_PROVISIONED";

    if (existsSync(authStore)) {
      this.operators = new LocalOperatorSessionRegistry(
        new LocalOperatorPasswordGate(this.database.database, authStore, () => this.now().getTime()),
      );
      modules.push("local-operator");
      access = "OPERATOR_LOCAL";
    }

    if (existsSync(provisionPath)) {
      const env = Object.fromEntries(
        readFileSync(provisionPath, "utf8")
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith("#") && line.includes("="))
          .map((line) => {
            const i = line.indexOf("=");
            return [line.slice(0, i), line.slice(i + 1)] as const;
          }),
      ) as NodeJS.ProcessEnv;
      env.POS_DATA_DIRECTORY = this.directory;
      env.NODE_ENV = "development";
      // Android commercial never elevates local-operator into CommercialRequestHandler.
      // SSA/session.activate is the only commercial authority path.
      this.config = parseServiceConfig(env);
      this.durableSync = new DurableSyncComponent(this.database);
      await this.durableSync.start();
      modules.push("durable-sync");
      const securityDirectory = join(this.directory, "..", "security");
      const fiscalStore = new EncryptedFileSecretStore(
        securityDirectory,
        this.provider,
        `fiscal:${this.config.installation_id}`,
      );
      const factusPayStore = new EncryptedFileSecretStore(
        securityDirectory,
        this.provider,
        `factus-pay:${this.config.installation_id}`,
      );
      const licensePath = this.config.license_capacity_provision_file;
      this.commercial = new CommercialComponent(
        this.config,
        this.database,
        this.durableSync,
        new Map(),
        this.now,
        fiscalStore,
        undefined,
        (scope, registerId) => {
          if (!licensePath) return "LICENSE_CAPACITY_NOT_PROVISIONED";
          return new LicenseCapacityGate(
            this.database.database,
            () => readLicenseCapacityProvision(licensePath),
            this.now,
          ).authorize(scope, registerId);
        },
        (scope, entitlement) => {
          if (!licensePath) return "LICENSE_CAPACITY_NOT_PROVISIONED";
          return new LicenseCapacityGate(
            this.database.database,
            () => readLicenseCapacityProvision(licensePath),
            this.now,
          ).authorizeEntitlement(scope, entitlement);
        },
        (scope) => {
          if (!licensePath) return [];
          return new LicenseCapacityGate(
            this.database.database,
            () => readLicenseCapacityProvision(licensePath),
            this.now,
          ).listEntitlements(scope);
        },
        factusPayStore,
      );
      await this.commercial.start();
      this.handler = new CommercialRequestHandler(
        this.config,
        this.commercial,
        () => null,
      );
      modules.push("commercial");
      security = "PROVISIONED";
      access = "BUSINESS_READY";
    }

    this.statusValue = {
      state: "READY",
      commercial_access: access,
      local_security: security,
      external_channel: "CLOSED",
      engine: "EMBEDDED_NODE_SQLITE",
      modules,
    };
  }

  async stop(): Promise<void> {
    this.operators?.clear();
    await this.commercial?.stop();
    await this.durableSync?.stop();
    await this.lifecycle.stop();
    this.statusValue = {
      ...this.statusValue,
      state: "STOPPED",
      commercial_access: "BLOCKED_PENDING_TRUSTED_PROVISIONING",
    };
  }

  status(): AndroidHostStatus {
    return this.statusValue;
  }

  licenseInformation(): OperationalLicenseInformation {
    const unknown: OperationalLicenseInformation = {
      status: "UNVERIFIED",
      signedValidUntil: null,
      lastAcceptedLocalCheck: null,
      evaluatedAt: null,
    };
    const path = this.config?.license_capacity_provision_file;
    if (!path || !this.config) return unknown;
    try {
      return new LicenseCapacityGate(
        this.database.database,
        () => readLicenseCapacityProvision(path),
        this.now,
      ).information({
        tenantId: this.config.tenant_id,
        companyId: this.config.company_id,
        branchId: this.config.branch_id,
        installationId: this.config.installation_id,
        deviceId: this.config.device_id,
      });
    } catch {
      return unknown;
    }
  }

  async handleRequest(raw: unknown): Promise<unknown> {
    const request = raw as IpcRequest;
    if (!request || typeof request !== "object" || typeof request.message_type !== "string") {
      return this.denied(request, "INVALID_REQUEST", "La solicitud no es válida.");
    }

    if (
      request.message_type === "android.business.native_request"
      || request.message_type === "android.business.token_exchange"
    ) {
      // Central native-request / token routes are prepared in DeviceProof allowlists
      // but not simulated. Fail closed until enrollment + Central composition exist.
      return this.denied(
        request,
        request.message_type === "android.business.native_request"
          ? "BUSINESS_NATIVE_REQUEST_UNAVAILABLE"
          : "BUSINESS_TOKEN_EXCHANGE_UNAVAILABLE",
        request.message_type === "android.business.native_request"
          ? "Central aún no acepta solicitudes nativas Android con DeviceProof en este despliegue."
          : "El canje de token BUSINESS con DeviceProof no está disponible sin Central y credencial enrolada.",
      );
    }

    if (
      request.message_type === "local.operator.login"
      || request.message_type === "local.operator.session"
      || request.message_type === "local.operator.logout"
    ) {
      // Kept for lab probes only; commercial UI must not use these for authorization.
      return this.handleOperator(request);
    }

    if (!this.handler || !this.commercial) {
      return this.denied(
        request,
        "DEVICE_NOT_PROVISIONED",
        "Este equipo aún no está aprovisionado para operar.",
      );
    }

    return Promise.resolve(this.handler.handle(request as never, this.connectionId));
  }

  private async handleOperator(request: IpcRequest): Promise<unknown> {
    if (!this.operators) {
      return this.denied(
        request,
        "OPERATOR_STORE_UNAVAILABLE",
        "No hay cuentas de operador configuradas en este dispositivo.",
      );
    }
    if (request.message_type === "local.operator.logout") {
      this.operators.logout(this.connectionId);
      return this.operatorResult(request, {
        outcome: "SIGNED_OUT",
        username: null,
        role: null,
        expires_at: null,
      });
    }
    if (request.message_type === "local.operator.session") {
      const active = this.operators.resolve(this.connectionId);
      return this.operatorResult(
        request,
        active
          ? {
            outcome: "AUTHENTICATED",
            username: active.username,
            role: active.role,
            expires_at: active.expiresAt,
          }
          : { outcome: "NO_SESSION", username: null, role: null, expires_at: null },
      );
    }
    const payload = request.payload as { username?: string; password?: string };
    const verified = await this.operators.login(
      this.connectionId,
      String(payload?.username ?? ""),
      String(payload?.password ?? ""),
    );
    return this.operatorResult(
      request,
      verified.status === "AUTHENTICATED"
        ? {
          outcome: "AUTHENTICATED",
          username: verified.username,
          role: verified.role,
          expires_at: verified.expiresAt,
        }
        : { outcome: verified.status, username: null, role: null, expires_at: null },
    );
  }

  private operatorResult(request: IpcRequest, result: Record<string, unknown>) {
    return {
      protocol_version: request.protocol_version ?? "1.0.0",
      request_id: request.request_id ?? randomUUID(),
      correlation_id: request.correlation_id ?? null,
      operation_id: null,
      status: "SUCCEEDED",
      result_code: result.outcome,
      result_schema_version: "1.0.0",
      error: null,
      server_time: this.now().toISOString(),
      result,
    };
  }

  private denied(request: IpcRequest | undefined, code: string, message: string) {
    return {
      protocol_version: request?.protocol_version ?? "1.0.0",
      request_id: request?.request_id ?? randomUUID(),
      correlation_id: request?.correlation_id ?? null,
      operation_id: null,
      status: "FAILED",
      result_code: code,
      result_schema_version: "1.0.0",
      error: { code, user_message: message, user_message_key: code.toLowerCase() },
      server_time: this.now().toISOString(),
      result: null,
    };
  }
}
