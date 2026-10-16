import { createPublicKey } from "node:crypto";
import { Buffer } from "node:buffer";
import { lstatSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { StructuredLogger } from "@pos-platform/observability";
import { parseServiceConfig } from "./config.js";
import { ServiceLifecycle, type RuntimeComponent } from "./lifecycle.js";
import { LocalDatabaseComponent } from "./local-database-component.js";
import { LocalChannelComponent } from "./channel/index.js";
import { DurableSyncComponent } from "./sync/durable-sync-component.js";
import { CentralSyncComponent } from "./sync/central-sync-component.js";
import { FetchCentralTransport } from "./sync/fetch-central-transport.js";
import { SyncDispatcher } from "./sync/sync-dispatcher.js";
import { UnprovisionedDeviceCredentialProvider } from "./sync/device-credential.js";
import { OperationConfirmationComponent } from "./operations/operation-confirmation-component.js";
import { CommercialComponent } from "./commercial/commercial-component.js";
import { fiscalCredentialContext } from "./fiscal/fiscal-credential-store.js";
import {
  EncryptedFileSecretStore,
  InsecureDerivedKeyProvider,
  LocalSecurityComponent,
  SessionTrustKeyResolver,
  SessionTrustKeyStore,
  SessionTrustKeyVerifier,
  SessionTrustBundleFetcher,
  SessionTrustRefreshComponent,
  WindowsDpapiKeyProvider,
  type SecretStoreKeyProvider,
  type TrustedSigningKey,
} from "./security/index.js";

const logger = new StructuredLogger({
  write: (record) => new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      process.stdout.off("error", onError);
      reject(error);
    };
    process.stdout.once("error", onError);
    process.stdout.write(`${JSON.stringify(record)}\n`, () => {
      process.stdout.off("error", onError);
      resolve();
    });
  }),
});

/** Cadencia fija de despacho del outbox (`D-2`). */
const CENTRAL_SYNC_INTERVAL_MS = 30_000;

function readSessionTrustTransportToken(path: string): string {
  const tokenStat = lstatSync(path);
  if (tokenStat.isSymbolicLink()) throw new Error("session trust transport token file cannot be a symbolic link");
  if (!tokenStat.isFile() || tokenStat.size > 4096) throw new Error("session trust transport token file is invalid");
  const token = readFileSync(path, "utf8").trim();
  if (Buffer.byteLength(token, "utf8") > 4096) throw new Error("session trust transport token file is invalid");
  return token;
}

let lifecycle: ServiceLifecycle | undefined;
let termination: Promise<void> | undefined;

function terminate(reason: string, exitCode: number, error?: unknown): Promise<void> {
  if (termination) return termination;
  termination = (async () => {
    try {
      logger.log(exitCode === 0 ? "info" : "error", "runtime.stopping", {
        reason,
        ...(error === undefined ? {} : { error }),
      });
      await lifecycle?.stop();
      logger.log("info", "runtime.stopped", { reason });
    } catch (stopError) {
      try {
        logger.log("error", "runtime.stop_failed", { reason, error: stopError });
      } catch {
        // Exit remains fail-closed if the logger is unavailable.
      }
      exitCode = 1;
    }

    try {
      await logger.flush();
    } catch {
      exitCode = 1;
    }
    process.exit(exitCode);
  })();
  return termination;
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => { void terminate(signal, 0); });
}
process.once("uncaughtException", (error) => { void terminate("uncaughtException", 1, error); });
process.once("unhandledRejection", (reason) => { void terminate("unhandledRejection", 1, reason); });

if (process.connected && process.env.NODE_ENV === "test") {
  process.on("message", (message: unknown) => {
    if (
      typeof message === "object"
      && message !== null
      && "type" in message
      && (message as { type?: unknown }).type === "pos-platform.test.shutdown"
    ) {
      void terminate("test.control", 0);
    }
  });
}

function describeStartupError(error: unknown): Record<string, unknown> {
  if (error instanceof AggregateError) {
    return {
      name: error.name,
      message: error.message,
      errors: error.errors.map((nested) => describeStartupError(nested)),
    };
  }
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.cause === undefined ? {} : { cause: describeStartupError(error.cause) }),
    };
  }
  return { name: typeof error, message: String(error) };
}

