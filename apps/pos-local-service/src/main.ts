import { StructuredLogger } from "@pos-platform/observability";
import { parseServiceConfig } from "./config.js";
import { ServiceLifecycle } from "./lifecycle.js";
import { LocalDatabaseComponent } from "./local-database-component.js";

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

try {
  const config = parseServiceConfig(process.env);
  const localDatabase = new LocalDatabaseComponent(config.data_directory);
  lifecycle = new ServiceLifecycle([localDatabase]);

  await lifecycle.start();
  logger.log("info", "runtime.started", {
    service_version: config.service_version,
    installation_id: config.installation_id,
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
