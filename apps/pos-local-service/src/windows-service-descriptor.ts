/**
 * Descriptor de servicio Windows para WinSW.
 *
 * `DEC-010` §103 exige que el POS Local Service se instale como servicio de
 * Windows con inicio automático, y `main.ts` **no habla el protocolo del SCM**:
 * un proceso Node no puede llamar a `StartServiceCtrlDispatcher`. WinSW cubre
 * esa distancia —decisión aprobada tras el Bloque 7C— traduciendo las órdenes
 * del SCM a señales sobre el proceso hijo.
 *
 * Aquí **no se descarga ni se versiona `WinSW.exe`**: es un binario de terceros
 * y firmarlo depende del certificado que `RT-009-B` todavía no tiene. Lo que
 * este módulo produce es la **configuración declarativa**, que sí es del
 * proyecto, sí se versiona y sí se puede comprobar.
 *
 * La parada ordenada es la razón de ser del descriptor:
 *
 * ```
 * SCM  ──SERVICE_CONTROL_STOP──▶  WinSW  ──Ctrl+C──▶  node
 *                                                      │
 *                                       process.on("SIGINT") ─▶ terminate()
 *                                                      │
 *                            lifecycle.stop() ─▶ cierra SQLite, canal, logger
 * ```
 *
 * `main.ts` ya atiende `SIGINT`, y Node en Windows eleva `SIGINT` ante
 * `CTRL_C_EVENT`. Que WinSW lo emita de verdad en vez de terminar el proceso a
 * la brava es **`REQUIRES_LOCAL_VERIFICATION`**: era la condición que el Bloque
 * 7C señaló como capaz de invertir la decisión a favor de un host propio.
 */

/** Identificador del servicio en el SCM. Fija además el nombre de la cuenta virtual. */
export const SERVICE_ID = "CamachoPOSLocalService";
export const SERVICE_NAME = "Camacho POS Local Service";

/**
 * Cuenta de servicio virtual. La crea y gestiona el SCM al configurar el
 * servicio: **no tiene contraseña que nadie deba custodiar ni rotar**, y recibe
 * un SID propio con el que se pueden acotar `%ProgramData%` y la DACL del
 * named pipe. Satisface `DEC-010` §204 —mínimo privilegio— sin obligar a
 * inventar una política de credenciales.
 */
export const SERVICE_ACCOUNT = `NT SERVICE\\${SERVICE_ID}`;

/**
 * Política de recuperación, **derivada del propio repositorio**, no inventada.
 *
 * `DEFAULT_RETRY_POLICY` en `src/sync/durable-sync-store.ts` fija para el outbox
 * `maxAttempts: 5`, `baseDelayMs: 1_000`, `maxDelayMs: 60_000` con retroceso
 * exponencial. El servicio adopta la misma forma: cinco reintentos, 1 s
 * duplicando hasta el tope de 60 s.
 *
 * **Pendiente de ratificación.** El proyecto no ha fijado normativamente la
 * política de recuperación del *servicio*; ésta la hereda de la del *outbox*
 * por coherencia. Cambiar un número es una línea.
 */
export const RECOVERY_DELAYS_SECONDS: readonly number[] = [1, 2, 4, 8, 60];

/** Ventana tras la cual el SCM olvida los fallos acumulados. */
export const RECOVERY_RESET = "1 hour";

/**
 * Margen para la parada ordenada. `lifecycle.stop()` cierra SQLite con su
 * checkpoint, el canal y vacía el logger; agotarlo significaría matar el
 * proceso a mitad de esa secuencia.
 */
export const STOP_TIMEOUT = "30 sec";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Variables de entorno del servicio. Son **por instalación**, no constantes:
 * `config.ts` exige las nueve y rechaza cualquier `POS_*` que no conozca. El
 * instalador las aporta; este módulo sólo comprueba que estén todas.
 */
export const REQUIRED_ENVIRONMENT: readonly string[] = Object.freeze([
  "POS_DATA_DIRECTORY",
  "POS_INSTALLATION_ID",
  "POS_DEVICE_ID",
  "POS_SERVICE_VERSION",
  "POS_PROTOCOL_MIN",
  "POS_PROTOCOL_MAX",
  "POS_TENANT_ID",
  "POS_COMPANY_ID",
  "POS_BRANCH_ID",
]);

