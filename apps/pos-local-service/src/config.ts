import { isAbsolute, resolve } from "node:path";
import * as z from "zod";

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
  const parsed = ServiceConfigSchema.parse({
    data_directory: environment.POS_DATA_DIRECTORY,
    installation_id: environment.POS_INSTALLATION_ID,
    device_id: environment.POS_DEVICE_ID,
    service_version: environment.POS_SERVICE_VERSION,
    protocol_min: environment.POS_PROTOCOL_MIN,
    protocol_max: environment.POS_PROTOCOL_MAX,
  });
  const directory = resolve(parsed.data_directory);
  if (!isAbsolute(directory)) throw new Error("data directory must resolve to an absolute path");
  return { ...parsed, data_directory: directory };
}
