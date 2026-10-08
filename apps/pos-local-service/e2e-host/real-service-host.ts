import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import { LocalChannelAuthenticator, localChannelEndpoint } from "@pos-platform/local-channel";
import {
  LocalChannelServer,
  unsignedAuthorizationSnapshotBytes,
  unsignedSessionAssertionBytes,
  type TrustedSigningKey,
} from "../src/index.js";
import { DurableSyncStore } from "../src/sync/durable-sync-store.js";
import { SqliteAuthorizationSnapshotStore } from "../src/authorization/sqlite-authorization-snapshot-store.js";
import { CommercialComponent } from "../src/commercial/commercial-component.js";
import { CommercialRequestHandler } from "../src/commercial/commercial-request-handler.js";
import { EncryptedFileSecretStore, InsecureDerivedKeyProvider } from "../src/security/index.js";
import { FiscalCredentialStore, fiscalCredentialContext } from "../src/fiscal/fiscal-credential-store.js";
import type { ServiceConfig } from "../src/config.js";
import type { AuthorizationSnapshotClaims, SessionAssertionClaims } from "@pos-platform/contracts";
import { PermissionCode } from "@pos-platform/contracts";
import {
  FACTUS_ADAPTER_DECLARATION,
  type DocumentIssuanceOutcome,
  type DocumentIssuancePort,
  type FrozenDocumentPayload,
  type PayloadValidationResult,
} from "@pos-platform/fiscal-adapters";

/**
 * POS Local Service **real** como proceso independiente, para verificar el
 * canal contra un Electron real.
 *
 * No es un doble ni un simulador: levanta `LocalChannelServer`,
 * `CommercialComponent` y SQLite de producción, y los puentea igual que
 * `local-channel-component.ts`. Lo único que aporta el arnés es el secreto del
 * canal y el material criptográfico de la sesión, que en producción resuelven
 * DPAPI y el emisor central —piezas que aquí no existen y que **no se simulan**:
 * simplemente se inyectan desde fuera.
 *
 * Vive fuera de `src/` a propósito. No forma parte del servicio distribuible:
 * es andamiaje de verificación, y mezclarlo con el runtime sería exactamente el
 * tipo de confusión que este proyecto persigue.
 *
 * TODO EL MATERIAL CRIPTOGRÁFICO ES EXCLUSIVO DE VERIFICACIÓN: se genera en
 * memoria, no se persiste y no sustituye a un trust anchor de producción.
 *
 * Protocolo con el proceso que lo lanza: imprime una línea JSON en `stdout`
 * —`{"ready":true,...}`— con lo que la prueba necesita, y se apaga con SIGTERM.
 */

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`missing ${name}`);
  return value;
}

const DATA_DIRECTORY = required("POS_E2E_DATA_DIR");
const SECRET = Buffer.from(required("POS_E2E_CHANNEL_SECRET"), "hex");
const TENANT = required("POS_E2E_TENANT_ID");
const COMPANY = required("POS_E2E_COMPANY_ID");
const BRANCH = required("POS_E2E_BRANCH_ID");
const INSTALLATION = required("POS_E2E_INSTALLATION_ID");
const DEVICE = required("POS_E2E_DEVICE_ID");
const USER = required("POS_E2E_USER_ID");
const REGISTER = required("POS_E2E_REGISTER_ID");

const MEMBERSHIP = "018f0000-0000-7000-8000-0000000000b1";
const SSA_SESSION = "018f0000-0000-7000-8000-0000000000b0";
const SESSION_KEY_ID = "SESSION_KEY_1";
const NOW = new Date("2026-09-03T12:00:00.000Z");

const PERMISSIONS = Object.values(PermissionCode);

const keyPair = generateKeyPairSync("ed25519");

function config(): ServiceConfig {
  return {
    tenant_id: TENANT,
    company_id: COMPANY,
    branch_id: BRANCH,
    device_id: DEVICE,
    installation_id: INSTALLATION,
    protocol_min: "1.0.0",
    protocol_max: "1.0.0",
    // `DEC-021` F5. En produccion lo pone `POS_FISCAL_ENVIRONMENT`; aqui va
    // fijo a SANDBOX porque la credencial que deposita el arnes es de prueba.
    fiscal_environment: "SANDBOX",
  } as ServiceConfig;
}