/**
 * Construye el descriptor.
 *
 * `nodeExecutable` y `bundle` son rutas de la instalación, no del repositorio:
 * el artefacto del Bloque 7D **no incluye el runtime de Node**, así que el
 * instalador tiene que depositarlo y nombrarlo aquí.
 */
export interface ServiceDescriptorInput {
  /** Runtime de Node que deposita el instalador. El artefacto no lo incluye. */
  readonly nodeExecutable: string;
  /** El bundle del servicio, ya extraído del artefacto. */
  readonly bundle: string;
  readonly workingDirectory: string;
  /** Las nueve variables que `parseServiceConfig` exige, ni una más. */
  readonly environment: Readonly<Record<string, string>>;
  /** Explicit installer intent. Never infer commercial readiness from base POS vars. */
  readonly commercialLogin?: boolean;
}

export function buildServiceDescriptor(input: ServiceDescriptorInput): string {
  // The installed WinSW service runs under NT SERVICE\\CamachoPOSLocalService.
  // Production Desktop currently obtains its channel secret through DPAPI
  // CurrentUser, while the pipe ACL is scoped to the server logon SID. Those
  // identities are not shared with an interactive Windows user. Refuse to
  // advertise commercial login support through this SCM descriptor until a
  // separately audited cross-session transport and secret handoff exist.
  if (input.commercialLogin === true || Object.hasOwn(input.environment, "POS_WINDOWS_COMMERCIAL_PROVISION_FILE")) {
    throw new Error("SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN");
  }
  const missing = REQUIRED_ENVIRONMENT.filter((key) => !(key in input.environment));
  if (missing.length > 0) {
    throw new Error(`service descriptor is missing required environment: ${missing.join(", ")}`);
  }
  const unexpected = Object.keys(input.environment).filter(
    (key) => !REQUIRED_ENVIRONMENT.includes(key),
  );
  if (unexpected.length > 0) {
    // `parseServiceConfig` rechaza cualquier `POS_*` desconocida: dejar pasar
    // una aquí produciría un servicio que no arranca y un diagnóstico opaco.
    throw new Error(`service descriptor carries unexpected environment: ${unexpected.join(", ")}`);
  }

  const lines = [
    "<service>",
    `  <id>${SERVICE_ID}</id>`,
    `  <name>${escapeXml(SERVICE_NAME)}</name>`,
    "  <description>Autoridad local de Camacho POS: base de datos, caja, venta, pago y sincronizacion.</description>",
    `  <executable>${escapeXml(input.nodeExecutable)}</executable>`,
    `  <arguments>${escapeXml(`"${input.bundle}"`)}</arguments>`,
    `  <workingdirectory>${escapeXml(input.workingDirectory)}</workingdirectory>`,
    "  <startmode>Automatic</startmode>",
    "  <serviceaccount>",
    `    <username>${escapeXml(SERVICE_ACCOUNT)}</username>`,
    "    <allowservicelogon>true</allowservicelogon>",
    "  </serviceaccount>",
    `  <stoptimeout>${STOP_TIMEOUT}</stoptimeout>`,
    // El proceso Node es el hijo directo: se le señala a él, no al grupo.
    "  <stopparentprocessfirst>false</stopparentprocessfirst>",
    ...RECOVERY_DELAYS_SECONDS.map(
      (seconds) => `  <onfailure action="restart" delay="${String(seconds)} sec"/>`,
    ),
    `  <resetfailure>${RECOVERY_RESET}</resetfailure>`,
    "  <log mode=\"roll-by-size\">",
    "    <sizeThreshold>10240</sizeThreshold>",
    "    <keepFiles>8</keepFiles>",
    "  </log>",
    ...REQUIRED_ENVIRONMENT.map(
      (key) => `  <env name="${key}" value="${escapeXml(input.environment[key] ?? "")}"/>`,
    ),
    "</service>",
  ];
  return `${lines.join("\n")}\n`;
}
