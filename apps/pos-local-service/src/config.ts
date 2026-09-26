import { isAbsolute, resolve } from "node:path";
import { ContractVersionSchema, StableCodeSchema, compareContractVersions } from "@pos-platform/contracts";
import { FiscalEnvironmentSchema } from "@pos-platform/fiscal-adapters";
import * as z from "zod";
import { DevRolePresetIdSchema } from "./dev-only/dev-role-presets.js";

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
  "POS_SESSION_TRUST_ENVIRONMENT",
  "POS_SESSION_TRUST_ROOT_PUBLIC_KEY_PEM",
  "POS_SESSION_TRUST_ARTIFACT_PATH",
  // `DEC-025`: artefacto de aprovisionamiento de sesión de operador. Ausente
  // significa equipo sin aprovisionar, que es un estado normal y no un error.
  "POS_OPERATOR_SESSION_ARTIFACT_PATH",
  // Revisión de pantallas por rol — NUNCA producción. Ver `dev-only/`.
  "POS_DEV_ROLE_PRESET",
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
  /**
   * El entorno contra el que se compara el `environment` del claim firmado.
   *
   * **Es `StableCodeSchema` porque el otro lado de la comparacion lo es.**
   * Admitia `z.string()` —minusculas incluidas— mientras el claim exige el
   * alfabeto estable, de modo que los dos extremos de la MISMA igualdad
   * aceptaban alfabetos distintos. Un valor fuera de ese alfabeto no podia
   * casar con ningun claim valido: lo unico que conseguia era arrancar el
   * servicio para que despues cada sesion fallara con `ENVIRONMENT_MISMATCH`,
   * sin decir donde estaba el error.
   *
   * Ahora falla al arrancar, nombrando el campo. Ninguna configuracion
   * legitima se pierde: la que se rechaza aqui nunca habria verificado nada.
   * Registrado en `D-30`.
   */
  session_trust_environment: StableCodeSchema.max(128).optional(),
  session_trust_root_public_key_pem: z.string().min(80).max(4096).optional(),
  /** Public signed bundle supplied by the installer; never contains private keys. */
  session_trust_artifact_path: z.string().min(1).max(4096).optional(),
  operator_session_artifact_path: z.string().min(1).max(4096).optional(),
  /**
   * Sesión de revisión de pantallas por rol, firmada con una clave generada
   * en este mismo arranque — ver `dev-only/dev-session-bootstrap.ts`. **No es
   * `SEC-G02` ni `DEC-025`.** Se rechaza junto con cualquier señal de que este
   * arranque no es una revisión local: un entorno de confianza declarado
   * `PRODUCTION`, o un artefacto real de sesión/confianza ya configurado. Un
   * equipo con las dos cosas a la vez no debe adivinar cuál gana: se niega a
   * arrancar y lo dice.
   */
  dev_role_preset: DevRolePresetIdSchema.optional(),
}).superRefine((value, context) => {
  if (compareContractVersions(value.protocol_min, value.protocol_max) > 0) {
    context.addIssue({ code: "custom", path: ["protocol_max"], message: "protocol_max must be greater than or equal to protocol_min" });
  }
  if ((value.session_trust_environment === undefined) !== (value.session_trust_root_public_key_pem === undefined)) {
    context.addIssue({ code: "custom", path: ["session_trust_environment"], message: "session trust environment and root public key must be configured together" });
  }
  if (value.session_trust_artifact_path !== undefined && !isAbsolute(value.session_trust_artifact_path)) {
    context.addIssue({ code: "custom", path: ["session_trust_artifact_path"], message: "session trust artifact path must be absolute" });
  }
  if (value.operator_session_artifact_path !== undefined && !isAbsolute(value.operator_session_artifact_path)) {
    context.addIssue({ code: "custom", path: ["operator_session_artifact_path"], message: "operator session artifact path must be absolute" });
  }
  if (value.dev_role_preset !== undefined) {
    if (value.session_trust_environment === "PRODUCTION") {
      context.addIssue({ code: "custom", path: ["dev_role_preset"], message: "dev role preset is refused when session_trust_environment is PRODUCTION" });
    }
    if (value.session_trust_artifact_path !== undefined || value.operator_session_artifact_path !== undefined) {
      context.addIssue({ code: "custom", path: ["dev_role_preset"], message: "dev role preset cannot coexist with a real session trust or operator session artifact" });
    }
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
    session_trust_environment: environment.POS_SESSION_TRUST_ENVIRONMENT,
    session_trust_root_public_key_pem: environment.POS_SESSION_TRUST_ROOT_PUBLIC_KEY_PEM,
    session_trust_artifact_path: environment.POS_SESSION_TRUST_ARTIFACT_PATH,
    operator_session_artifact_path: environment.POS_OPERATOR_SESSION_ARTIFACT_PATH,
    dev_role_preset: environment.POS_DEV_ROLE_PRESET,
  });
  if (!isAbsolute(parsed.data_directory)) throw new Error("data directory must be absolute");
  return { ...parsed, data_directory: resolve(parsed.data_directory) };
}
