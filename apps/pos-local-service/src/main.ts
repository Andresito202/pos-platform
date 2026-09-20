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
import { readOperatorSessionArtifact, ArtifactSnapshotProvider } from "./session/operator-session-artifact.js";
import { SnapshotAcquisitionService } from "./authorization/snapshot-acquisition.js";
import { AuthorizationSnapshotVerifier } from "./security/authorization-snapshot-verifier.js";

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
  const commercial = new CommercialComponent(
    config,
    localDatabase,
    durableSync,
    () => security.trustAnchors.keysFor("SESSION_ASSERTION"),
    () => new Date(),
    paymentProvider,
    fiscalSecretStore,
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

  let localChannel: LocalChannelComponent | undefined;
  const components: RuntimeComponent[] = [
    localDatabase,
    security,
    sessionTrustProvisioning,
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

    const binding = {
      userId: read.artifact.session_assertion.claims.user_id,
      installationId: config.installation_id,
      deviceId: config.device_id,
    };

    const activation = commercial.sessionActivation.activate(
      read.artifact.session_assertion, binding,
    );
    if (activation.kind !== "ACTIVATED") {
      // `REJECTED` a secas no dice nada: es el nombre del desenlace, no su
      // causa. Se emite la decisión del verificador, que es el dato que
      // distingue «firma que no cuadra» de «SSA vencida» o «binding de otro
      // equipo». No es exposición nueva: `session.activate` ya devuelve ese
      // mismo `decision` al llamador por IPC.
      return {
        decision: "SESSION_REJECTED" as const,
        detail: activation.kind === "REJECTED" ? activation.decision : activation.kind,
      };
    }

    const acquisition = await new SnapshotAcquisitionService(
      new ArtifactSnapshotProvider(read.artifact),
      new AuthorizationSnapshotVerifier(
        security.trustAnchors.keysFor("AUTHORIZATION_SNAPSHOT"),
        commercial.trustedClock,
      ),
      commercial.authorizationStore,
    ).acquire(binding);
    if (acquisition.kind !== "ACQUIRED") {
      return { decision: "SNAPSHOT_REJECTED" as const, detail: acquisition.kind };
    }
    return { decision: "PROVISIONED" as const };
  })();

  // Nunca el operador ni el artefacto: sólo si este equipo quedó aprovisionado
  // y, cuando no, en qué paso se detuvo. Un `SNAPSHOT_REJECTED` explica por qué
  // la sesión existe y las operaciones responden `UNAUTHORIZED`.
  logger.log("info", "security.operator_session", operatorSession);

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
