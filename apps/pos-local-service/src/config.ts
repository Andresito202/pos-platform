import { isAbsolute, resolve } from "node:path";
import * as z from "zod";

const CONFIG_ENVIRONMENT_KEYS = new Set([
  "POS_DATA_DIRECTORY",
  "POS_INSTALLATION_ID",
  "POS_DEVICE_ID",
  "POS_SERVICE_VERSION",
  "POS_PROTOCOL_MIN",
  "POS_PROTOCOL_MAX",
]);

const ServiceConfigSchema = z.strictObject({
  data_directory: z.string().min(1),
  installation_id: z.uuid(),
  device_id: z.uuid(),
  service_version: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/),
  protocol_min: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/),
  protocol_max: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/),
});
export type ServiceConfig = z.infer<typeof ServiceConfigSchema>;

export function parseServiceConfig(environment: NodeJS.ProcessEnv): ServiceConfig {
  const unknownKeys = Object.keys(environment)
    .filter((key) => key.startsWith("POS_") && !CONFIG_ENVIRONMENT_KEYS.has(key))
    .sort();
  if (unknownKeys.length > 0) {
    throw new Error(`unknown POS service configuration: ${unknownKeys.join(", ")}`);
  }

  const parsed = ServiceConfigSchema.parse({
    data_directory: environment.POS_DATA_DIRECTORY,
    installation_id: environment.POS_INSTALLATION_ID,
    device_id: environment.POS_DEVICE_ID,
    service_version: environment.POS_SERVICE_VERSION,
    protocol_min: environment.POS_PROTOCOL_MIN,
    protocol_max: environment.POS_PROTOCOL_MAX,
  });
  if (!isAbsolute(parsed.data_directory)) {
    throw new Error("data directory must be absolute");
  }
  return { ...parsed, data_directory: resolve(parsed.data_directory) };
}
