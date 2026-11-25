import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicKey, randomUUID } from "node:crypto";
import { IpcRequestSchema, type IpcRequest } from "@pos-platform/contracts";
import { ServiceLifecycle } from "../lifecycle.js";
import { LocalDatabaseComponent } from "../local-database-component.js";
import { DurableSyncComponent } from "../sync/durable-sync-component.js";
import { CommercialComponent } from "../commercial/commercial-component.js";
import { CommercialRequestHandler } from "../commercial/commercial-request-handler.js";
import { AndroidKeystoreKeyProvider } from "../security/android-keystore-key-provider.js";
import { EncryptedFileSecretStore } from "../security/encrypted-secret-store.js";
import { commercialLicenseCapacitySealStore, LicenseCapacityGate, type OperationalLicenseInformation, readLicenseCapacityProvision } from "../security/license-capacity-gate.js";
import { LocalSecurityComponent } from "../security/local-security-component.js";
import { parseServiceConfig, type ServiceConfig } from "../config.js";
import {
  AndroidBusinessNativeCentralClient,
  AndroidNativeRequestMaterialSchema,
  AndroidTokenExchangeMaterialSchema,
} from "./android-business-native-central.js";
import {
  androidSecurityDirectory,
  createAndroidBusinessNativeCentralClient,
  type AndroidNativeCentralDeps,
} from "./android-commercial-native-composition.js";
import { SessionTrustKeyResolver } from "../security/session-trust-key-resolver.js";
import { SessionTrustKeyStore } from "../security/session-trust-key-store.js";
import { SessionTrustKeyVerifier } from "../security/session-trust-key-verifier.js";
import { fiscalCredentialContext } from "../fiscal/fiscal-credential-store.js";
import { factusPayCredentialContext } from "../payments/factus-pay-credential-store.js";
import { ANDROID_TRIAL_CAPACITY_POLICY } from "./android-trial-capacity-policy.js";
import { AndroidBusinessSessionActivation } from "./android-business-session-activation.js";
import { resolveAndroidAuthorizationTrust } from "./android-authorization-trust.js";
import { AuthorizationSnapshotVerifier } from "../security/authorization-snapshot-verifier.js";
import { TrustedClockGuard } from "../security/trusted-clock.js";
import { readAndroidCommercialProvision } from "./android-commercial-native-composition.js";
import { verifyAndroidEmbeddedRuntimeIntegrity } from "./android-runtime-integrity.js";

