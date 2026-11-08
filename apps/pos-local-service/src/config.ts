import { isAbsolute, resolve } from "node:path";
import { ContractVersionSchema, compareContractVersions } from "@pos-platform/contracts";
import { FiscalEnvironmentSchema } from "@pos-platform/fiscal-adapters";
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
  "POS_FISCAL_ENVIRONMENT",
  "POS_HARDWARE_PROFILES_FILE",
  "POS_HARDWARE_AUTOMATIC_DRAWER_POLICY_FILE",
  "POS_SESSION_TRUST_ENVIRONMENT",
  "POS_SESSION_TRUST_ROOT_PUBLIC_KEY_PEM",
  "POS_SESSION_TRUST_ARTIFACT_PATH",
  "POS_SESSION_TRUST_TRANSPORT_TOKEN_FILE",
  "POS_AUTHORIZATION_TRUST_PROVISION_FILE",
  "POS_WINDOWS_COMMERCIAL_PROVISION_FILE",
  "POS_LICENSE_CAPACITY_PROVISION_FILE",
  "POS_QR001_PUBLIC_KEY_FILE",
  "POS_QR001_KEY_ID",
  "POS_QR001_ENVIRONMENT",
]);

const ServiceConfigSchema = z.strictObject({
  data_directory: z.string().min(1),
  installation_id: z.uuid(),
  device_id: z.uuid(),
  service_version: ContractVersionSchema,
  protocol_min: ContractVersionSchema,
  protocol_max: ContractVersionSchema,
  tenant_id: z.uuid(),
  company_id: z.uuid(),
  branch_id: z.uuid(),
  central_base_url: z.url().startsWith("https://").max(2048).optional(),
  fiscal_environment: FiscalEnvironmentSchema.optional(),
  hardware_profiles_file:z.string().refine(isAbsolute).optional(),
  windows_commercial_provision_file:z.string().refine(isAbsolute).optional(),
  license_capacity_provision_file:z.string().refine(isAbsolute).optional(),
  qr001_public_key_file:z.string().refine(isAbsolute).optional(),
  qr001_key_id:z.string().regex(/^[A-Za-z0-9._-]{1,96}$/).optional(),
  qr001_environment:z.enum(["SANDBOX","STAGING","PRODUCTION"]).optional(),
  hardware_automatic_drawer_policy_file:z.string().refine(isAbsolute).optional(),
  session_trust_environment: z.string().min(1).max(128).optional(),
  session_trust_root_public_key_pem: z.string().min(80).max(4096).optional(),
  /** Public signed bundle supplied by the installer; never contains private keys. */
  session_trust_artifact_path: z.string().min(1).max(4096).optional(),
  /** Path to the deployment-managed bearer token for the public trust endpoint. */
  session_trust_transport_token_file: z.string().min(1).max(4096).optional(),
  authorization_trust_provision_file:z.string().refine(isAbsolute).optional(),
}).superRefine((value, context) => {
  const qrParts=[value.qr001_public_key_file,value.qr001_key_id,value.qr001_environment];
  if(qrParts.some(x=>x!==undefined)&&(!qrParts.every(x=>x!==undefined)||value.central_base_url===undefined))
    context.addIssue({code:"custom",path:["qr001_public_key_file"],message:"QR001 requires complete key, environment and Central HTTPS"});
  if (compareContractVersions(value.protocol_min, value.protocol_max) > 0) {
    context.addIssue({ code: "custom", path: ["protocol_max"], message: "protocol_max must be greater than or equal to protocol_min" });
  }
  if ((value.session_trust_environment === undefined) !== (value.session_trust_root_public_key_pem === undefined)) {
    context.addIssue({ code: "custom", path: ["session_trust_environment"], message: "session trust environment and root public key must be configured together" });
  }
  if (value.session_trust_artifact_path !== undefined && !isAbsolute(value.session_trust_artifact_path)) {
    context.addIssue({ code: "custom", path: ["session_trust_artifact_path"], message: "session trust artifact path must be absolute" });
  }
  if (value.session_trust_transport_token_file !== undefined && !isAbsolute(value.session_trust_transport_token_file)) {
    context.addIssue({ code: "custom", path: ["session_trust_transport_token_file"], message: "session trust transport token file path must be absolute" });
  }
  if (value.session_trust_transport_token_file !== undefined && value.central_base_url === undefined) {
    context.addIssue({ code: "custom", path: ["session_trust_transport_token_file"], message: "session trust transport token requires POS_CENTRAL_BASE_URL" });
  }
  if (value.session_trust_transport_token_file !== undefined && value.session_trust_root_public_key_pem === undefined) {
    context.addIssue({ code: "custom", path: ["session_trust_transport_token_file"], message: "central session trust distribution requires the configured root public key and environment" });
  }
});
export type ServiceConfig = z.infer<typeof ServiceConfigSchema>;

export function parseServiceConfig(environment: NodeJS.ProcessEnv): ServiceConfig {
  const unknownKeys = Object.keys(environment).filter((key) => key.startsWith("POS_") && !CONFIG_ENVIRONMENT_KEYS.has(key)).sort();
  if (unknownKeys.length > 0) throw new Error(`unknown POS service configuration: ${unknownKeys.join(", ")}`);

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
    fiscal_environment: environment.POS_FISCAL_ENVIRONMENT,
    hardware_profiles_file:environment.POS_HARDWARE_PROFILES_FILE,
    hardware_automatic_drawer_policy_file:environment.POS_HARDWARE_AUTOMATIC_DRAWER_POLICY_FILE,
    session_trust_environment: environment.POS_SESSION_TRUST_ENVIRONMENT,
    session_trust_root_public_key_pem: environment.POS_SESSION_TRUST_ROOT_PUBLIC_KEY_PEM,
    session_trust_artifact_path: environment.POS_SESSION_TRUST_ARTIFACT_PATH,
    session_trust_transport_token_file: environment.POS_SESSION_TRUST_TRANSPORT_TOKEN_FILE,
    windows_commercial_provision_file: environment.POS_WINDOWS_COMMERCIAL_PROVISION_FILE,
    license_capacity_provision_file: environment.POS_LICENSE_CAPACITY_PROVISION_FILE,
    qr001_public_key_file:environment.POS_QR001_PUBLIC_KEY_FILE,
    qr001_key_id:environment.POS_QR001_KEY_ID,
    qr001_environment:environment.POS_QR001_ENVIRONMENT,
    authorization_trust_provision_file:environment.POS_AUTHORIZATION_TRUST_PROVISION_FILE,
  });
  if (!isAbsolute(parsed.data_directory)) throw new Error("data directory must be absolute");
  return { ...parsed, data_directory: resolve(parsed.data_directory) };
}
