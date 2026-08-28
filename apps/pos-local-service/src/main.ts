import { StructuredLogger } from "@pos-platform/observability";
import { parseServiceConfig } from "./config.js";
import { ServiceLifecycle } from "./lifecycle.js";

const logger = new StructuredLogger({ write: (record) => process.stdout.write(`${JSON.stringify(record)}\n`) });
const config = parseServiceConfig(process.env);
const lifecycle = new ServiceLifecycle([]);

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  logger.log("info", "runtime.stopping", { signal });
  await lifecycle.stop();
  logger.log("info", "runtime.stopped");
};

await lifecycle.start();
logger.log("info", "runtime.started", { service_version: config.service_version, installation_id: config.installation_id });
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => { void shutdown(signal).then(() => process.exit(0), (error) => {
    logger.log("error", "runtime.stop_failed", { error });
    process.exit(1);
  }); });
}