export type AndroidHostStatus = {
  readonly state: "STARTING" | "READY" | "STOPPED" | "FAILED";
  readonly commercial_access:
    | "BLOCKED_PENDING_TRUSTED_PROVISIONING"
    | "BLOCKED_PENDING_BUSINESS_AUTHORITY"
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
  private localSecurity: LocalSecurityComponent | undefined;
  private durableSync: DurableSyncComponent | undefined;
  private commercial: CommercialComponent | undefined;
  private handler: CommercialRequestHandler | undefined;
  private config: ServiceConfig | undefined;
  private nativeCentral: AndroidBusinessNativeCentralClient | undefined;
  private activation: AndroidBusinessSessionActivation | undefined;
  private exchangeInProgress = false;
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
    /**
     * Optional DeviceProof client override (tests). Production default composes
     * LocalSecurity + enrolled Device Trust + Android commercial provision.
     * Returning null keeps native-request / token exchange fail-closed.
     */
    private readonly resolveNativeCentral?: (
      config: ServiceConfig,
      deps: AndroidNativeCentralDeps,
    ) => AndroidBusinessNativeCentralClient | null,
  ) {
    this.database = new LocalDatabaseComponent(directory);
    this.lifecycle = new ServiceLifecycle([this.database]);
  }

  async start(): Promise<void> {
    const runtimeRoot = process.env.ANDROID_EMBEDDED_RUNTIME_ROOT?.trim()
      || (existsSync(join(this.directory, "runtime"))
        ? join(this.directory, "runtime")
        : join(this.directory, "..", "runtime"));
    try {
      verifyAndroidEmbeddedRuntimeIntegrity(runtimeRoot);
    } catch (error) {
      this.statusValue = {
        state: "FAILED",
        commercial_access: "BLOCKED_PENDING_TRUSTED_PROVISIONING",
        local_security: "NOT_PROVISIONED",
        external_channel: "CLOSED",
        engine: "EMBEDDED_NODE_SQLITE",
        modules: [],
      };
      throw error;
    }

    await this.lifecycle.start();
    const modules: string[] = ["local-database"];
    const provisionPath = join(this.directory, "android-commercial-provision.env");
    let access: AndroidHostStatus["commercial_access"] = "BLOCKED_PENDING_TRUSTED_PROVISIONING";
    let security: AndroidHostStatus["local_security"] = "NOT_PROVISIONED";

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
      env.NODE_ENV = "production";
      // Android commercial never elevates local-operator into CommercialRequestHandler.
      // SSA/session.activate is the only commercial authority path.
      this.config = parseServiceConfig(env);
      const securityDirectory = androidSecurityDirectory(this.directory);
      this.localSecurity = new LocalSecurityComponent(
        this.database,
        {
          installationId: this.config.installation_id,
          deviceId: this.config.device_id,
        },
        this.provider,
        securityDirectory,
        this.now,
      );
      await this.localSecurity.start();
      modules.push("local-security");
      this.durableSync = new DurableSyncComponent(this.database);
      await this.durableSync.start();
      modules.push("durable-sync");
      const fiscalStore = new EncryptedFileSecretStore(
        securityDirectory,
        this.provider,
        fiscalCredentialContext({ installationId: this.config.installation_id, deviceId: this.config.device_id }),
      );
      const factusPayStore = new EncryptedFileSecretStore(
        securityDirectory,
        this.provider,
        factusPayCredentialContext({ installationId: this.config.installation_id, deviceId: this.config.device_id, companyId: this.config.company_id }),
      );
      const licensePath = this.config.license_capacity_provision_file;
      const config = this.config;
      const sessionTrust = config.session_trust_environment && config.session_trust_root_public_key_pem
        ? new SessionTrustKeyResolver(new SessionTrustKeyStore(new EncryptedFileSecretStore(securityDirectory, this.provider, `session-trust:${config.installation_id}:${config.device_id}`)), new SessionTrustKeyVerifier(createPublicKey(config.session_trust_root_public_key_pem), config.session_trust_environment), config.session_trust_artifact_path).resolve()
        : { keys: new Map(), decision: "MISSING" };
      this.commercial = new CommercialComponent(
        this.config,
        this.database,
        this.durableSync,
        sessionTrust.keys,
        this.now,
        fiscalStore,
        undefined,
        (scope, registerId) => {
          if (!licensePath) return "LICENSE_CAPACITY_NOT_PROVISIONED";
          return new LicenseCapacityGate(
            this.database.database,
            () => readLicenseCapacityProvision(licensePath),
            this.now,
            commercialLicenseCapacitySealStore(licensePath, config.installation_id),
          ).authorize(scope, registerId);
        },
        (scope, entitlement) => {
          if (!licensePath) return "LICENSE_CAPACITY_NOT_PROVISIONED";
          return new LicenseCapacityGate(
            this.database.database,
            () => readLicenseCapacityProvision(licensePath),
            this.now,
            commercialLicenseCapacitySealStore(licensePath, config.installation_id),
          ).authorizeEntitlement(scope, entitlement);
        },
        (scope) => {
          if (!licensePath) return [];
          return new LicenseCapacityGate(
            this.database.database,
            () => readLicenseCapacityProvision(licensePath),
            this.now,
            commercialLicenseCapacitySealStore(licensePath, config.installation_id),
          ).listEntitlements(scope);
        },
        factusPayStore,
      );
      await this.commercial.start();
      if (sessionTrust.decision === "VALID" && config.authorization_trust_provision_file && config.android_commercial_provision_file && config.central_base_url && this.localSecurity.protection === "OS_BOUND") {
        const trustStore = new EncryptedFileSecretStore(securityDirectory, this.provider, `android-sas-trust:${config.installation_id}:${config.device_id}`);
        try {
          const provision = readAndroidCommercialProvision(config.android_commercial_provision_file, config.central_base_url);
          const keys = resolveAndroidAuthorizationTrust(config.authorization_trust_provision_file, {
            issuer: config.central_base_url, environment: provision.environment,
            recipient: {tenant_id:config.tenant_id,company_id:config.company_id,branch_id:config.branch_id,installation_id:config.installation_id,device_id:config.device_id},
          }, trustStore, this.now());
          this.activation = new AndroidBusinessSessionActivation(this.database.database, this.commercial.sessionActivation, this.commercial.authorizationStore, new AuthorizationSnapshotVerifier(keys, new TrustedClockGuard(this.database.database), this.now), this.commercial.bindings, {tenantId:config.tenant_id,companyId:config.company_id,branchId:config.branch_id,installationId:config.installation_id,deviceId:config.device_id});
          modules.push("business-session-activation");
        } catch { this.activation = undefined; }
        finally { trustStore.destroy(); }
      }
      this.handler = new CommercialRequestHandler(
        this.config,
        this.commercial,
        () => null,
      );
      modules.push("commercial");
      security = "PROVISIONED";
      access = "BLOCKED_PENDING_BUSINESS_AUTHORITY";
      if (this.config.central_base_url) {
        const deps: AndroidNativeCentralDeps = {
          config: this.config,
          database: this.database,
          security: this.localSecurity,
          keyProvider: this.provider,
          securityDirectory,
          now: this.now,
        };
        const client = this.resolveNativeCentral
          ? this.resolveNativeCentral(this.config, deps)
          : createAndroidBusinessNativeCentralClient(deps);
        if (client) {
          this.nativeCentral = client;
          modules.push("business-native-central");
        }
      }
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
    this.activation?.close(this.connectionId);
    this.activation = undefined;
    this.nativeCentral = undefined;
    await this.commercial?.stop();
    await this.durableSync?.stop();
    await this.localSecurity?.stop();
    this.localSecurity = undefined;
    await this.lifecycle.stop();
    this.statusValue = {
      ...this.statusValue,
      state: "STOPPED",
      commercial_access: "BLOCKED_PENDING_TRUSTED_PROVISIONING",
    };
  }

  status(): AndroidHostStatus {
    if(this.statusValue.commercial_access === "BUSINESS_READY" && !this.activation?.authorize(this.connectionId)) {
      this.statusValue = {...this.statusValue,commercial_access:"BLOCKED_PENDING_BUSINESS_AUTHORITY"};
    }
    return this.statusValue;
  }

  /** Observation only — PR #135 trial window; enforcement is LicenseCapacityGate. */
  trialCapacityPolicy() {
    return ANDROID_TRIAL_CAPACITY_POLICY;
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
        commercialLicenseCapacitySealStore(path, this.config.installation_id),
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
    // Host-only Android BUSINESS ceremony messages are not part of IpcRequestSchema;
    // inspect the wire string before Zod-narrowing commercial IPC.
    const wire = raw as {
      protocol_version?: string;
      request_id?: string;
      correlation_id?: string | null;
      message_type?: unknown;
      payload?: unknown;
    } | null;
    if (!wire || typeof wire !== "object" || typeof wire.message_type !== "string") {
      return this.denied(undefined, "INVALID_REQUEST", "La solicitud no es válida.");
    }
    const messageType = wire.message_type;

    if (messageType === "android.business.logout") {
      if(this.exchangeInProgress) return this.denied(wire as IpcRequest,"BUSINESS_EXCHANGE_BUSY","Canje en curso.");
      this.activation?.close(this.connectionId);
      this.statusValue={...this.statusValue,commercial_access:"BLOCKED_PENDING_BUSINESS_AUTHORITY"};
      return {status:"SUCCEEDED",result_code:"SESSION_CLOSED",result:null};
    }
    if (messageType === "android.business.native_request") {
      return this.handleNativeRequest(wire);
    }
    if (messageType === "android.business.token_exchange") {
      return this.handleTokenExchange(wire);
    }

    const parsed = IpcRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return this.denied(
        wire as IpcRequest,
        "INVALID_REQUEST",
        "La solicitud no cumple el contrato IPC comercial.",
      );
    }
    const request = parsed.data;

    if (
      request.message_type === "local.operator.login"
      || request.message_type === "local.operator.session"
      || request.message_type === "local.operator.logout"
    ) {
      return this.denied(request, "BUSINESS_AUTHORITY_REQUIRED", "Se requiere autorización BUSINESS firmada.");
    }

    if (!this.handler || !this.commercial) {
      return this.denied(
        request,
        "DEVICE_NOT_PROVISIONED",
        "Este equipo aún no está aprovisionado para operar.",
      );
    }

    if (request.message_type === "session.activate" || request.message_type === "session.recover" || !this.activation?.authorize(this.connectionId) || this.exchangeInProgress) {
      return this.denied(request, "BUSINESS_AUTHORITY_REQUIRED", "Se requiere autorización BUSINESS firmada.");
    }
    return this.handler.handle(request as never, this.connectionId);
  }

  private async handleNativeRequest(wire: {
    protocol_version?: string;
    request_id?: string;
    correlation_id?: string | null;
    payload?: unknown;
  }): Promise<unknown> {
    const material = AndroidNativeRequestMaterialSchema.safeParse(wire.payload);
    if (!material.success) {
      return this.denied(wire as IpcRequest, "INVALID_REQUEST", "La solicitud nativa BUSINESS no es válida.");
    }
    if (!this.nativeCentral) {
      return this.denied(
        wire as IpcRequest,
        "BUSINESS_NATIVE_REQUEST_UNAVAILABLE",
        "Central aún no acepta solicitudes nativas Android con DeviceProof en este despliegue.",
      );
    }
    try {
      const result = await this.nativeCentral.registerNativeRequest(material.data);
      return {
        protocol_version: wire.protocol_version ?? "1.0.0",
        request_id: wire.request_id ?? randomUUID(),
        correlation_id: wire.correlation_id ?? null,
        operation_id: null,
        status: "SUCCEEDED",
        result_code: "NATIVE_REQUEST_BOUND",
        result_schema_version: "1.0.0",
        error: null,
        server_time: this.now().toISOString(),
        result,
      };
    } catch (error) {
      const code = error instanceof Error && /^[A-Z0-9_]{8,80}$/.test(error.message)
        ? error.message
        : "CENTRAL_NATIVE_REQUEST_REJECTED";
      return this.denied(
        wire as IpcRequest,
        code === "CENTRAL_NATIVE_ROUTE_NOT_ACTIVATED" ? "BUSINESS_NATIVE_REQUEST_UNAVAILABLE" : code,
        "Central rechazó o no activó el registro nativo BUSINESS con DeviceProof.",
      );
    }
  }

  private async handleTokenExchange(wire: {
    protocol_version?: string;
    request_id?: string;
    correlation_id?: string | null;
    payload?: unknown;
  }): Promise<unknown> {
    const material = AndroidTokenExchangeMaterialSchema.safeParse(wire.payload);
    if (!material.success) {
      return this.denied(wire as IpcRequest, "INVALID_REQUEST", "El canje BUSINESS no es válido.");
    }
    if (!this.nativeCentral) {
      return this.denied(
        wire as IpcRequest,
        "BUSINESS_TOKEN_EXCHANGE_UNAVAILABLE",
        "El canje de token BUSINESS con DeviceProof no está disponible sin Central y credencial enrolada.",
      );
    }
    if(this.exchangeInProgress) return this.denied(wire as IpcRequest,"BUSINESS_EXCHANGE_BUSY","Canje en curso.");
    this.exchangeInProgress = true;
    this.activation?.close(this.connectionId);
    this.statusValue = {...this.statusValue,commercial_access:"BLOCKED_PENDING_BUSINESS_AUTHORITY"};
    try {
      if (!this.activation || this.statusValue.state !== "READY") throw Error("BUSINESS_ACTIVATION_UNAVAILABLE");
      const pair = await this.nativeCentral.exchangeToken(material.data);
      if (!this.activation || this.statusValue.state !== "READY") throw Error("BUSINESS_ACTIVATION_UNAVAILABLE");
      this.activation.activate(pair,this.connectionId);
      this.statusValue = {...this.statusValue,commercial_access:"BUSINESS_READY"};
      const result = {session_id:pair.session_assertion.claims.session_id,offline_valid_until:pair.session_assertion.claims.offline_valid_until};
      return {
        protocol_version: wire.protocol_version ?? "1.0.0",
        request_id: wire.request_id ?? randomUUID(),
        correlation_id: wire.correlation_id ?? null,
        operation_id: null,
        status: "SUCCEEDED",
        result_code: "TOKEN_EXCHANGED",
        result_schema_version: "1.0.0",
        error: null,
        server_time: this.now().toISOString(),
        result,
      };
    } catch (error) {
      const code = error instanceof Error && /^[A-Z0-9_]{8,80}$/.test(error.message)
        ? error.message
        : "CENTRAL_TOKEN_EXCHANGE_REJECTED";
      return this.denied(
        wire as IpcRequest,
        code === "CENTRAL_NATIVE_ROUTE_NOT_ACTIVATED" ? "BUSINESS_TOKEN_EXCHANGE_UNAVAILABLE" : code,
        "Central rechazó o no activó el canje de token BUSINESS.",
      );
    } finally { this.exchangeInProgress = false; }
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
