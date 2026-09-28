import { createPublicKey } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { StructuredLogger } from "@pos-platform/observability";
import { parseServiceConfig } from "./config.js";
import { ServiceLifecycle, type RuntimeComponent } from "./lifecycle.js";
import { LocalDatabaseComponent } from "./local-database-component.js";
import { LocalChannelComponent } from "./channel/index.js";
import { DurableSyncComponent } from "./sync/durable-sync-component.js";
import { SyncHealthReader } from "./sync/sync-health.js";
import { OperationConfirmationComponent } from "./operations/operation-confirmation-component.js";
import { CommercialComponent } from "./commercial/commercial-component.js";
import { UncertainProviderSweepComponent } from "./payments/uncertain-provider-sweep-component.js";
import { resolveWompiPaymentProvider } from "./payments/wompi/wompi-credential.js";
import { CentralSyncComponent } from "./sync/central-sync-component.js";
import { FetchCentralTransport } from "./sync/fetch-central-transport.js";
import { SyncDispatcher } from "./sync/sync-dispatcher.js";
import { UnprovisionedDeviceCredentialProvider } from "./sync/device-credential.js";
import { fiscalCredentialContext } from "./fiscal/fiscal-credential-store.js";
import {
  EncryptedFileSecretStore,
  InsecureDerivedKeyProvider,
  LocalSecurityComponent,
  TRUST_ANCHOR_PURPOSES,
  SessionTrustKeyResolver,
  SessionTrustKeyStore,
  SessionTrustKeyVerifier,
  WindowsDpapiKeyProvider,
  type SecretStoreKeyProvider,
} from "./security/index.js";
import { activateOperatorSessionArtifact, readOperatorSessionArtifact } from "./session/operator-session-artifact.js";
import { CentralLoginClient } from "./session/central-login-client.js";
import { OperatorLoginService } from "./session/operator-login-service.js";
import { DeviceEnrollmentService } from "./security/device-enrollment-service.js";
import { DeviceTrustCredentialStore } from "./security/device-trust-credential-store.js";
import { runDeviceEnrollment, writeDevicePublicIdentity } from "./security/device-enrollment-runner.js";
import {
  activateDevRoleSession,
  provisionDevRoleTrustAnchors,
  type DevRoleTrustMaterial,
} from "./dev-only/dev-session-bootstrap.js";
import { activateDevLabRegister } from "./dev-only/dev-lab-register.js";
import { TcpRawReceiptPrinter } from "./hardware/receipt-printer/tcp-raw-printer.js";
import { PrinterConnectedCashDrawer } from "./hardware/cash-drawer/cash-drawer.js";

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