/**
 * Puerto de emision falso y determinista.
 *
 * Es la **unica** pieza del tramo fiscal que el arnes sustituye, y sustituirla
 * no es opcional: hablar de verdad con FACTUS es `F6`, y `F6` corre solo en el
 * equipo del propietario con credenciales que no estan —ni deben estar— aqui.
 * Todo lo demas del tramo es de produccion: contrato, canal, handler, caso de
 * uso, maquina de estados y SQLite.
 */
class FakeIssuancePort implements DocumentIssuancePort {
  validatePayload(_document: FrozenDocumentPayload): Promise<PayloadValidationResult> {
    return Promise.resolve({ kind: "VALID" });
  }
  issue(): Promise<DocumentIssuanceOutcome> {
    return Promise.resolve({
      kind: "EVIDENCED",
      transportStatus: "COMPLETED",
      normalizedResult: "ACCEPTED",
      externalIdentity: {
        providerOperationId: "e2e-op", providerDocumentId: "e2e-doc",
        prefix: "SETP", number: "990000001", cufe: "a".repeat(96),
      },
      providerStatus: { providerCode: "0", providerStatus: "processed", httpStatus: 200 },
    });
  }
}

/**
 * Rango de numeracion, tal como lo dejaria `SynchronizeNumberingRangesUseCase`
 * tras hablar con el proveedor.
 *
 * Se siembra porque **si** existe la via real que lo produce —el puerto esta
 * `SANDBOX_VERIFIED` y el caso de uso que lo persiste tambien existe—, sólo que
 * todavia no cuelga de ninguna pantalla. Sembrarlo aqui representa un estado
 * que el sistema sabe alcanzar por si mismo.
 *
 * El atributo fiscal de la presentacion **no se siembra**, y esa asimetria es
 * deliberada: `D-19` dice que hoy no existe ruta alguna que lo inserte, ni de
 * usuario ni de servicio. Fabricarlo aqui haria pasar el E2E afirmando una
 * capacidad que el producto no tiene.
 */
