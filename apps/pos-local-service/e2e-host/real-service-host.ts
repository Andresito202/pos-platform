import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { LocalDatabase } from "@pos-platform/database-sqlite";
import { LocalChannelAuthenticator, localChannelEndpoint } from "@pos-platform/local-channel";
import {
  LocalChannelServer,
  unsignedAuthorizationSnapshotBytes,
  unsignedSessionAssertionBytes,
  type TrustedSigningKey,
} from "../src/index.js";
import { SqliteAuthorizationSnapshotStore } from "../src/authorization/sqlite-authorization-snapshot-store.js";
import { CommercialComponent } from "../src/commercial/commercial-component.js";
import { CommercialRequestHandler } from "../src/commercial/commercial-request-handler.js";
import { LocalDatabaseComponent } from "../src/local-database-component.js";
import { DurableSyncComponent } from "../src/sync/durable-sync-component.js";
import { OperationConfirmationComponent } from "../src/operations/operation-confirmation-component.js";
import { LocalChannelComponent } from "../src/channel/local-channel-component.js";
import { EncryptedFileSecretStore, InsecureDerivedKeyProvider } from "../src/security/index.js";
import { FiscalCredentialStore, fiscalCredentialContext } from "../src/fiscal/fiscal-credential-store.js";
import type { ServiceConfig } from "../src/config.js";
import type { AuthorizationSnapshotClaims, SessionAssertionClaims } from "@pos-platform/contracts";
import { CanonicalPermission,uuidV7 } from "@pos-platform/contracts";
import {SessionTrustKeyVerifier} from "../src/security/session-trust-key-verifier.js";
import {IsolatedHttpsSnapshotProvider} from "../src/authorization/isolated-https-snapshot-provider.js";
import {mkdirSync} from "node:fs";
import {join} from "node:path";
import {WindowsDpapiKeyProvider} from "../src/security/windows-dpapi-key-provider.js";
import {AuthorizationTrustCandidateStore} from "../src/security/authorization-trust-candidate.js";
import {AuthorizationTrustLifecycle} from "../src/security/authorization-trust-lifecycle.js";
import {refreshIsolatedAuthorizationTrust} from "../src/security/isolated-authorization-trust-fetcher.js";
import {TrustedClockGuard} from "../src/security/trusted-clock.js";
import {LocalSecurityComponent,deviceIdentityContext} from "../src/security/local-security-component.js";
import {DeviceTrustCredentialStore} from "../src/security/device-trust-credential-store.js";
import {DeviceEnrollmentService} from "../src/security/device-enrollment-service.js";
import {DeviceTrustVerifier} from "@pos-platform/device-trust";
import {CommercialDeviceCredentialProvider} from "../src/security/commercial-device-credential.js";
import {NativeCommercialCoordinator} from "../src/security/native-commercial-coordinator.js";
import {IsolatedNativeCommercialHttps} from "../src/security/native-commercial-https.js";
import type {NativeClientRegistration} from "@pos-platform/contracts";
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
 * Levanta CommercialComponent y SQLite reales. En Windows reutiliza
 * LocalChannelComponent con DPAPI; en POSIX conecta LocalChannelServer al
 * handler comercial. Identidad, SSA, snapshot, caja y rango son fixtures.
 * El proveedor fiscal es FakeIssuancePort: no se acredita FACTUS ni login.
 *
 * Vive fuera de `src/` a propósito. No forma parte del servicio distribuible:
 * es andamiaje de verificación, y mezclarlo con el runtime sería exactamente el
 * tipo de confusión que este proyecto persigue.
 *
 * TODO EL MATERIAL CRIPTOGRÁFICO ES EXCLUSIVO DE VERIFICACIÓN: las claves de
 * firma viven en memoria; el secreto DPAPI queda sólo en el directorio temporal.
 *
 * Protocolo con el proceso que lo lanza: imprime una línea JSON en `stdout`
 * —`{"ready":true,...}`— con lo que la prueba necesita, y se apaga con SIGTERM.
 */

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`missing ${name}`);
  return value;
}