/** Cadencia fija de despacho del outbox (`D-2`). */
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
        // Exit remains fail-closed if the logger is unavailable.
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
  // El proveedor de pagos, si este equipo tiene una credencial aprovisionada.
  //
  // `undefined` es un estado legitimo y silencioso: un equipo sin credencial no
  // cobra por QR y el barrido de inciertos queda `disabled`. Una credencial
  // presente pero rota, en cambio, detiene el arranque.
  const paymentProvider = resolveWompiPaymentProvider({
    securityDirectory,
    keyProvider,
    binding: { installationId: config.installation_id, deviceId: config.device_id },
  });

  mkdirSync(securityDirectory, { recursive: true, mode: 0o700 });
  const fiscalSecretStore = new EncryptedFileSecretStore(
    securityDirectory,
    keyProvider,
    fiscalCredentialContext({ installationId: config.installation_id, deviceId: config.device_id }),
  );

  // ── Confianza de sesion: emision y custodia son cosas distintas ────────────
  //
  // Dos ramas resolvieron esto por separado y la unificacion conserva **las
  // dos**, cada una en su papel:
  //
  //   artefacto de instalador  →  SessionTrustKeyResolver  →  local_trust_anchor
  //        (emision)                  (verificacion)            (custodia)
  //
  // El resolver verifica el artefacto publicado por la autoridad central contra
  // la clave raiz de configuracion; lo que sale de ahi se **provisiona** en el
  // ancla, y el ancla es la unica fuente que el runtime consulta. Asi la
  // rotacion y la revocacion siguen viviendo donde tienen estado
  // (`ACTIVE`/`VERIFY_ONLY`/`REVOKED`, por proposito) en vez de depender de que
  // el fichero del instalador siga presente y legible en cada arranque.
  //
  // Sin configuracion de confianza el resolver devuelve `MISSING` y no se
  // provisiona nada: el ancla queda como estuviera y `session.activate` falla
  // cerrado, que es el comportamiento correcto mientras nadie haya provisto
  // confianza.
  const sessionTrust = (() => {
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

  // Las claves de sesion se leen del ancla, siempre, y de forma perezosa: los
  // componentes se construyen todos antes de que arranque ninguno, y la
  // provision de arriba ocurre despues de `security.start()`.
  // Impresora de recibos (`D-46`). Se construye aquí para que una dirección
  // fuera de la red local restringida detenga el arranque, no la primera venta.
  const printerConfig = config.receipt_printer;
  const receiptPrinter = printerConfig === undefined
    ? null
    : {
      adapter: new TcpRawReceiptPrinter({
        deviceId: `tcp://${printerConfig.transport.host}:${String(printerConfig.transport.port)}`,
        host: printerConfig.transport.host,
        port: printerConfig.transport.port,
        connectTimeoutMs: printerConfig.transport.connect_timeout_ms,
        ioTimeoutMs: printerConfig.transport.io_timeout_ms,
        realtimeStatus: printerConfig.transport.realtime_status,
      }),
      profile: printerConfig.profile,
    };
  // El cajón cuelga del puerto RJ11/RJ12 de esa impresora (`HW-DRW-001`).
  const cashDrawer = receiptPrinter === null || printerConfig?.cash_drawer === undefined
    ? null
    : new PrinterConnectedCashDrawer(receiptPrinter.adapter, printerConfig.cash_drawer);
  logger.log("info", "hardware.cash_drawer", { configured: cashDrawer !== null });
  logger.log("info", "hardware.receipt_printer", receiptPrinter === null
    ? { configured: false }
    : { configured: true, adapter_id: receiptPrinter.adapter.adapterId, device_id: receiptPrinter.adapter.deviceId });

  const commercial = new CommercialComponent(
    config,
    localDatabase,
    durableSync,
    () => security.trustAnchors.keysFor("SESSION_ASSERTION"),
    () => new Date(),
    paymentProvider,
    fiscalSecretStore,
    undefined,
    receiptPrinter,
    cashDrawer,
  );
  // El barrido de intentos `UNKNOWN` (`D-5`/`D-6`). Resuelve su caso de uso al
  // arrancar —va detras de `commercial`, que es quien lo construye— y sin
  // `PaymentProviderPort` inyectado no arma temporizador alguno.
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
  // Provision de la confianza verificada en el ancla.
  //
  // **Es un componente, y su posicion en la lista es la correccion.** Estuvo
  // escrito despues de `lifecycle.start()`, y medido el 2026-09-20 arrancando
  // el servicio de verdad: `commercial` resuelve su mapa de claves una sola vez
  // en su propio `start()` —ceremonia deliberada de `DEC-011`, rotar exige
  // reiniciar— asi que provisionar despues dejaba al verificador con el mapa
  // VACIO de antes. Un equipo recien aprovisionado rechazaba su primera sesion
  // con `SIGNATURE_INVALID` —una `key_id` desconocida se reporta asi— y solo
  // funcionaba al SEGUNDO arranque, cuando la fila ya estaba en la tabla.
  //
  // Es decir: justo el arranque para el que se escribio `DEC-025` era el unico
  // que no podia funcionar. Va entre `security` —que abre el ancla— y
  // `commercial` —que la lee—, que es el orden que `LocalSecurityComponent`
  // ya describia en prosa y nada obligaba.
  //
  // Solo se provisiona lo que el verificador dio por `VALID`. Un artefacto
  // ausente (`MISSING`) deja el ancla como estuviera —un equipo ya
  // provisionado sigue funcionando aunque le retiren el fichero—, y uno
  // `INVALID` **no borra nada y no provisiona nada**: se registra y se sigue
  // fallando cerrado. Degradar el ancla existente por un artefacto corrupto
  // convertiria un fichero manipulable en una forma de dejar el equipo sin
  // confianza.
  const sessionTrustProvisioning: RuntimeComponent = {
    name: "session-trust-provisioning",
    start: async () => {
      if (sessionTrust.decision === "VALID") {
        for (const publication of sessionTrust.keys) {
          // El proposito lo pone la clave, no esta linea. Estuvo escrito
          // `"SESSION_ASSERTION"` a mano —era el unico que el contrato
          // admitia— y con ello el ancla de `AUTHORIZATION_SNAPSHOT` no tenia
          // forma de poblarse: `D-31`.
          security.trustAnchors.provision({
            purpose: publication.purpose,
            keyId: publication.keyId,
            publicKeySpki: publication.trusted.key
              .export({ type: "spki", format: "der" }).toString("base64url"),
            status: publication.trusted.status,
          });
        }
      }
      logger.log("info", "security.session_trust", {
        decision: sessionTrust.decision,
        provisioned: sessionTrust.decision === "VALID" ? sessionTrust.keys.length : 0,
      });
    },
    stop: async () => {},
  };

  // Ancla efímera de la sesión de revisión de pantallas por rol (`dev-only/`).
  //
  // Va en la lista de componentes, no en una llamada suelta después de
  // `lifecycle.start()`, por la misma razón que `sessionTrustProvisioning`:
  // `commercial` resuelve su mapa de claves de sesión una sola vez, dentro de
  // su propio `start()`. Provisionar el ancla después dejaría ese mapa vacío
  // de antes y `session.activate` rechazaría la SSA sintética con
  // `SIGNATURE_INVALID` — exactamente el defecto de orden que ya midió y
  // corrigió `sessionTrustProvisioning` para el artefacto real de `DEC-025`.
  // Por eso arranca entre `security` (que abre el ancla) y `commercial` (que
  // la lee), igual que aquél.
  let devRoleTrustMaterial: DevRoleTrustMaterial | undefined;
  const devRoleTrustProvisioning: RuntimeComponent = {
    name: "dev-role-trust-provisioning",
    start: async () => {
      if (config.dev_role_preset !== undefined) {
        devRoleTrustMaterial = provisionDevRoleTrustAnchors(security.trustAnchors);
      }
    },
    stop: async () => { devRoleTrustMaterial = undefined; },
  };

  let localChannel: LocalChannelComponent | undefined;
  const components: RuntimeComponent[] = [
    localDatabase,
    security,
    sessionTrustProvisioning,
    devRoleTrustProvisioning,
    durableSync,
    operationConfirmation,
    commercial,
    uncertainProviderSweep,
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

  // Login del operador contra la autoridad central (`DEC-026` §13.11). Todo
  // lo que necesita del equipo —credencial, clave, anclas— se resuelve de
  // forma perezosa, al iniciar sesión: los componentes aún no han arrancado.
  // La credencial vive en el mismo almacén cifrado que la identidad del
  // equipo, con su mismo contexto.
  const deviceCredentials = (): DeviceTrustCredentialStore => new DeviceTrustCredentialStore(security.secretStore);
  const operatorLogin = config.central_auth_url === undefined ? null : new OperatorLoginService({
    client: new CentralLoginClient(config.central_auth_url, new FetchCentralTransport()),
    device: () => {
      const store = deviceCredentials();
      if (!store.has()) return null;
      return {
        installationId: config.installation_id,
        deviceId: config.device_id,
        credential: store.load(),
        signChallenge: (challenge) => security.identity.signChallenge(challenge),
      };
    },
    activate: (artifact) => activateOperatorSessionArtifact(artifact, {
      sessionActivation: commercial.sessionActivation,
      authorizationSnapshotKeys: security.trustAnchors.keysFor("AUTHORIZATION_SNAPSHOT"),
      trustedClock: commercial.trustedClock,
      authorizationStore: commercial.authorizationStore,
      installationId: config.installation_id,
      deviceId: config.device_id,
    }),
  });

  if (process.platform === "win32") {
    localChannel = new LocalChannelComponent(
      config,
      localDatabase,
      () => lifecycle?.state ?? "STARTING",
      operationConfirmation,
      commercial,
      operatorLogin,
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
  // Cuántas anclas utilizables hay por propósito. Nunca qué claves son: el
  // recuento es operativo —dice si este equipo puede llegar a autenticar a
  // alguien— y no revela qué `key_id` existen. Un cero aquí explica por qué
  // `session.activate` responde `SIGNATURE_INVALID` a todo.
  //
  // Los recuentos viajan en **un solo campo de texto**, no una clave por
  // propósito. Medido el 2026-09-20 arrancando el servicio: con una clave por
  // propósito, `authorization_snapshot` casaba con el `SENSITIVE_KEY` del
  // logger —que incluye `authorization`— y el recuento salía `[REDACTED]`.
  // La red se comía justo el número que explica por qué no se puede operar.
  // No se estrecha la red: se deja de darle un nombre que la dispare.
  logger.log("info", "security.trust_anchors", {
    usable: TRUST_ANCHOR_PURPOSES
      .map((purpose) => `${purpose.toLowerCase()}=${String(security.trustAnchors.usableCount(purpose))}`)
      .join(" "),
  });
  // Aprovisionamiento inicial de sesión de operador (`DEC-025`).
  //
  // Ocurre **después** de provisionar el ancla, porque la verificación de los
  // dos sobres se hace contra ella: adelantarlo los rechazaría siempre.
  //
  // Los tres desenlaces se tratan distinto a propósito:
  //   ABSENT  — equipo sin aprovisionar. Estado normal, no error.
  //   INVALID — alguien tocó el fichero. No se activa nada y **no se degrada
  //             lo que hubiera**: un fichero manipulable no puede dejar el
  //             equipo sin sesión ni instalarle una falsa.
  //   PRESENT — se verifica y se activa por las rutas canónicas. Si la SSA no
  //             verifica no se intenta el snapshot: una sesión sin permisos
  //             arrancaría el POS para rechazarlo todo, que es peor que no
  //             arrancar sesión.
  const operatorSession = await (async () => {
    if (config.operator_session_artifact_path === undefined) {
      return { decision: "ABSENT" as const };
    }
    const read = readOperatorSessionArtifact(config.operator_session_artifact_path);
    if (read.decision !== "PRESENT") return read;

    return activateOperatorSessionArtifact(read.artifact, {
      sessionActivation: commercial.sessionActivation,
      authorizationSnapshotKeys: security.trustAnchors.keysFor("AUTHORIZATION_SNAPSHOT"),
      trustedClock: commercial.trustedClock,
      authorizationStore: commercial.authorizationStore,
      installationId: config.installation_id,
      deviceId: config.device_id,
    });
  })();

  // Nunca el operador ni el artefacto: sólo si este equipo quedó aprovisionado
  // y, cuando no, en qué paso se detuvo. Un `SNAPSHOT_REJECTED` explica por qué
  // la sesión existe y las operaciones responden `UNAUTHORIZED`.
  logger.log("info", "security.operator_session", operatorSession);

  // Identidad pública del equipo y, si hay activación, su enrolamiento
  // (`DEC-020` enmienda, `DEC-026` §13.11). Ninguno de los dos detiene el
  // arranque: un equipo sin enrolar vende con la sesión que tenga; lo único
  // que no puede es iniciar sesión nueva.
  const publishPublicIdentity = (): void => {
    writeDevicePublicIdentity({
      dataDirectory: config.data_directory,
      tenantId: config.tenant_id,
      companyId: config.company_id,
      installationId: config.installation_id,
      deviceId: config.device_id,
      identity: security.identity,
      enrolled: deviceCredentials().has(),
    });
  };
  publishPublicIdentity();
  logger.log("info", "device.public_identity", { device_key_id: security.deviceKeyId, enrolled: deviceCredentials().has() });

  if (
    config.central_auth_url !== undefined
    && config.device_enrollment_activation_path !== undefined
    && config.device_enrollment_token_path !== undefined
    && config.device_trust_root_public_key_pem !== undefined
    && config.device_trust_operational_key_id !== undefined
    && config.device_trust_operational_public_key_pem !== undefined
  ) {
    const enrollmentConfig = {
      centralAuthUrl: config.central_auth_url,
      activationPath: config.device_enrollment_activation_path,
      transportTokenPath: config.device_enrollment_token_path,
      rootPublicKeyPem: config.device_trust_root_public_key_pem,
      operationalKeyId: config.device_trust_operational_key_id,
      operationalPublicKeyPem: config.device_trust_operational_public_key_pem,
    };
    const enrollment = await runDeviceEnrollment({
      config: enrollmentConfig,
      service: new DeviceEnrollmentService(
        localDatabase.database,
        security.identity,
        { tenantId: config.tenant_id, companyId: config.company_id, installationId: config.installation_id, deviceId: config.device_id },
        () => new Date(),
        deviceCredentials(),
      ),
      credentialStore: deviceCredentials(),
      transport: new FetchCentralTransport(),
      clock: { now: () => new Date(), accept: (at) => commercial.trustedClock.accept(at) },
      signal: AbortSignal.timeout(60_000),
    }).catch((error: unknown) => ({
      outcome: "REJECTED" as const,
      reason: error instanceof Error && /^[A-Za-z0-9 _.:-]{1,160}$/.test(error.message) ? error.message : "ENROLLMENT_FAILED",
    }));
    logger.log(
      enrollment.outcome === "ENROLLED" || enrollment.outcome === "ALREADY_ENROLLED" ? "info" : "warn",
      "device.enrollment",
      { ...enrollment },
    );
    if (enrollment.outcome === "ENROLLED") publishPublicIdentity();
  }

  // Sesión de revisión de pantallas por rol (`dev-only/`) — nunca `DEC-025` ni
  // `SEC-G02`. `config.ts` ya rechaza esta variable si el equipo declara
  // `PRODUCTION` o si hay un artefacto real configurado, así que llegar aquí
  // con `dev_role_preset` definido significa que ninguna de esas dos guardas
  // saltó. Se registra en voz alta, precisamente porque no debe pasar
  // desapercibido.
  if (config.dev_role_preset !== undefined) {
    // Garantizado por `devRoleTrustProvisioning`, que corrió dentro de
    // `lifecycle.start()` cuando `config.dev_role_preset` está definido. Si
    // esto faltara sería un defecto de orden de arranque, no un estado
    // esperado — por eso se afirma en vez de degradarse en silencio.
    if (devRoleTrustMaterial === undefined) {
      throw new Error("dev role preset trust material missing: dev-role-trust-provisioning did not run");
    }
    const outcome = activateDevRoleSession(
      config.dev_role_preset,
      { installationId: config.installation_id, deviceId: config.device_id },
      devRoleTrustMaterial,
      security.trustAnchors,
      commercial.sessionActivation,
      commercial.authorizationStore,
      commercial.trustedClock,
    );
    logger.log(
      "warn",
      "security.dev_only_role_preset_active",
      { ...outcome, warning: "Sesión de desarrollo local para revisar pantallas por rol. No es SEC-G02. No usar en producción." },
    );

    // Sin emisor central (`B-3`) ninguna caja llega nunca a la proyección, y
    // sin caja no hay turno que revisar. Ver `dev-only/dev-lab-register.ts`.
    const register = activateDevLabRegister(
      localDatabase.database,
      commercial.trustedClock,
      { tenantId: config.tenant_id, companyId: config.company_id, branchId: config.branch_id },
    );
    logger.log(
      "warn",
      "master_data.dev_only_lab_register",
      { ...register, warning: "Caja de laboratorio firmada con clave efímera. No es DEC-013. No usar en producción." },
    );
  }

  // Salud de la cola de salida (`UC-SYNC-003` §Observabilidad). Se emite en
  // el arranque y no en un temporizador: la cadencia de muestreo es parte de
  // la política técnica versionada que `DEC-007` §1300 exige y que todavía no
  // existe, así que elegir un intervalo aquí sería inventarla.
  //
  // Aun emitida una sola vez, es la diferencia entre reiniciar el servicio y
  // enterarse, o reiniciarlo y seguir a ciegas: con la cola bloqueada por una
  // dead letter, `outbox_depth`, `oldest_pending_age_ms` y `checkpoint_lag`
  // crecen y no vuelven a bajar solos.
  const syncScope = {
    tenantId: config.tenant_id,
    companyId: config.company_id,
    branchId: config.branch_id,
    deviceId: config.device_id,
    installationId: config.installation_id,
  };
  const syncHealth = new SyncHealthReader(localDatabase.database).read(syncScope);
  logger.log("info", "sync.health", {
    outbox_depth: syncHealth.outboxDepth,
    pending: syncHealth.pending,
    in_flight: syncHealth.inFlight,
    retry_waiting: syncHealth.retryWaiting,
    dead_letter: syncHealth.deadLetter,
    oldest_pending_age_ms: syncHealth.oldestPendingAgeMs,
    checkpoint_lag: syncHealth.checkpointLag,
    checkpoint_sequence: syncHealth.checkpointSequence,
    highest_local_sequence: syncHealth.highestLocalSequence,
    verdict_server_accepted: syncHealth.verdicts.serverAccepted,
    verdict_server_rejected: syncHealth.verdicts.serverRejected,
    verdict_conflict: syncHealth.verdicts.conflict,
    verdict_review_required: syncHealth.verdicts.reviewRequired,
    verdict_waiting_for_dependency: syncHealth.verdicts.waitingForDependency,
  });
  logger.log("info", "runtime.started", {
    service_version: config.service_version,
    installation_id: config.installation_id,
    device_key_id: security.deviceKeyId,
    key_protection: security.protection,
    central_sync: config.central_base_url === undefined ? "NOT_CONFIGURED" : "CONFIGURED",
    session_trust: sessionTrust.decision,
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
