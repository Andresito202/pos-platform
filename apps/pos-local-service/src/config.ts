import { isAbsolute, resolve } from "node:path";
import { ContractVersionSchema, compareContractVersions } from "@pos-platform/contracts";
import * as z from "zod";

const CONFIG_ENVIRONMENT_KEYS = new Set([
  "POS_DATA_DIRECTORY",
  "POS_INSTALLATION_ID",
  "POS_DEVICE_ID",
  "POS_SERVICE_VERSION",
  "POS_PROTOCOL_MIN",
  "POS_PROTOCOL_MAX",
  "POS_TENANT_ID",
  "POS_COMPANY_ID",
  "POS_BRANCH_ID",
  "POS_CENTRAL_BASE_URL",
]);

const ServiceConfigSchema = z.strictObject({
  data_directory: z.string().min(1),
  installation_id: z.uuid(),
  device_id: z.uuid(),
  service_version: ContractVersionSchema,
  protocol_min: ContractVersionSchema,
  protocol_max: ContractVersionSchema,
  /**
   * Self-asserted local configuration, same trust tier as installation_id and
   * device_id above — not derived from a cryptographically verified source.
   * Deriving tenant_id/company_id from the signed license claims
   * (packages/contracts/src/local-security.ts) is the target design, but
   * requires license-provisioning machinery (LIC-003/DEV-003) that does not
   * exist yet; branch_id has no signed source at all today. Tracked as a
   * known gap pending SEC-G01/TenantMembership.
   */
  tenant_id: z.uuid(),
  company_id: z.uuid(),
  branch_id: z.uuid(),
  /**
   * Origen de la API central (`D-2`). Ausente significa «este equipo no tiene
   * autoridad a la que hablar»: el outbox acumula durablemente y no se despacha
   * nada, que es el comportamiento correcto de un sistema local-first sin
   * conexion (`DEC-007`).
   *
   * Solo transporta el origen. **Ninguna credencial llega por el entorno**: la
   * credencial de dispositivo es responsabilidad de `DeviceCredentialProvider`,
   * que hoy se niega por falta de aprovisionamiento (`DEC-008`).
   */
  central_base_url: z.url().startsWith("https://").max(2048).optional(),
}).superRefine((value, context) => {
  if (compareContractVersions(value.protocol_min, value.protocol_max) > 0) {
    context.addIssue({
      code: "custom",
      path: ["protocol_max"],
      message: "protocol_max must be greater than or equal to protocol_min",
    });
  }
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
    tenant_id: environment.POS_TENANT_ID,
    company_id: environment.POS_COMPANY_ID,
    branch_id: environment.POS_BRANCH_ID,
    central_base_url: environment.POS_CENTRAL_BASE_URL,
  });
  if (!isAbsolute(parsed.data_directory)) {
    throw new Error("data directory must be absolute");
  }
  return { ...parsed, data_directory: resolve(parsed.data_directory) };
}