if(process.env.NODE_ENV!=="test")throw Error("E2E_HOST_REQUIRES_TEST_ENVIRONMENT");
const WITHOUT_SESSION=process.env.POS_E2E_SESSION_MODE==="NONE";
if(WITHOUT_SESSION&&process.platform!=="win32")throw Error("UNAUTHENTICATED_PRODUCTION_ENTRY_TEST_REQUIRES_WINDOWS");
const PERSISTENT_DEV=process.env.POS_E2E_PERSISTENT_DEV==="1";
if(PERSISTENT_DEV&&(
  process.platform!=="win32"||process.env.NODE_ENV!=="test"||
  (process.env.CI&&!process.env.POS_E2E_PERSISTENCE_SMOKE)||process.env.POS_E2E_ROLE===undefined||
  process.env.POS_E2E_SESSION_MODE==="NONE"||
  !process.env.POS_E2E_DATA_DIR?.includes("CamachoPOS")
))throw Error("PERSISTENT_DEV_PROFILE_SCOPE_REJECTED");
const DATA_DIRECTORY = required("POS_E2E_DATA_DIR");
const SECRET = WITHOUT_SESSION?Buffer.alloc(0):Buffer.from(required("POS_E2E_CHANNEL_SECRET"), "hex");
const TENANT = required("POS_E2E_TENANT_ID");
const COMPANY = required("POS_E2E_COMPANY_ID");
const BRANCH = required("POS_E2E_BRANCH_ID");
const INSTALLATION = required("POS_E2E_INSTALLATION_ID");
const DEVICE = required("POS_E2E_DEVICE_ID");
const USER = WITHOUT_SESSION?"":required("POS_E2E_USER_ID");
const REGISTER = WITHOUT_SESSION?"":required("POS_E2E_REGISTER_ID");

const MEMBERSHIP = "018f0000-0000-7000-8000-0000000000b1";
let SSA_SESSION = "018f0000-0000-7000-8000-0000000000b0";
let SESSION_SEQUENCE = 1;
let SNAPSHOT_SEQUENCE = 1;
const SESSION_KEY_ID = "SESSION_KEY_1";
const NOW = process.env.POS_E2E_PERSISTENT_DEV==="1"?new Date():new Date("2026-09-03T12:00:00.000Z");

// Explicit test-only role views. These are NOT Central's role assignments;
// the signer is ephemeral, the database temporary and the host rejects
// NODE_ENV other than test. No production runtime reads POS_E2E_ROLE.
const ROLE_PERMISSIONS = {
  CAJERO: [
    CanonicalPermission.CASH_SHIFT_OPEN, CanonicalPermission.CASH_SHIFT_CLOSE,
    CanonicalPermission.SALES_SALE_CREATE, CanonicalPermission.SALES_RECEIPT_READ,
    CanonicalPermission.PAYMENTS_PAYMENT_REGISTER, CanonicalPermission.PAYMENTS_PAYMENT_READ,
    CanonicalPermission.PAYMENTS_TRANSFER_REPORT,
    CanonicalPermission.CATALOG_PRODUCT_READ, CanonicalPermission.CUSTOMERS_CUSTOMER_READ,
  ],
  SUPERVISOR: [
    CanonicalPermission.CASH_SHIFT_OPEN, CanonicalPermission.CASH_SHIFT_CLOSE,
    CanonicalPermission.SALES_SALE_CREATE, CanonicalPermission.SALES_RECEIPT_READ,
    CanonicalPermission.PAYMENTS_PAYMENT_REGISTER, CanonicalPermission.PAYMENTS_PAYMENT_READ,
    CanonicalPermission.PAYMENTS_TRANSFER_REPORT, CanonicalPermission.PAYMENTS_TRANSFER_CONFIRM,
    CanonicalPermission.CATALOG_PRODUCT_READ, CanonicalPermission.INVENTORY_STOCK_READ,
    CanonicalPermission.CUSTOMERS_CUSTOMER_READ, CanonicalPermission.AUDIT_EVENT_READ,
  ],
  ADMINISTRADOR: Object.values(CanonicalPermission).filter(code => code !== CanonicalPermission.LICENSE_PLAN_MANAGE),
  SUPERADMINISTRADOR: [CanonicalPermission.LICENSE_PLAN_MANAGE],
} as const;
const requestedRole=process.env.POS_E2E_ROLE;
if(requestedRole!==undefined&&!Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS,requestedRole))
  throw Error("E2E_ROLE_UNRECOGNIZED");
