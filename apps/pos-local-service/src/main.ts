import { join } from "node:path";
import { StructuredLogger } from "@pos-platform/observability";
import { parseServiceConfig } from "./config.js";
import { ServiceLifecycle, type RuntimeComponent } from "./lifecycle.js";
import { LocalDatabaseComponent } from "./local-database-component.js";
import { LocalChannelComponent } from "./channel/index.js";
import { DurableSyncComponent } from "./sync/durable-sync-component.js";
import { OperationConfirmationComponent } from "./operations/operation-confirmation-component.js";
import { CommercialComponent } from "./commercial/commercial-component.js";
import { UncertainProviderSweepComponent } from "./payments/uncertain-provider-sweep-component.js";
import { resolveWompiPaymentProvider } from "./payments/wompi/wompi-credential.js";
import {
  InsecureDerivedKeyProvider,
  LocalSecurityComponent,
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
        // The logger can already be failed or saturated. Exit still proceeds fail-closed.
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

  // DEC-020. La rama es por plataforma y no consulta el entorno: en Windows no
  // existe ruta alguna hacia el proveedor de pruebas. La produccion exige
  // Windows —lo impone el guard de arriba— de modo que la segunda rama solo es
  // alcanzable donde la produccion ya esta prohibida.
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
  // El mapa de claves de sesión llega vacío: no existe aprovisionamiento de
  // claves en el runtime (`LIC-003`/`DEV-003`), de modo que `session.activate`
  // falla cerrado hasta que exista. Se prefiere la negativa a una confianza
  // fabricada.
  // El proveedor de pagos, si este equipo tiene una credencial aprovisionada.
  //
  // Se resuelve aqui y no dentro de un componente porque `CommercialComponent`
  // lo necesita ya construido, y el almacen cifrado no depende del ciclo de
  // vida: `resolveWompiPaymentProvider` abre el suyo con su propio contexto,
  // igual que el secreto del canal local. Comparte `keyProvider` sin compartir
  // clave — el proveedor de clave raiz indexa por contexto.
  //
  // `undefined` es un estado legitimo y silencioso en el dominio: un equipo sin
  // credencial no cobra por QR y el barrido de inciertos queda `disabled`. Una
  // credencial presente pero rota, en cambio, detiene el arranque.
  const paymentProvider = resolveWompiPaymentProvider({
    securityDirectory,
    keyProvider,
    binding: { installationId: config.installation_id, deviceId: config.device_id },
  });

  const commercial = new CommercialComponent(
    config,
    localDatabase,
    durableSync,
    new Map(),
    () => new Date(),
    paymentProvider,
  );
  // El barrido de intentos `UNKNOWN` (`D-5`/`D-6`). Resuelve su caso de uso al
  // arrancar —va detras de `commercial`, que es quien lo construye— y sin
  // `PaymentProviderPort` inyectado no arma temporizador alguno: hoy ese es el
  // caso, y el log lo dice en vez de callarlo.
  const uncertainProviderSweep = new UncertainProviderSweepComponent(
    () => commercial.sweepUncertainProviderPayments,
    {
      tenantId: config.tenant_id,
      companyId: config.company_id,
      branchId: config.branch_id,
      deviceId: config.device_id,
      installationId: config.installation_id,
    },
    logger,
  );
  let localChannel: LocalChannelComponent | undefined;
  // `security` va inmediatamente despues de la base de datos y antes que todo
  // lo demas: ninguna operacion comercial se sirve si el equipo no pudo
  // materializar su identidad.
  const components: RuntimeComponent[] = [
    localDatabase,
    security,
    durableSync,
    operationConfirmation,
    commercial,
    uncertainProviderSweep,
  ];

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
  // Que hay proveedor, nunca cual es: ni la clave publica entra aqui. El
  // redactor del logger es una red, no una excusa para acercarle un secreto.
  logger.log("info", "payments.provider", paymentProvider === undefined
    ? { configured: false, reason: "NOT_PROVISIONED" }
    : { configured: true, provider_code: "WOMPI" });
  logger.log("info", "runtime.started", {
    service_version: config.service_version,
    installation_id: config.installation_id,
    device_key_id: security.deviceKeyId,
    // `key_protection`, no `secret_protection`: el redactor del logger
    // convierte en `[REDACTED]` todo campo cuyo nombre contenga «secret».
    // El nombre se adapta al redactor; el redactor no se toca.
    key_protection: security.protection,
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
