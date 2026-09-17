import { createPublicKey } from "node:crypto";
import { mkdirSync } from "node:fs";
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
  WindowsDpapiKeyProvider,
  type SecretStoreKeyProvider,
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

const CENTRAL_SYNC_INTERVAL_MS = 30_000;

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

  const sessionTrustKeys = (() => {
    if (
      config.session_trust_environment === undefined
      || config.session_trust_root_public_key_pem === undefined
    ) {
      return { keys: new Map(), decision: "MISSING" as const };
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
    return new SessionTrustKeyResolver(
      sessionTrustStore,
      sessionTrustVerifier,
      config.session_trust_artifact_path,
    ).resolve();
  })();

  const commercial = new CommercialComponent(
    config, localDatabase, durableSync, sessionTrustKeys.keys, () => new Date(), fiscalSecretStore,
  );
  let localChannel: LocalChannelComponent | undefined;
  const components: RuntimeComponent[] = [
    localDatabase,
    security,
    durableSync,
    operationConfirmation,
    commercial,
  ];

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
    logger.log("error", "runtime.start_failed", { error });
    await logger.flush();
  } finally {
    process.exit(1);
  }
}