try {
  const config = parseServiceConfig(process.env);
  if (process.platform !== "win32" && process.env.NODE_ENV !== "test") {
    throw new Error("POS Local Service production runtime requires Windows");
  }

  const localDatabase = new LocalDatabaseComponent(config.data_directory);
  const securityDirectory = join(config.data_directory, "security");
  const keyProvider: SecretStoreKeyProvider = process.platform === "win32"
    ? new WindowsDpapiKeyProvider(securityDirectory)
    : new InsecureDerivedKeyProvider(securityDirectory);
  const security = new LocalSecurityComponent(
    localDatabase,
    { installationId: config.installation_id, deviceId: config.device_id },
    keyProvider,
    securityDirectory,
  );

  const durableSync = new DurableSyncComponent(localDatabase);
  const operationConfirmation = new OperationConfirmationComponent(localDatabase, durableSync);
  mkdirSync(securityDirectory, { recursive: true, mode: 0o700 });
  const fiscalSecretStore = new EncryptedFileSecretStore(
    securityDirectory,
    keyProvider,
    fiscalCredentialContext({ installationId: config.installation_id, deviceId: config.device_id }),
  );

  const sessionTrustContext = await (async () => {
    if (
      config.session_trust_environment === undefined
      || config.session_trust_root_public_key_pem === undefined
    ) {
      return {
        resolution: { keys: new Map(), decision: "MISSING" as const },
        resolver: undefined,
      };
    }

    const sessionTrustStore = new SessionTrustKeyStore(new EncryptedFileSecretStore(
      securityDirectory,
      keyProvider,
      `session-trust:${config.installation_id}:${config.device_id}`,
    ));
    const sessionTrustVerifier = new SessionTrustKeyVerifier(
      createPublicKey(config.session_trust_root_public_key_pem),
      config.session_trust_environment,
    );
    const resolver = new SessionTrustKeyResolver(
      sessionTrustStore,
      sessionTrustVerifier,
      config.session_trust_artifact_path,
    );

    if (config.session_trust_transport_token_file !== undefined && config.central_base_url !== undefined) {
      try {
        const token = readSessionTrustTransportToken(config.session_trust_transport_token_file);
        const endpoint = new URL("/v1/session-trust", config.central_base_url).toString();
        const artifact = await new SessionTrustBundleFetcher().fetch(endpoint, token);
        return { resolution: resolver.resolveWithArtifact(artifact), resolver };
      } catch (error) {
        logger.log("warn", "session_trust.central_fetch_failed", {
          reason: error instanceof Error ? error.message : "unknown error",
          fallback: "protected_local_or_installer_artifact",
        });
      }
    }
    return { resolution: resolver.resolve(), resolver };
  })();
  const sessionTrustKeys = sessionTrustContext.resolution;
  // Keep the map identity stable: CommercialComponent's verifier reads it on
  // every activation, so runtime refresh can apply rotation/revocation in place.
  const liveSessionTrustKeys = new Map<string, TrustedSigningKey>(sessionTrustKeys.keys);

  const commercial = new CommercialComponent(
    config, localDatabase, durableSync, liveSessionTrustKeys, () => new Date(), fiscalSecretStore,
  );
  let localChannel: LocalChannelComponent | undefined;
  const components: RuntimeComponent[] = [
    localDatabase,
    security,
    durableSync,
    operationConfirmation,
    commercial,
  ];

  if (
    sessionTrustContext.resolver !== undefined
    && config.session_trust_transport_token_file !== undefined
    && config.central_base_url !== undefined
  ) {
    const resolver = sessionTrustContext.resolver;
    const tokenPath = config.session_trust_transport_token_file;
    const endpoint = new URL("/v1/session-trust", config.central_base_url).toString();
    components.push(new SessionTrustRefreshComponent(
      async () => new SessionTrustBundleFetcher().fetch(
        endpoint,
        readSessionTrustTransportToken(tokenPath),
      ),
      (artifact) => resolver.resolveWithArtifact(artifact),
      liveSessionTrustKeys,
      (event, detail) => {
        logger.log(event === "FAILED" || detail.decision === "INVALID" ? "warn" : "info",
          `session_trust.refresh_${event.toLowerCase()}`, detail);
      },
    ));
  }

  if (config.central_base_url !== undefined) {
    const centralBaseUrl = config.central_base_url;
    components.push(new CentralSyncComponent(
      () => new SyncDispatcher(
        durableSync.store,
        new FetchCentralTransport(),
        new UnprovisionedDeviceCredentialProvider(),
        centralBaseUrl,
        config.protocol_max,
      ),
      {
        tenantId: config.tenant_id,
        companyId: config.company_id,
        branchId: config.branch_id,
        deviceId: config.device_id,
        installationId: config.installation_id,
      },
      CENTRAL_SYNC_INTERVAL_MS,
      {
        onOutcome: (outcome) => {
          if (outcome.kind === "IDLE") return;
          logger.log(outcome.kind === "DELIVERED" ? "info" : "warn", "sync.dispatch", { ...outcome });
        },
        onLifecycle: (reason, detail) => {
          logger.log(reason === "STARTED" ? "info" : "warn", "sync.dispatch.lifecycle", { reason, ...detail });
        },
      },
    ));
  }

  if (process.platform === "win32") {
    localChannel = new LocalChannelComponent(
      config,
      localDatabase,
      () => lifecycle?.state ?? "STARTING",
      operationConfirmation,
      commercial,
    );
    components.push(localChannel);
  }

  lifecycle = new ServiceLifecycle(components);
  await lifecycle.start();
  logger.log("info", "runtime.started", {
    service_version: config.service_version,
    installation_id: config.installation_id,
    device_key_id: security.deviceKeyId,
    key_protection: security.protection,
    central_sync: config.central_base_url === undefined ? "NOT_CONFIGURED" : "CONFIGURED",
    session_trust: sessionTrustKeys.decision,
    fiscal_issuance: config.fiscal_environment === undefined ? "NOT_CONFIGURED" : "CONFIGURED",
    ...(localChannel === undefined ? {} : { local_channel_endpoint: localChannel.endpoint }),
  });
  await logger.flush();
} catch (error) {
  try {
    logger.log("error", "runtime.start_failed", { error: describeStartupError(error) });
    await logger.flush();
  } finally {
    process.exit(1);
  }
}