const PERMISSIONS:readonly string[]=requestedRole===undefined?Object.values(CanonicalPermission):
  ROLE_PERMISSIONS[requestedRole as keyof typeof ROLE_PERMISSIONS];

const keyPair = WITHOUT_SESSION?null:generateKeyPairSync("ed25519");
const authorizationKeyPair=WITHOUT_SESSION?null:generateKeyPairSync("ed25519");

function config(): ServiceConfig {
  return {
    data_directory: DATA_DIRECTORY,
    service_version: "1.0.0",
    tenant_id: TENANT,
    company_id: COMPANY,
    branch_id: BRANCH,
    device_id: DEVICE,
    installation_id: INSTALLATION,
    protocol_min: "1.0.0",
    protocol_max: "1.0.0",
    // `DEC-021` F5. En produccion lo pone `POS_FISCAL_ENVIRONMENT`; aqui va
    // fijo a SANDBOX porque la credencial que deposita el arnes es de prueba.
    ...(WITHOUT_SESSION?{}:{fiscal_environment:"SANDBOX" as const}),
  };
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
    snapshot_id: PERSISTENT_DEV?uuidV7():"018f0000-0000-7000-8000-0000000000c0",
    user_id: USER,
    installation_id: INSTALLATION,
    device_id: DEVICE,
    sequence: SNAPSHOT_SEQUENCE,
    issued_at: PERSISTENT_DEV?new Date(NOW.getTime()-30_000).toISOString():"2026-09-03T00:00:00.000Z",
    expires_at: PERSISTENT_DEV?new Date(NOW.getTime()+8*3600_000).toISOString():"2026-09-04T00:00:00.000Z",
    assignments: [
      {
        tenant_id: TENANT,
        company_id: COMPANY,
        branch_id: BRANCH,
        status: "ACTIVE",
        valid_from: PERSISTENT_DEV?new Date(NOW.getTime()-60_000).toISOString():"2026-09-01T00:00:00.000Z",
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
    issued_at: PERSISTENT_DEV?new Date(NOW.getTime()-30_000).toISOString():"2026-09-03T00:00:00.000Z",
    offline_valid_until: PERSISTENT_DEV?new Date(NOW.getTime()+8*3600_000).toISOString():"2026-09-04T00:00:00.000Z",
    sequence: SESSION_SEQUENCE,
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
  // Fixture provisioning comes from the parent test directly to Service, never
  // Electron. Production main does not accept this control message.
  const custody=process.env.POS_E2E_NATIVE_CUSTODY==="1"?await new Promise<{
    activation:unknown;result:unknown;rootPublicPem:string;operational:unknown;registration:NativeClientRegistration;port:number;
    binding:{devicePrivatePem:string;ca:string};accessV2?:{audience:string;maximumRetentionMs:number};
  }>(resolve=>process.once("message",packet=>{if(packet&&typeof packet==="object"&&"type" in packet&&packet.type==="pos-e2e-native-provision")resolve(packet as never);else throw Error("NATIVE_TEST_PROVISION_REQUIRED");})):undefined;
  const localDatabase = new LocalDatabaseComponent(DATA_DIRECTORY);
  await localDatabase.start();
  const database = localDatabase.database;
  if(PERSISTENT_DEV){
    // Reissue a new short-lived test credential on every successful password-
    // gated launch. SQLite business data survives; old SSA/SAS do not become
    // permanently trusted. Monotonic sequences prevent replay after restart.
    const prevSession=database.native.prepare(
      "SELECT sequence FROM local_session_assertion WHERE user_id=? AND installation_id=? AND device_id=?"
    ).get(USER,INSTALLATION,DEVICE) as {sequence:number}|undefined;
    const prevAuth=database.native.prepare(
      "SELECT sequence FROM local_authorization_snapshot WHERE user_id=? AND installation_id=? AND device_id=?"
    ).get(USER,INSTALLATION,DEVICE) as {sequence:number}|undefined;
    SESSION_SEQUENCE=(prevSession?.sequence??0)+1;
    SNAPSHOT_SEQUENCE=(prevAuth?.sequence??0)+1;
    SSA_SESSION=uuidV7();
  }

  const durableSync = new DurableSyncComponent(localDatabase);
  await durableSync.start();
  const operations = new OperationConfirmationComponent(localDatabase, durableSync);
  await operations.start();

  let commercial: CommercialComponent;
  let authorizationTrust:AuthorizationTrustLifecycle|undefined;
  let externalSigningKeyCount=0;
  if (WITHOUT_SESSION) {
    // Empty canonical storage; optional Central public trust only. No private
    // signer, seeded SSA/snapshot/user, cash seed or fake provider in this mode.
    const externalKeys=new Map<string,TrustedSigningKey>();
    if(process.env.POS_E2E_SSA_PUBLIC_TRUST){
      const trust=JSON.parse(process.env.POS_E2E_SSA_PUBLIC_TRUST) as {rootPublicPem:string;artifact:unknown};
      const verifier=new SessionTrustKeyVerifier(createPublicKey(trust.rootPublicPem),"isolated-validation");
      const checked=verifier.verify(trust.artifact);
      if(checked.decision!=="VALID"||!checked.claims)throw Error("E2E_EXTERNAL_SSA_TRUST_REJECTED");
      externalKeys.set(checked.claims.key_id,verifier.toTrustedSigningKey(checked.claims));
    }
    externalSigningKeyCount=externalKeys.size;
    let authorizationKeys:ReadonlyMap<string,TrustedSigningKey>=new Map();
    if(process.env.POS_E2E_SAS_TRUST_CANDIDATE){
      if(process.env.POS_E2E_SAS_PUBLIC_TRUST)throw Error("SAS_TRUST_SOURCE_AMBIGUOUS");
      const trust=JSON.parse(process.env.POS_E2E_SAS_TRUST_CANDIDATE) as {issuer:string;authorityId:string;minimumGeneration:number;rootPublicPem:string;url:string;ca:string};
      const directory=join(DATA_DIRECTORY,"sas-trust-candidate");mkdirSync(directory,{recursive:true});
      const encrypted=new EncryptedFileSecretStore(directory,new WindowsDpapiKeyProvider(directory),"dec011-sas-lab-only");
      const store=new AuthorizationTrustCandidateStore(encrypted,{mode:"ISOLATED_VALIDATION",environment:"isolated-validation",
        issuer:trust.issuer,authorityId:trust.authorityId,minimumGeneration:trust.minimumGeneration,root:createPublicKey(trust.rootPublicPem)},
        externalKeys,new TrustedClockGuard(database,0),()=>new Date());
      authorizationTrust=new AuthorizationTrustLifecycle({installationId:INSTALLATION,deviceId:DEVICE},{refreshIntervalMs:60000,
        create:()=>({binding:{installationId:INSTALLATION,deviceId:DEVICE},readKeys:()=>store.resolve(),destroy:()=>encrypted.destroy(),
          refresh:async signal=>{await refreshIsolatedAuthorizationTrust({mode:"ISOLATED_VALIDATION",url:trust.url,ca:trust.ca,timeoutMs:5000,store,signal});}}),
      },()=>{});
      authorizationKeys=authorizationTrust.keys;
    }
    if(process.env.POS_E2E_SAS_PUBLIC_TRUST){
      const trust=JSON.parse(process.env.POS_E2E_SAS_PUBLIC_TRUST) as {mode:string;environment:string;purpose:string;keyId:string;status:string;publicPem:string;validFrom:string;validUntil:string};
      if(trust.mode!=="ISOLATED_VALIDATION"||trust.environment!=="isolated-validation"||trust.purpose!=="AUTHORIZATION_SNAPSHOT"||trust.status!=="ACTIVE"||!/^SAS_TEST_[A-Z0-9_]+$/.test(trust.keyId))throw Error("E2E_SAS_TRUST_REJECTED");
      authorizationKeys=new Map([[trust.keyId,{key:createPublicKey(trust.publicPem),status:"ACTIVE",validFrom:trust.validFrom,validUntil:trust.validUntil}]]);
    }
    commercial = new CommercialComponent(config(), localDatabase, durableSync,externalKeys,undefined,undefined,undefined,authorizationKeys);
  } else {
    if(!keyPair||!authorizationKeyPair)throw Error("SIGNED_E2E_AUTHORITY_MISSING");
    // The signed bytes and persisted claims MUST be identical. A per-boot
    // UUIDv7 snapshot cannot be recomputed between signing and storage.
    const claims=authorizationClaims();
    const result=new SqliteAuthorizationSnapshotStore(database, () => NOW).activate(
      {
        claims,
        signature: sign(null, unsignedAuthorizationSnapshotBytes(claims), authorizationKeyPair.privateKey)
          .toString("base64url"),
      },
      { userId: USER, installationId: INSTALLATION, deviceId: DEVICE },
    );
    if(result.kind!=="ACTIVATED")throw Error("DEV_AUTHORIZATION_SNAPSHOT_REJECTED");
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

    commercial = new CommercialComponent(
      config(),
      localDatabase,
      durableSync,
      keys,
      () => NOW,
      fiscalSecretStore,
      new FakeIssuancePort(),
      new Map([["AUTHZ_KEY_1",{key:authorizationKeyPair.publicKey,status:"ACTIVE" as const}]]),
    );
  }
  await authorizationTrust?.start();
  await commercial.start();
  let nativeCommercial:NativeCommercialCoordinator|undefined,localSecurity:LocalSecurityComponent|undefined,enrollmentSecrets:EncryptedFileSecretStore|undefined,commercialSecrets:EncryptedFileSecretStore|undefined;
  if(custody){
    if(!WITHOUT_SESSION||process.platform!=="win32"||process.env.NODE_ENV!=="test")throw Error("NATIVE_TEST_PROVISION_FORBIDDEN");
    const b={tenantId:TENANT,companyId:COMPANY,installationId:INSTALLATION,deviceId:DEVICE},directory=join(DATA_DIRECTORY,"security");
    mkdirSync(directory,{recursive:true});const provider=new WindowsDpapiKeyProvider(directory);
    const identitySecrets=new EncryptedFileSecretStore(directory,provider,deviceIdentityContext(b));
    const bytes=Buffer.from(custody.binding.devicePrivatePem);custody.binding.devicePrivatePem="";
    try{identitySecrets.write("device-identity",bytes);}finally{bytes.fill(0);identitySecrets.destroy();}
    localSecurity=new LocalSecurityComponent(localDatabase,b,provider,directory);await localSecurity.start();
    enrollmentSecrets=new EncryptedFileSecretStore(directory,provider,`device-trust:${INSTALLATION}:${DEVICE}`);
    const credentials=new DeviceTrustCredentialStore(enrollmentSecrets),keys=new Map();
    const verifier=new DeviceTrustVerifier(createPublicKey(custody.rootPublicPem),keys,{now:()=>new Date(),accept:at=>new TrustedClockGuard(database).accept(at)});
    const operational=verifier.verifyOperationalKey(custody.operational);if(operational.decision!=="VALID"||!operational.value)throw Error("NATIVE_TEST_TRUST_REJECTED");
    keys.set(operational.value.key_id,{key:createPublicKey(operational.value.public_key_pem),status:operational.value.status,validFrom:operational.value.valid_from});
    const enrollment=new DeviceEnrollmentService(database,localSecurity.identity,b,()=>new Date(),credentials);
    if(enrollment.prepare(custody.activation).decision!=="READY")throw Error("NATIVE_TEST_ENROLLMENT_PREPARE_REJECTED");enrollment.complete(custody.result,verifier);
    if(custody.accessV2)commercialSecrets=new EncryptedFileSecretStore(directory,provider,`commercial-v2:${INSTALLATION}:${DEVICE}`);
    nativeCommercial=new NativeCommercialCoordinator(new CommercialDeviceCredentialProvider(localSecurity,localDatabase,credentials,verifier,b),custody.registration,
      new IsolatedNativeCommercialHttps(custody.registration,{mode:"ISOLATED_VALIDATION",port:custody.port,ca:Buffer.from(custody.binding.ca),timeoutMs:4000}),commercial,
      {mode:"ISOLATED_VALIDATION",attemptLifetimeMs:60000,...(custody.accessV2?{accessV2:custody.accessV2}:{})},undefined,
      commercialSecrets&&custody.accessV2?{store:commercialSecrets,maximumRetentionMs:custody.accessV2.maximumRetentionMs}:undefined);
    if(custody.accessV2){
      const coordinator=nativeCommercial,handle=coordinator.handle.bind(coordinator);
      coordinator.handle=async(raw,connectionId,signal)=>{
        const response=await handle(raw,connectionId,signal);
        if(response.result?.outcome==="ACTIVATED"&&!await coordinator.renewAuthorization(connectionId,signal))throw Error("V2_E2E_REAL_RENEWAL_FAILED");
        return response;
      };
    }
  }
  const handler = new CommercialRequestHandler(config(), commercial);

  const endpoint = localChannelEndpoint(INSTALLATION, process.platform, DATA_DIRECTORY);
  const server = process.platform === "win32"
    ? new LocalChannelComponent(config(), localDatabase, () => "READY", operations, commercial,nativeCommercial)
    : new LocalChannelServer(
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
      // POSIX harness metadata only; Windows uses the production component.
      if (envelope.message_type === "runtime.status.get") {
        return {
          protocol_version: "1.0.0", request_id: envelope.request_id,
          correlation_id: envelope.correlation_id, operation_id: null,
          status: "SUCCEEDED", result_code: "OK", result_schema_version: "1.0.0",
          error: null, server_time: NOW.toISOString(),
          result: { service_version: "1.0.0", protocol_version: "1.0.0", service_state: "READY", schema_version: "5" },
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

  const claims = WITHOUT_SESSION?null:sessionClaims();
  process.stdout.write(`${JSON.stringify({
    ready: true,
    endpoint,
    sessionAssertion: keyPair&&claims?{
      claims,
      signature: sign(null, unsignedSessionAssertionBytes(claims), keyPair.privateKey).toString("base64url"),
    }:null,
  })}\n`);

  const shutdown = (): void => {
    void (async () => {
      try {
        await server.stop();
          commercialSecrets?.destroy();enrollmentSecrets?.destroy();await localSecurity?.stop();
        await commercial.stop();
        await authorizationTrust?.stop();
        await operations.stop();
        await durableSync.stop();
      } finally {
        database.close();
        process.exit(0);
      }
    })();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  if (process.connected && process.env.NODE_ENV === "test") {
    process.on("message", (message: unknown) => {
      if(WITHOUT_SESSION&&message&&typeof message==="object"&&"type" in message&&message.type==="pos-e2e-sas-acquire"){
        const packet=message as {type:string;id:string;input:Omit<ConstructorParameters<typeof IsolatedHttpsSnapshotProvider>[0],"ca"> & {ca:string}};
        void commercial.refreshAuthorization(new IsolatedHttpsSnapshotProvider({...packet.input,ca:Buffer.from(packet.input.ca)})).then(
          outcome=>process.send?.({type:"pos-e2e-sas-result",id:packet.id,outcome:{kind:outcome.kind,...(outcome.kind==="ACQUIRED"?{sequence:outcome.sequence}:{})}}),
          ()=>process.send?.({type:"pos-e2e-sas-result",id:packet.id,outcome:{kind:"FAILED"}}));
      }
      if (message === "pos-e2e-shutdown") shutdown();
      if(WITHOUT_SESSION&&message==="pos-e2e-empty-state"){
        const count=(table:string)=>database.native.prepare(`SELECT count(*) AS n FROM ${table}`).get() as {n:number};
        process.send?.({type:"pos-e2e-empty-state",sessions:count("local_session_assertion").n,
          snapshots:count("local_authorization_snapshot").n,sales:count("sales_sales").n,cashShifts:count("cash_shift").n,
          signingKeys:externalSigningKeyCount,authority:externalSigningKeyCount?"EXTERNAL_TEST_PUBLIC_TRUST":"NONE"});
      }
    });
  }
}

main().catch((error: unknown) => {
  console.error("real service host failed", error);
  process.exit(1);
});