function seedFiscalRange(database: LocalDatabase): void {
  const at = NOW.toISOString();
  database.native.prepare(`
    INSERT OR IGNORE INTO fiscal_numbering_range(
      tenant_id,company_id,provider,environment,range_id,document_type,prefix,authority,
      resolution_number,range_from,range_to,current_number,valid_from,valid_until,
      provider_active,provider_expired,provider_document_code,synchronized_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    TENANT, COMPANY, "FACTUS", "SANDBOX", "FACTUS-RANGE-E2E", "SALES_INVOICE", "SETP", "PROVIDER",
    "18760000001", 1, 5000, 0, "2026-01-01", "2027-01-01", 1, 0, "01", at,
  );
}

function authorizationClaims(): AuthorizationSnapshotClaims {
  return {
    snapshot_id: "018f0000-0000-7000-8000-0000000000c0",
    user_id: USER,
    installation_id: INSTALLATION,
    device_id: DEVICE,
    sequence: 1,
    issued_at: "2026-09-03T00:00:00.000Z",
    expires_at: "2026-09-04T00:00:00.000Z",
    assignments: [
      {
        tenant_id: TENANT,
        company_id: COMPANY,
        branch_id: BRANCH,
        status: "ACTIVE",
        valid_from: "2026-09-01T00:00:00.000Z",
        valid_until: null,
        role_status: "ACTIVE",
        permissions: PERMISSIONS.map((code) => ({ code, status: "ACTIVE" as const })),
      },
    ],
    key_id: "AUTHZ_KEY_1",
  } as AuthorizationSnapshotClaims;
}

function sessionClaims(): SessionAssertionClaims {
  return {
    session_id: SSA_SESSION,
    user_id: USER,
    tenant_membership_id: MEMBERSHIP,
    installation_id: INSTALLATION,
    device_id: DEVICE,
    issued_at: "2026-09-03T00:00:00.000Z",
    offline_valid_until: "2026-09-04T00:00:00.000Z",
    sequence: 1,
    key_id: SESSION_KEY_ID,
  } as SessionAssertionClaims;
}

function seedRegister(database: LocalDatabase): void {
  const at = "2026-09-01T00:00:00.000Z";
  database.native.prepare(
    `INSERT OR IGNORE INTO local_master_snapshot_artifact(
      snapshot_type, tenant_id, company_id, branch_id, sequence,
      environment, key_id, issued_at, claims_json, claims_checksum, signature, activated_at
    ) VALUES ('CASH_REGISTER',?,?,?,1,'SANDBOX','TEST_KEY',?,?,?,?,?)`,
  ).run(TENANT, COMPANY, BRANCH, at, JSON.stringify({ sequence: 1, payload: [] }), "a".repeat(64), "stub-sig", at);

  database.native.prepare(
    `INSERT OR IGNORE INTO cash_register(
      id, tenant_id, company_id, branch_id, code, code_normalized, name,
      currency_code, status, created_at, retired_at, version, last_seen_sequence
    ) VALUES (?,?,?,?,'CAJA-01','caja-01','Caja 01','COP','ACTIVE',?,NULL,1,1)`,
  ).run(REGISTER, TENANT, COMPANY, BRANCH, at);
}

async function main(): Promise<void> {
  const database = LocalDatabase.open({ dataDirectory: DATA_DIRECTORY });

  new SqliteAuthorizationSnapshotStore(database, () => NOW).activate(
    {
      claims: authorizationClaims(),
      signature: sign(null, unsignedAuthorizationSnapshotBytes(authorizationClaims()), keyPair.privateKey)
        .toString("base64url"),
    },
    { userId: USER, installationId: INSTALLATION, deviceId: DEVICE },
  );
  seedRegister(database);
  seedFiscalRange(database);

  const keys = new Map<string, TrustedSigningKey>([
    [SESSION_KEY_ID, { key: createPublicKey(keyPair.privateKey), status: "ACTIVE" }],
  ]);

  // Credencial fiscal depositada por la misma via que usa el operador en `F2`.
  // El valor es de prueba y no sale de este directorio temporal.
  const fiscalSecretStore = new EncryptedFileSecretStore(
    DATA_DIRECTORY,
    new InsecureDerivedKeyProvider(DATA_DIRECTORY),
    fiscalCredentialContext({ installationId: INSTALLATION, deviceId: DEVICE }),
  );
  new FiscalCredentialStore(fiscalSecretStore).deposit(
    {
      provider: "FACTUS", environment: "SANDBOX",
      fields: { client_id: "e2e", client_secret: "e2e", username: "e2e", password: "e2e" },
    },
    FACTUS_ADAPTER_DECLARATION.credential,
  );

  const commercial = new CommercialComponent(
    config(),
    { database } as never,
    { store: new DurableSyncStore(database) } as never,
    keys,
    () => NOW,
    fiscalSecretStore,
    new FakeIssuancePort(),
  );
  await commercial.start();
  const handler = new CommercialRequestHandler(config(), commercial);

  const endpoint = localChannelEndpoint(INSTALLATION, process.platform, DATA_DIRECTORY);
  const server = new LocalChannelServer(
    endpoint,
    // Reloj del sistema, no `NOW`: el autenticador valida la marca temporal de
    // cada trama contra una ventana de deriva, y el Electron del otro extremo
    // sella con su reloj real. Fijar el reloj aquí haría que toda trama
    // legítima se rechazara por deriva. `NOW` gobierna el tiempo de negocio,
    // que es otra cosa.
    new LocalChannelAuthenticator(SECRET),
    async (request, _signal, context) => {
      const envelope = request as { message_type: string; request_id: string; correlation_id: string };
      if (envelope.message_type === "runtime.handshake") {
        return {
          protocol_version: "1.0.0",
          request_id: envelope.request_id,
          correlation_id: envelope.correlation_id,
          operation_id: null,
          status: "SUCCEEDED",
          result_code: "COMPATIBLE",
          result_schema_version: "1.0.0",
          error: null,
          server_time: NOW.toISOString(),
          result: { status: "COMPATIBLE", negotiated_protocol_version: "1.0.0" },
        };
      }
      // El servidor ya validó el sobre; el handshake quedó atendido arriba.
      return await handler.handle(request as Parameters<typeof handler.handle>[0], context.connectionId);
    },
    { min: "1.0.0", max: "1.0.0" },
    undefined,
    undefined,
    undefined,
    (connectionId) => { commercial.bindings.release(connectionId); },
  );

  await server.start();

  const claims = sessionClaims();
  process.stdout.write(`${JSON.stringify({
    ready: true,
    endpoint,
    sessionAssertion: {
      claims,
      signature: sign(null, unsignedSessionAssertionBytes(claims), keyPair.privateKey).toString("base64url"),
    },
  })}\n`);

  const shutdown = (): void => {
    void (async () => {
      try {
        await server.stop();
        await commercial.stop();
      } finally {
        database.close();
        process.exit(0);
      }
    })();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((error: unknown) => {
  console.error("real service host failed", error);
  process.exit(1);
});
