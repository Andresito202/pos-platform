import { PostgresBusinessSessionRevocationTransaction, PostgresPlatformSecurityEventRepository } from "@pos-platform/database-postgres";
import { IsolatedBusinessAuditSessionGuard } from "../src/isolated-business-audit-session-guard.js";
import {verifyCentralRuntimeDatabase} from "../src/central-deployment-configuration.js";
import { IsolatedBusinessNativeCodeIssuer } from "../src/isolated-business-native-code-issuer.js";
import { IsolatedBusinessRefreshRotation } from "../src/isolated-business-refresh-rotation.js";
import { IsolatedBusinessAccessTokenCodec } from "../src/isolated-business-access-token-codec.js";
import { IsolatedBusinessCredentialPairIssuer } from "../src/isolated-business-credential-pair-issuer.js";
import { IsolatedBusinessAuthCoordinator } from "../src/isolated-business-auth-coordinator.js";
import { IsolatedBusinessBrowserLogin } from "../src/isolated-business-browser-login.js";
import { IsolatedBrowserSessionVault } from "../src/isolated-browser-session-vault.js";
import { IsolatedDurableBrowserSessionStore } from "../src/isolated-durable-browser-session-store.js";
import {DurableBrowserSessionStore} from "../src/durable-browser-session-store.js";
import {PostgresBrowserSessionHandoffWriter} from "@pos-platform/database-postgres";
import { IsolatedBusinessBrowserSessionBridge } from "../src/isolated-business-browser-session-bridge.js";
import { CommercialNativeClientCatalog } from "../src/commercial-native-client-catalog.js";
import { IsolatedBusinessBoundCodeConsumer } from "../src/isolated-business-bound-code-consumer.js";
import { NativeAuthorizationCodeExchange } from "../src/native-authorization-code-exchange.js";
import { derivePkceS256Challenge } from "../src/native-authorization-constraints.js";
import { createIsolatedCommercialBindingPrerequisite } from "../src/isolated-commercial-binding-adapter.js";
import { PlatformSecurityEventCode } from "@pos-platform/contracts";
import { createHash, generateKeyPairSync, randomBytes, sign, X509Certificate } from "node:crypto";
import type { Server } from "node:https";
import { exerciseElectronCommercialBrowser } from "./helpers/electron-commercial-browser.js";
import {SessionTrustKeyIssuer} from "../src/session-trust-key-issuer.js";
import {signIsolatedAuthorizationTrust} from "../src/isolated-authorization-trust.js";
import type {SignedAuthorizationTrustCandidate} from "@pos-platform/contracts";
import {canonicalSessionTrustJson} from "@pos-platform/contracts";
import {IsolatedNativeBusinessRequests,type IsolatedNativeRequestPolicy} from "../src/isolated-native-business-requests.js";
import {IsolatedAuthorizationSnapshotIssuer,type IsolatedAuthorizationSigning} from "../src/isolated-authorization-snapshot-issuer.js";
import {verify} from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPostgresPool, type BusinessSessionValidationPolicy } from "@pos-platform/database-postgres";
import { uuidV7 } from "@pos-platform/contracts";
import { createPlatformPasswordVerifier } from "../src/platform-password-verifier.js";
import { BusinessInitialMfaFlow, type BusinessInitialMfaReceipt } from "../src/business-initial-mfa-flow.js";
import { BusinessSessionAuthority } from "../src/business-session-authority.js";
import { BusinessAccessPreparation, type BusinessAccessPreparationReference } from "../src/business-access-preparation.js";
import { PostgresBusinessSessionAccessRepository, BUSINESS_SSA_DEVICE_PROOF_PATH, type TrustedBusinessSessionBinding } from "@pos-platform/database-postgres";
import { createDeviceRequestAuthorization } from "@pos-platform/device-trust";
import {createIsolatedCommercialHttpsServer} from "../src/isolated-commercial-https.js";
import {labTls,postLabHttps,getLabHttps,closeLabHttps} from "./helpers/lab-https.js";
import type {AuthenticationResponseJSON} from "@simplewebauthn/server";

const serverUrl = process.env.POSTGRES_TEST_URL;
const databaseName = `pos_business_session_test_${randomBytes(8).toString("hex")}`;
const password = randomBytes(24).toString("base64url");
const rpId = "business.example.test", origin = `https://${rpId}`;
type DatabasePool = ReturnType<typeof createPostgresPool>;
const policy: BusinessSessionValidationPolicy = Object.freeze({
  mode:"ISOLATED_VALIDATION",version:"fixture-only-v1",sessionLifetimeMs:60_000,
  maximumMfaAgeMs:30_000,maximumReauthenticationAgeMs:30_000,
  accessProof:{mode:"DISABLED_PENDING_D3",policyReference:"test-only-no-access-proof"},
  abuse:{mode:"ISOLATED_TEST_ONLY",policyReference:"test-only-no-production-budget"},
} as const);
const sha = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest();

describe.runIf(Boolean(serverUrl))("BUSINESS access preparation - physical composition", () => {
  let admin: DatabasePool, owner: DatabasePool, runtime: DatabasePool;
  let created = false, verifier: string, rejectionVerifier: string;
  let userId: string, credentialId: string, factorId: string, tenantId: string, membershipId: string;
  let email: string, publicCredentialId: string, materialId: string;
  let keys: ReturnType<typeof generateKeyPairSync>, flow: BusinessInitialMfaFlow, authority: BusinessSessionAuthority;
  let receipt: BusinessInitialMfaReceipt;
  let preparation: BusinessAccessPreparation, reference: BusinessAccessPreparationReference, binding: TrustedBusinessSessionBinding;
  let companyId: string, deviceId: string, installationId: string, deviceCredentialId: string;
  let deviceKeys: ReturnType<typeof generateKeyPairSync>;
  let nativeClientId:string;
  const accessPolicy={mode:"ISOLATED_VALIDATION" as const,maximumContextAgeMs:30_000,maximumReauthenticationAgeMs:30_000};

  beforeAll(async () => {
    const url = new URL(serverUrl!);
    if (!["postgres:","postgresql:"].includes(url.protocol) || !["127.0.0.1","localhost"].includes(url.hostname) || url.port!=="55433") {
      throw new Error("BUSINESS_SESSION_TEST_REQUIRES_LOCALHOST_55433");
    }
    admin = createPostgresPool(serverUrl!,2,"business-session-fixture-admin");
    const roles = await admin.query("SELECT rolname FROM pg_roles WHERE rolname=ANY($1::text[])",[["pos_schema_owner","pos_platform_app"]]);
    if (roles.rows.length!==2) throw new Error("BUSINESS_SESSION_CANONICAL_ROLES_REQUIRED");
    await admin.query(`CREATE DATABASE "${databaseName}"`); created = true;
    await admin.query(`GRANT CREATE ON DATABASE "${databaseName}" TO pos_schema_owner`);
    url.pathname=`/${databaseName}`; url.username="postgres"; url.password="";
    owner = createPostgresPool(url.toString(),3,"business-session-fixture-owner");
    const root = new URL("../../../tools/target-migrations/sql/postgres/",import.meta.url);
    await owner.query(await readFile(new URL("bootstrap.sql",root),"utf8"));
    const ddl = await owner.connect();
    try {
      await ddl.query("SET ROLE pos_schema_owner");
      for (const name of ["001_central_foundation.up.sql","004_device_trust.up.sql","009_webauthn_challenges.up.sql","010_webauthn_credential_material.up.sql","011_session_assertion_sequences.up.sql","012_device_request_proof_replays.up.sql","013_business_browser_sessions.up.sql",
        "proposals/sas_sequences.up.sql","proposals/sas_sources_read_lock.up.sql"]) {
        await ddl.query(await readFile(new URL(name,root),"utf8"));
      }
    } finally { try { await ddl.query("RESET ROLE"); } finally { ddl.release(); } }
    await owner.query(`CREATE TABLE identity.native_authorization_code_validation (
      code_hash text PRIMARY KEY,client_id text NOT NULL,redirect_uri text NOT NULL,
      code_challenge text NOT NULL,state text NOT NULL,trusted_binding_id text NOT NULL,
      session_id uuid NOT NULL,device_id uuid NOT NULL,tenant_id uuid NOT NULL,
      issued_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,
      consumed_at timestamptz)`);
    await owner.query(`CREATE TABLE identity.native_code_audit_fixture (
      session_id uuid NOT NULL,code_hash text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp())`);
    await owner.query("GRANT SELECT, INSERT, UPDATE ON identity.native_authorization_code_validation TO pos_platform_app");
    await owner.query(`CREATE TABLE identity.native_request_validation (
      id uuid PRIMARY KEY,challenge_hash text NOT NULL UNIQUE CHECK(length(challenge_hash)=64),
      client_id text NOT NULL,redirect_uri text NOT NULL,code_challenge text NOT NULL,state text NOT NULL,
      created_at timestamptz NOT NULL,challenge_expires_at timestamptz NOT NULL,challenge_consumed_at timestamptz,
      request_hash text UNIQUE CHECK(length(request_hash)=64),expires_at timestamptz,consumed_at timestamptz,
      credential_id uuid REFERENCES identity.device_credentials(credential_id),device_id uuid REFERENCES identity.device_registry(device_id),
      installation_id uuid,tenant_id uuid REFERENCES tenancy.tenants(id),company_id uuid REFERENCES organization.companies(id),
      session_id uuid REFERENCES identity.sessions(id),
      CHECK((challenge_consumed_at IS NULL AND request_hash IS NULL AND credential_id IS NULL) OR
        (challenge_consumed_at IS NOT NULL AND request_hash IS NOT NULL AND credential_id IS NOT NULL AND expires_at IS NOT NULL)),
      CHECK(consumed_at IS NULL OR session_id IS NOT NULL))`);
    await owner.query("GRANT SELECT,INSERT,UPDATE ON identity.native_request_validation TO pos_platform_app");
    await owner.query(`CREATE TABLE "authorization".snapshot_sequence_validation (
      user_id uuid NOT NULL REFERENCES identity.users(id),installation_id uuid NOT NULL,device_id uuid NOT NULL REFERENCES identity.device_registry(device_id),
      sequence bigint NOT NULL CHECK(sequence BETWEEN 1 AND 9007199254740991),source_checksum text NOT NULL CHECK(length(source_checksum)=64),snapshot_id uuid NOT NULL,
      PRIMARY KEY(user_id,installation_id,device_id))`);
    await owner.query('GRANT SELECT,INSERT,UPDATE ON "authorization".snapshot_sequence_validation TO pos_platform_app');
    // Fixture-only lock privileges for this isolated producer; no production
    // roles or closed migrations are changed by the increment.
    await owner.query('GRANT UPDATE ON "authorization".roles,"authorization".permissions,"authorization".role_permission_grants TO pos_platform_app');
    await owner.query("GRANT SELECT, INSERT ON identity.native_code_audit_fixture TO pos_platform_app");
    await owner.query("GRANT SELECT, INSERT, UPDATE ON identity.session_refresh_tokens TO pos_platform_app");
    await owner.query(`CREATE TABLE identity.browser_session_validation (
      cookie_hash text PRIMARY KEY,csrf_hash text NOT NULL,
      session_id uuid NOT NULL,user_id uuid NOT NULL,tenant_id uuid NOT NULL,
      membership_id uuid NOT NULL,origin text NOT NULL,
      created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,
      revoked_at timestamptz NULL)`);
    await owner.query("GRANT SELECT, INSERT, UPDATE ON identity.browser_session_validation TO pos_platform_app");
    url.username="pos_platform_app";
    runtime=createPostgresPool(url.toString(),5,"business-access-central-runtime");
    verifier=await createPlatformPasswordVerifier(password,"owasp-19m-t2-p1");
    rejectionVerifier=await createPlatformPasswordVerifier(randomBytes(24).toString("hex"),"owasp-19m-t2-p1");
  },60_000);

  async function authenticate(): Promise<BusinessInitialMfaReceipt> {
    const challenge=await flow.begin({email,password,factorId,correlationId:uuidV7()});
    if (!challenge) throw new Error("BUSINESS_SESSION_FIXTURE_CHALLENGE_MISSING");
    const result=await flow.complete({email,password,challenge:challenge.challenge,response:await assertionFor(challenge.challenge)});
    if (!result) throw new Error("BUSINESS_SESSION_FIXTURE_MFA_MISSING");
    return result;
  }
  async function assertionFor(challenge:string):Promise<AuthenticationResponseJSON>{
    const data=Buffer.from(JSON.stringify({type:"webauthn.get",challenge,origin,crossOrigin:false}));
    const auth=Buffer.alloc(37); sha(rpId).copy(auth); auth[32]=0x05;
    const counter=await owner.query("SELECT counter::int AS counter FROM identity.webauthn_credential_material WHERE id=$1",[materialId]);
    auth.writeUInt32BE(counter.rows[0].counter+1,33);
    return {
      id:publicCredentialId,rawId:publicCredentialId,type:"public-key",clientExtensionResults:{},response:{
        clientDataJSON:data.toString("base64url"),authenticatorData:auth.toString("base64url"),
        signature:sign("sha256",Buffer.concat([auth,sha(data)]),keys.privateKey).toString("base64url"),
      },
    };
  }

  beforeEach(async () => {
    nativeClientId="native-"+uuidV7();
    userId=uuidV7();credentialId=uuidV7();factorId=uuidV7();materialId=uuidV7();tenantId=uuidV7();membershipId=uuidV7();
    email=`session-${randomBytes(8).toString("hex")}@example.test`;
    publicCredentialId=randomBytes(32).toString("base64url");
    keys=generateKeyPairSync("ec",{namedCurve:"prime256v1"});
    const jwk=keys.publicKey.export({format:"jwk"});
    const cose=Buffer.concat([Buffer.from("a5010203262001215820","hex"),Buffer.from(jwk.x!,"base64url"),Buffer.from("225820","hex"),Buffer.from(jwk.y!,"base64url")]);
    await owner.query(`INSERT INTO identity.users(id,email,email_normalized,full_name,status,created_at,updated_at)
      VALUES ($1,$2,$2,'Session fixture','ACTIVE',clock_timestamp(),clock_timestamp())`,[userId,email]);
    await owner.query(`INSERT INTO identity.user_credentials(id,user_id,credential_type,verifier,status,created_at)
      VALUES ($1,$2,'PASSWORD',$3,'ACTIVE',clock_timestamp())`,[credentialId,userId,verifier]);
    await owner.query(`INSERT INTO identity.mfa_factors(id,user_id,factor_type,secret_reference,status,enrolled_at,verified_at)
      VALUES ($1,$2,'WEBAUTHN',$3,'ACTIVE',clock_timestamp(),clock_timestamp())`,[factorId,userId,`webauthn:v1:${materialId}`]);
    await owner.query(`INSERT INTO identity.webauthn_credential_material(id,factor_id,credential_id,public_key_cose_base64url)
      VALUES ($1,$2,$3,$4)`,[materialId,factorId,publicCredentialId,cose.toString("base64url")]);
    await owner.query(`INSERT INTO tenancy.tenants(id,name,status,created_at,updated_at)
      VALUES ($1,'Session tenant','ACTIVE',clock_timestamp(),clock_timestamp())`,[tenantId]);
    await owner.query(`INSERT INTO tenancy.tenant_memberships(id,tenant_id,user_id,membership_type,status,created_by_actor_type,created_at,activated_at)
      VALUES ($1,$2,$3,'MEMBER','ACTIVE','SYSTEM',clock_timestamp(),clock_timestamp())`,[membershipId,tenantId,userId]);
    flow=new BusinessInitialMfaFlow(runtime,{rpId,origin,rejectionVerifier,challengeLifetimeMs:60_000});
    authority=new BusinessSessionAuthority(runtime,flow,policy);
    receipt=await authenticate();
    companyId=uuidV7();deviceId=uuidV7();installationId=uuidV7();deviceCredentialId=uuidV7();
    deviceKeys=generateKeyPairSync("ed25519");
    await owner.query("INSERT INTO organization.companies(id,tenant_id,trade_name,timezone,currency_code,status,created_at,updated_at) VALUES ($1,$2,'Access fixture','America/Bogota','COP','ACTIVE',clock_timestamp(),clock_timestamp())",[companyId,tenantId]);
    await owner.query("INSERT INTO identity.device_registry(device_id,installation_id,tenant_id,company_id,device_key_id,device_public_key,device_public_key_algorithm,status,trust_key_id,trust_key_purpose,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,'Ed25519','ACTIVE','fixture-trust','DEVICE_TRUST',clock_timestamp(),clock_timestamp())",[deviceId,installationId,tenantId,companyId,"device-"+deviceId,deviceKeys.publicKey.export({format:"pem",type:"spki"})]);
    await owner.query("INSERT INTO identity.device_credentials(credential_id,device_id,installation_id,tenant_id,company_id,device_key_id,trust_key_id,key_purpose,status,generation,issued_at,expires_at,credential_checksum,issuer_signature,created_at) VALUES ($1,$2,$3,$4,$5,$6,'fixture-trust','DEVICE_TRUST','ACTIVE',1,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '5 minutes',$7,$8,clock_timestamp())",[deviceCredentialId,deviceId,installationId,tenantId,companyId,"device-"+deviceId,randomBytes(32).toString("hex"),randomBytes(64)]);
    preparation=new BusinessAccessPreparation(runtime,authority,accessPolicy);
    reference=(await preparation.open({mfaReceipt:receipt,selection:{tenantId,membershipId}}))!;
    binding=(await preparation.resolveCurrent(reference))!;
    if (!reference || !binding) throw new Error("ACCESS_FIXTURE_CONTEXT_MISSING");
  });

  afterAll(async () => {
    await runtime?.end(); await owner?.end();
    if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
    await admin?.end();
  },30_000);

  function request(sessionId=binding.sessionId,requestId=uuidV7()) {
    const body=JSON.stringify({session_id:sessionId}),correlationId=uuidV7();
    const authorization=createDeviceRequestAuthorization({method:"POST",path:BUSINESS_SSA_DEVICE_PROOF_PATH,
      requestId,correlationId,credentialId:deviceCredentialId,body},deviceKeys.privateKey);
    return {authorization,requestId,correlationId,body};
  }
  it("commercial deployment: runtime preflight validates canonical schema and rejects owner without writes",async()=>{
    await expect(verifyCentralRuntimeDatabase(runtime)).resolves.toBeUndefined();
    await expect(verifyCentralRuntimeDatabase(owner)).rejects.toThrow("CENTRAL_RUNTIME_DATABASE_REJECTED");
  });
  async function openAgain() {
    const next=await preparation.open({mfaReceipt:await authenticate(),selection:{tenantId,membershipId}});
    if (!next) throw new Error("ACCESS_FIXTURE_REOPEN_FAILED");
    const current=await preparation.resolveCurrent(next);
    if (!current) throw new Error("ACCESS_FIXTURE_CURRENT_MISSING");
    return {reference:next,binding:current};
  }
  async function counters() {
    const result=await owner.query(`SELECT
      (SELECT count(*)::int FROM identity.device_request_proof_replays WHERE credential_id=$1) AS nonces,
      COALESCE((SELECT last_issued_sequence::int FROM identity.session_assertion_sequences
        WHERE user_id=$2 AND device_id=$3),0) AS sequence`,[deviceCredentialId,userId,deviceId]);
    return result.rows[0];
  }
  const denied=async()=>{
    expect(await preparation.resolveCurrent(reference)).toBeNull();
    expect(await preparation.prepareSequence(reference,request())).toBeNull();
    expect(await counters()).toEqual({nonces:0,sequence:0});
  };
  it("resolves a current BUSINESS session and composes authentic DeviceProof with durable 011/012",async()=>{
    const role=await runtime.query("SELECT current_user AS role,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user");
    expect(role.rows[0]).toEqual({role:"pos_platform_app",rolsuper:false,rolbypassrls:false});
    expect(await preparation.resolveCurrent(reference)).toMatchObject({userId,tenantId,tenantMembershipId:membershipId});
    const prepared=await preparation.prepareSequence(reference,request());
    expect(prepared?.reservation).toMatchObject({sequence:1,eligibleScope:{sessionId:binding.sessionId,userId,tenantId,companyId,deviceId,installationId}});
    expect(Object.keys(prepared!)).toEqual(["reservation"]); // No claims, token or signing key.
    expect(await counters()).toEqual({nonces:1,sequence:1});
    expect(await preparation.resolveCurrent(reference)).toBeNull();
  });
  it("rejects UUID, serialized or copied reference and MFA flags before any DB side effect",async()=>{
    for (const value of [binding.sessionId,true,JSON.stringify(reference),{...reference},{sessionId:binding.sessionId,mfa:true}]) {
      expect(await preparation.resolveCurrent(value)).toBeNull();
      expect(await preparation.prepareSequence(value,request())).toBeNull();
    }
    expect(await counters()).toEqual({nonces:0,sequence:0});
  });
  it("rejects inactive users",async()=>{
    await owner.query("UPDATE identity.users SET status='INACTIVE' WHERE id=$1",[userId]); await denied();
  });
  it("rejects suspended membership",async()=>{
    await owner.query("UPDATE tenancy.tenant_memberships SET status='SUSPENDED',suspended_at=clock_timestamp() WHERE id=$1",[membershipId]); await denied();
  });
  it("rejects suspended tenant",async()=>{
    await owner.query("UPDATE tenancy.tenants SET status='SUSPENDED' WHERE id=$1",[tenantId]); await denied();
  });
  it("rejects revoked sessions",async()=>{
    await owner.query("UPDATE identity.sessions SET revoked_at=clock_timestamp(),revoked_by_actor_type='SYSTEM',revocation_reason='FIXTURE' WHERE id=$1",[binding.sessionId]); await denied();
  });
  it("rejects GLOBAL scope instead of granting BUSINESS access from a session UUID",async()=>{
    const globalId=uuidV7();
    await owner.query(`INSERT INTO identity.sessions(id,user_id,authenticated_at,expires_at,last_reauthenticated_at,mfa_status,created_at)
      VALUES ($1,$2,$3::timestamptz,$4::timestamptz,$3::timestamptz,'SATISFIED',clock_timestamp())`,
    [globalId,userId,binding.authenticatedAt,binding.expiresAt]);
    const repository=new PostgresBusinessSessionAccessRepository(runtime,accessPolicy);
    expect(await repository.findCurrent({...binding,sessionId:globalId})).toBeNull();
    expect(await preparation.prepareSequence(globalId,request(globalId))).toBeNull();
    expect(await counters()).toEqual({nonces:0,sequence:0});
  });
  it("rejects expired sessions using database time",async()=>{
    await owner.query("UPDATE identity.sessions SET expires_at=authenticated_at+interval '1 millisecond' WHERE id=$1",[binding.sessionId]);
    await owner.query("SELECT pg_sleep(0.02)"); await denied();
  });
  it("rejects stale reauthentication",async()=>{
    await owner.query("UPDATE identity.sessions SET last_reauthenticated_at=clock_timestamp()-interval '1 hour' WHERE id=$1",[binding.sessionId]); await denied();
  });
  it("rejects future authentication or reauthentication timestamps",async()=>{
    await owner.query("UPDATE identity.sessions SET last_reauthenticated_at=clock_timestamp()+interval '5 seconds' WHERE id=$1",[binding.sessionId]); await denied();
  });
  it("rejects revoked MFA",async()=>{
    await owner.query("UPDATE identity.mfa_factors SET status='REVOKED',revoked_at=clock_timestamp() WHERE id=$1",[factorId]); await denied();
  });
  it("rejects a locked password credential",async()=>{
    await owner.query("UPDATE identity.user_credentials SET locked_until=clock_timestamp()+interval '1 minute' WHERE id=$1",[credentialId]); await denied();
  });
  it("cross-checks expected user, tenant, membership and authentication instance against persisted scope",async()=>{
    const repository=new PostgresBusinessSessionAccessRepository(runtime,accessPolicy);
    for (const field of ["userId","tenantId","tenantMembershipId"]) {
      expect(await repository.findCurrent({...binding,[field]:uuidV7()})).toBeNull();
    }
    expect(await repository.findCurrent({...binding,authenticatedAt:new Date(Date.parse(binding.authenticatedAt)-1).toISOString()})).toBeNull();
    expect(await repository.findCurrent({...binding,expiresAt:new Date(Date.parse(binding.authenticatedAt)-1).toISOString()})).toBeNull();
    expect(await repository.findCurrent(binding)).not.toBeNull();
  });
  it("rejects expired internal context with explicit policy and no default TTL",async()=>{
    const repository=new PostgresBusinessSessionAccessRepository(runtime,{...accessPolicy,maximumContextAgeMs:1});
    await owner.query("SELECT pg_sleep(0.02)"); expect(await repository.findCurrent(binding)).toBeNull();
    expect(()=>new PostgresBusinessSessionAccessRepository(runtime,undefined as never)).toThrow("BUSINESS_ACCESS_TIME_POLICIES_REQUIRED");
    expect(()=>new BusinessAccessPreparation(runtime,authority,{...accessPolicy,mode:"PRODUCTION"})).toThrow("BUSINESS_ACCESS_PRODUCTION_BLOCKED_PENDING_D3");
  });
  it("rejects a mismatched persistent pool before consuming MFA or producing any access reference",async()=>{
    const pending=await authenticate();
    const wrongPool=new BusinessAccessPreparation(admin,authority,accessPolicy);
    await expect(wrongPool.open({mfaReceipt:pending,selection:{tenantId,membershipId}})).rejects.toThrow("BUSINESS_ACCESS_ISOLATED_DATABASE_REQUIRED");
    expect(flow.takeForBusinessSession(pending)).not.toBeNull();
    expect(await counters()).toEqual({nonces:0,sequence:0});
  });
  it("rejects a signed selector for a different session",async()=>{
    expect(await preparation.prepareSequence(reference,request(uuidV7()))).toBeNull();
    expect(await counters()).toEqual({nonces:0,sequence:0});
  });
  it("rejects a body changed after signing, even when parsed session_id still matches",async()=>{
    const input=request(); input.body+=" ";
    expect(await preparation.prepareSequence(reference,input)).toBeNull();
    expect(await counters()).toEqual({nonces:0,sequence:0});
  });
  it("rejects a revoked device credential",async()=>{
    await owner.query("UPDATE identity.device_credentials SET status='REVOKED',revoked_at=clock_timestamp(),revoked_reason='FIXTURE' WHERE credential_id=$1",[deviceCredentialId]);
    expect(await preparation.prepareSequence(reference,request())).toBeNull(); expect(await counters()).toEqual({nonces:0,sequence:0});
  });
  it("rejects an authentic device in another tenant, without reserving sequence",async()=>{
    const other=uuidV7();
    await owner.query("UPDATE identity.device_registry SET tenant_id=$2 WHERE device_id=$1",[deviceId,other]);
    await owner.query("UPDATE identity.device_credentials SET tenant_id=$2 WHERE credential_id=$1",[deviceCredentialId,other]);
    expect(await preparation.prepareSequence(reference,request())).toBeNull(); expect(await counters()).toEqual({nonces:1,sequence:0});
  });
  it("burns the preparation reference and rejects its replay",async()=>{
    const input=request(); expect(await preparation.prepareSequence(reference,input)).not.toBeNull();
    expect(await preparation.prepareSequence(reference,input)).toBeNull(); expect(await counters()).toEqual({nonces:1,sequence:1});
  });
  it("rejects durable device request-id replay across freshly authenticated BUSINESS sessions",async()=>{
    const input=request(); expect(await preparation.prepareSequence(reference,input)).not.toBeNull();
    const next=await openAgain();
    expect(await preparation.prepareSequence(next.reference,request(next.binding.sessionId,input.requestId))).toBeNull();
    expect(await counters()).toEqual({nonces:1,sequence:1});
  });
  it("admits exactly one concurrent preparation for the same reference",async()=>{
    const input=request(); const result=await Promise.all([preparation.prepareSequence(reference,input),preparation.prepareSequence(reference,input)]);
    expect(result.filter(Boolean)).toHaveLength(1); expect(await counters()).toEqual({nonces:1,sequence:1});
  });
  it("reserves increasing sequences concurrently across two genuine sessions of the same user/device",async()=>{
    const next=await openAgain();
    const results=await Promise.all([preparation.prepareSequence(reference,request()),preparation.prepareSequence(next.reference,request(next.binding.sessionId))]);
    expect(results.map(value=>value?.reservation.sequence).sort()).toEqual([1,2]);
    expect(await counters()).toEqual({nonces:2,sequence:2});
  });
  it("rolls back a failed nonce insertion and never reserves sequence",async()=>{
    await owner.query("REVOKE INSERT ON identity.device_request_proof_replays FROM pos_platform_app");
    try { await expect(preparation.prepareSequence(reference,request())).rejects.toMatchObject({code:"42501"}); }
    finally { await owner.query("GRANT INSERT ON identity.device_request_proof_replays TO pos_platform_app"); }
    expect(await counters()).toEqual({nonces:0,sequence:0}); expect(await preparation.resolveCurrent(reference)).toBeNull();
  });
  it("rolls back a failed read validation and clears the transaction-local tenant context",async()=>{
    const repository=new PostgresBusinessSessionAccessRepository(runtime,accessPolicy);
    await owner.query("REVOKE SELECT ON tenancy.tenant_memberships FROM pos_platform_app");
    try { await expect(repository.findCurrent(binding)).rejects.toMatchObject({code:"42501"}); }
    finally { await owner.query("GRANT SELECT ON tenancy.tenant_memberships TO pos_platform_app"); }
    expect(await repository.findCurrent(binding)).not.toBeNull();
    const clients=await Promise.all(Array.from({length:5},()=>runtime.connect()));
    try {
      for (const client of clients) {
        const scope=await client.query("SELECT current_setting('app.tenant_id',true) AS tenant");
        expect([null,""]).toContain(scope.rows[0].tenant);
      }
    } finally { clients.forEach(client=>client.release()); }
    expect(await counters()).toEqual({nonces:0,sequence:0});
  });
  it("keeps a consumed nonce burned if sequence persistence fails, without fabricating a reservation",async()=>{
    await owner.query("REVOKE INSERT ON identity.session_assertion_sequences FROM pos_platform_app");
    try { await expect(preparation.prepareSequence(reference,request())).rejects.toMatchObject({code:"42501"}); }
    finally { await owner.query("GRANT INSERT ON identity.session_assertion_sequences TO pos_platform_app"); }
    expect(await counters()).toEqual({nonces:1,sequence:0}); expect(await preparation.resolveCurrent(reference)).toBeNull();
  });
  it("revalidates session revocation after DeviceProof consumption",async()=>{
    await owner.query(`CREATE FUNCTION identity.access_test_revoke_session() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      UPDATE identity.sessions SET revoked_at=clock_timestamp(),revoked_by_actor_type='SYSTEM',revocation_reason='FIXTURE'
      WHERE id='${binding.sessionId}'; RETURN NEW; END $$;
      CREATE TRIGGER access_test_revoke_session AFTER INSERT ON identity.device_request_proof_replays
      FOR EACH ROW EXECUTE FUNCTION identity.access_test_revoke_session()`);
    try { expect(await preparation.prepareSequence(reference,request())).toBeNull(); }
    finally { await owner.query("DROP TRIGGER access_test_revoke_session ON identity.device_request_proof_replays; DROP FUNCTION identity.access_test_revoke_session()"); }
    expect(await counters()).toEqual({nonces:1,sequence:0});
  });

  // CAMACHO_LOGOUT_PHYSICAL_REGRESSION_V1
  it("logs out the bound BUSINESS session and atomically records exactly one security event", async () => {
    const result = await preparation.close(reference, uuidV7());
    expect(result).toBe("REVOKED");
    const state = await owner.query(`SELECT revoked_at,revocation_reason FROM identity.sessions WHERE id=$1`,[binding.sessionId]);
    expect(state.rows[0]?.revoked_at).not.toBeNull();
    expect(state.rows[0]?.revocation_reason).toBe("USER_LOGOUT");
    const events = await owner.query(`SELECT count(*)::int AS count FROM identity.security_events WHERE session_id=$1 AND event_code=$2`,[binding.sessionId,PlatformSecurityEventCode.SESSION_REVOKED]);
    expect(events.rows[0].count).toBe(1);
    expect(await preparation.resolveCurrent(reference)).toBeNull();
    expect(await preparation.close(reference,uuidV7())).toBeNull();
  });

  it("serializes concurrent durable revocations and audits the transition once", async () => {
    const revoke = new PostgresBusinessSessionRevocationTransaction(runtime);
    const results = await Promise.all([revoke.revokeOwn(binding,uuidV7()),revoke.revokeOwn(binding,uuidV7())]);
    expect(results.sort()).toEqual(["ALREADY_REVOKED","REVOKED"]);
    const rows = await owner.query(`SELECT count(*)::int AS count FROM identity.security_events WHERE session_id=$1 AND event_code=$2`,[binding.sessionId,PlatformSecurityEventCode.SESSION_REVOKED]);
    expect(rows.rows[0].count).toBe(1);
  });

  it("refuses a mismatched authenticated tenant and does not revoke the actual session", async () => {
    const revoke = new PostgresBusinessSessionRevocationTransaction(runtime);
    expect(await revoke.revokeOwn({...binding,tenantId:uuidV7()},uuidV7())).toBeNull();
    const rows = await owner.query(`SELECT revoked_at FROM identity.sessions WHERE id=$1`,[binding.sessionId]);
    expect(rows.rows[0]?.revoked_at).toBeNull();
  });

  it("rolls back durable logout when security event insertion fails", async () => {
    const revoke = new PostgresBusinessSessionRevocationTransaction(runtime);
    await owner.query("REVOKE INSERT ON identity.security_events FROM pos_platform_app");
    try {
      await expect(revoke.revokeOwn(binding,uuidV7())).rejects.toMatchObject({code:"42501"});
    } finally {
      await owner.query("GRANT INSERT ON identity.security_events TO pos_platform_app");
    }
    const session = await owner.query(`SELECT revoked_at FROM identity.sessions WHERE id=$1`,[binding.sessionId]);
    expect(session.rows[0]?.revoked_at).toBeNull();
    const events = await owner.query(`SELECT count(*)::int AS count FROM identity.security_events WHERE session_id=$1 AND event_code=$2`,[binding.sessionId,PlatformSecurityEventCode.SESSION_REVOKED]);
    expect(events.rows[0].count).toBe(0);
  });

  it("rejects copied or serialized preparation references for logout", async () => {
    expect(await preparation.close({...reference},uuidV7())).toBeNull();
    expect(await preparation.close(JSON.stringify(reference),uuidV7())).toBeNull();
    expect(await preparation.resolveCurrent(reference)).not.toBeNull();
  });
  // Physical integration of current session, real Ed25519 DeviceProof and
  // transactionally persisted fixture-only audit. Not an access token or SSA.
  function physicalBindingAudit() {
    return createIsolatedCommercialBindingPrerequisite(preparation, runtime, {
      authorityReference:"IDENTITY_SECURITY_EVENTS_PHYSICAL_FIXTURE",
      record:async checked => {
        await owner.query(`INSERT INTO identity.security_events
          (id,user_id,session_id,tenant_id,device_id,event_code,result,reason_code,
           correlation_id,occurred_at,server_recorded_at)
          VALUES ($1,$2,$3,$4,NULL,'COMMERCIAL_BINDING_VALIDATED','ACCEPTED',
                  'ISOLATED_FIXTURE',$5,clock_timestamp(),clock_timestamp())`,
          [uuidV7(),checked.identity.userId,checked.identity.sessionId,checked.identity.tenantId,uuidV7()]);
      },
    });
  }
  it("physically verifies current BUSINESS session, Ed25519 proof and durable fixture audit",async()=>{
    const result=await physicalBindingAudit().establish(reference,request());
    expect(result).toMatchObject({identity:{sessionId:binding.sessionId,userId,tenantId},
      device:{deviceId,installationId,tenantId,companyId,credentialId:deviceCredentialId}});
    const rows=await owner.query(`SELECT count(*)::int AS n FROM identity.security_events
      WHERE session_id=$1 AND event_code='COMMERCIAL_BINDING_VALIDATED'`,[binding.sessionId]);
    expect(rows.rows[0].n).toBe(1);
    expect((await counters()).nonces).toBe(1);
    expect((await counters()).sequence).toBe(0);
  });
  it("physically rejects replay of the original signed DeviceProof without another audit",async()=>{
    const proof=request();
    expect(await physicalBindingAudit().establish(reference,proof)).not.toBeNull();
    expect(await physicalBindingAudit().establish(reference,proof)).toBeNull();
    const rows=await owner.query(`SELECT count(*)::int AS n FROM identity.security_events
      WHERE session_id=$1 AND event_code='COMMERCIAL_BINDING_VALIDATED'`,[binding.sessionId]);
    expect(rows.rows[0].n).toBe(1);
  });
  it("physically rejects a revoked BUSINESS session before consuming proof",async()=>{
    await owner.query(`UPDATE identity.sessions SET revoked_at=clock_timestamp(),
      revoked_by_actor_type='SYSTEM',revocation_reason='FIXTURE' WHERE id=$1`,[binding.sessionId]);
    expect(await physicalBindingAudit().establish(reference,request())).toBeNull();
    expect((await counters()).nonces).toBe(0);
  });
  it("does not return a binding when durable audit INSERT fails after consuming proof",async()=>{
    const failing=createIsolatedCommercialBindingPrerequisite(preparation,runtime,{
      authorityReference:"IDENTITY_SECURITY_EVENTS_PHYSICAL_FIXTURE",
      record:async()=>{throw new Error("FIXTURE_AUDIT_FAILED");},
    });
    await expect(failing.establish(reference,request())).rejects.toThrow("FIXTURE_AUDIT_FAILED");
    expect((await counters()).nonces).toBe(1);
    const rows=await owner.query(`SELECT count(*)::int AS n FROM identity.security_events
      WHERE session_id=$1 AND event_code='COMMERCIAL_BINDING_VALIDATED'`,[binding.sessionId]);
    expect(rows.rows[0].n).toBe(0);
  });

  // Canonical audit integration: an actual session revocation is committed
  // together with its existing SESSION_REVOKED event by the existing repository.
  // No synthetic commercial authorization event or token is introduced.
  async function revokeAndAuditInsideLock() {
    const guard = new IsolatedBusinessAuditSessionGuard(runtime);
    const repository = new PostgresPlatformSecurityEventRepository(runtime);
    return guard.whileActive(binding, async client => {
      const changed = await client.query(`UPDATE identity.sessions
        SET revoked_at=clock_timestamp(),revoked_by_actor_type='SYSTEM',
            revocation_reason='FIXTURE_CANONICAL_AUDIT'
        WHERE id=$1 AND revoked_at IS NULL RETURNING id`,[binding.sessionId]);
      if (changed.rows.length !== 1) throw new Error("SESSION_REVOCATION_NOT_COMMITTED");
      return repository.append({
        user_id:binding.userId,session_id:binding.sessionId,tenant_id:binding.tenantId,
        event_code:PlatformSecurityEventCode.SESSION_REVOKED,result:"REVOKED",
        reason_code:"FIXTURE_CANONICAL_AUDIT",correlation_id:uuidV7(),
        occurred_at:new Date(Date.now()-1_000).toISOString(),
      },client);
    });
  }
  it("atomically persists canonical SESSION_REVOKED audit with the session transition",async()=>{
    const event = await revokeAndAuditInsideLock();
    expect(event).toMatchObject({session_id:binding.sessionId,tenant_id:tenantId,
      event_code:PlatformSecurityEventCode.SESSION_REVOKED,result:"REVOKED"});
    const state=await owner.query(`SELECT revoked_at FROM identity.sessions WHERE id=$1`,[binding.sessionId]);
    expect(state.rows[0].revoked_at).not.toBeNull();
    const events=await owner.query(`SELECT count(*)::int AS n FROM identity.security_events
      WHERE session_id=$1 AND event_code=$2 AND reason_code='FIXTURE_CANONICAL_AUDIT'`,
      [binding.sessionId,PlatformSecurityEventCode.SESSION_REVOKED]);
    expect(events.rows[0].n).toBe(1);
  });
  it("rolls back a canonical revocation if audit INSERT lacks permission",async()=>{
    await owner.query("REVOKE INSERT ON identity.security_events FROM pos_platform_app");
    try {
      await expect(revokeAndAuditInsideLock()).rejects.toMatchObject({code:"42501"});
    } finally {
      await owner.query("GRANT INSERT ON identity.security_events TO pos_platform_app");
    }
    const state=await owner.query(`SELECT revoked_at FROM identity.sessions WHERE id=$1`,[binding.sessionId]);
    expect(state.rows[0].revoked_at).toBeNull();
    const events=await owner.query(`SELECT count(*)::int AS n FROM identity.security_events
      WHERE session_id=$1 AND reason_code='FIXTURE_CANONICAL_AUDIT'`,[binding.sessionId]);
    expect(events.rows[0].n).toBe(0);
  });
  it("serializes concurrent guarded revocations and writes only one canonical event",async()=>{
    const results=await Promise.all([revokeAndAuditInsideLock(),revokeAndAuditInsideLock()]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const events=await owner.query(`SELECT count(*)::int AS n FROM identity.security_events
      WHERE session_id=$1 AND event_code=$2 AND reason_code='FIXTURE_CANONICAL_AUDIT'`,
      [binding.sessionId,PlatformSecurityEventCode.SESSION_REVOKED]);
    expect(events.rows[0].n).toBe(1);
  });

  // Isolated end-to-end issuance with a verified DeviceProof and a locked
  // durable BUSINESS session. Audit here is explicitly a disposable fixture,
  // not a production security event vocabulary.
  async function issueNativeCode(failAudit=false) {
    const proven=await createIsolatedCommercialBindingPrerequisite(preparation,runtime,{
      authorityReference:"PHYSICAL_DEVICE_PROOF_AUDIT_FIXTURE",
      record:async()=>undefined,
    }).establish(reference,request());
    if(!proven) throw new Error("DEVICE_PROOF_FIXTURE_REJECTED");
    return new IsolatedBusinessNativeCodeIssuer(runtime).issue({
      binding:proven,clientId:"desktop",
      redirectUri:"http://127.0.0.1:42133/callback",
      codeChallenge:"x".repeat(43),state:"s".repeat(43),
      recordAudit:async transaction=>{
        if(failAudit) throw new Error("ISSUER_AUDIT_FAILED");
        await transaction.query(`INSERT INTO identity.native_code_audit_fixture
          (session_id,code_hash)
          SELECT session_id,code_hash FROM identity.native_authorization_code_validation
          WHERE session_id=$1 ORDER BY issued_at DESC LIMIT 1`,[binding.sessionId]);
      },
    });
  }
  it("issues a one-use fixture code from verified BUSINESS session and Ed25519 device with committed audit",async()=>{
    const code=await issueNativeCode();
    expect(code).toMatch(/^[A-Za-z0-9_-]{64}$/);
    const hash=createHash("sha256").update(code!).digest("hex");
    const rows=await owner.query(`SELECT c.session_id,c.device_id,c.tenant_id,
      (c.expires_at-c.issued_at) AS lifetime,a.code_hash AS audited
      FROM identity.native_authorization_code_validation c
      JOIN identity.native_code_audit_fixture a ON a.code_hash=c.code_hash
      WHERE c.code_hash=$1`,[hash]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({session_id:binding.sessionId,device_id:deviceId,tenant_id:tenantId,audited:hash});
  });
  it("rolls back both code insertion and fixture audit if the required writer fails",async()=>{
    await expect(issueNativeCode(true)).rejects.toThrow("ISSUER_AUDIT_FAILED");
    const rows=await owner.query(`SELECT count(*)::int AS n FROM identity.native_authorization_code_validation
      WHERE session_id=$1`,[binding.sessionId]);
    expect(rows.rows[0].n).toBe(0);
  });
  it("denies isolated code issuance after the authenticated session is revoked",async()=>{
    const proven=await createIsolatedCommercialBindingPrerequisite(preparation,runtime,{
      authorityReference:"PHYSICAL_DEVICE_PROOF_AUDIT_FIXTURE",record:async()=>undefined,
    }).establish(reference,request());
    expect(proven).not.toBeNull();
    await owner.query(`UPDATE identity.sessions SET revoked_at=clock_timestamp(),
      revoked_by_actor_type='SYSTEM',revocation_reason='FIXTURE'
      WHERE id=$1`,[binding.sessionId]);
    const result=await new IsolatedBusinessNativeCodeIssuer(runtime).issue({
      binding:proven!,clientId:"desktop",
      redirectUri:"http://127.0.0.1:42133/callback",
      codeChallenge:"x".repeat(43),state:"s".repeat(43),
      recordAudit:async()=>{throw new Error("AUDIT_SHOULD_NOT_RUN");},
    });
    expect(result).toBeNull();
  });

  const exchangeVerifier = "V".repeat(43);
  const exchangeState = "s".repeat(43);
  const exchangeRedirect = "http://127.0.0.1:42133/callback";
  async function issueExchangeReadyCode() {
    const proven = await createIsolatedCommercialBindingPrerequisite(preparation,runtime,{
      authorityReference:"PHYSICAL_DEVICE_PROOF_AUDIT_FIXTURE",record:async()=>undefined,
    }).establish(reference,request());
    if(!proven) throw new Error("VERIFIED_FIXTURE_REQUIRED");
    return new IsolatedBusinessNativeCodeIssuer(runtime).issue({
      binding:proven,clientId:"desktop",redirectUri:exchangeRedirect,
      codeChallenge:derivePkceS256Challenge(exchangeVerifier),state:exchangeState,
      recordAudit:async transaction=>{
        await transaction.query(`INSERT INTO identity.native_code_audit_fixture (session_id,code_hash)
          SELECT session_id,code_hash FROM identity.native_authorization_code_validation
          WHERE session_id=$1 ORDER BY issued_at DESC LIMIT 1`,[binding.sessionId]);
      },
    });
  }
  function linkedExchange() {
    return new NativeAuthorizationCodeExchange({
      clientId:"desktop",redirectUri:exchangeRedirect,
      authorizationOrigin:"https://business.example.test",
    },new IsolatedBusinessBoundCodeConsumer(runtime));
  }
  it("commits canonical issuance audit on the same transaction as a BUSINESS-bound code",async()=>{
    const proven=await createIsolatedCommercialBindingPrerequisite(preparation,runtime,{
      authorityReference:"PHYSICAL_DEVICE_PROOF_AUDIT_FIXTURE",record:async()=>undefined,
    }).establish(reference,request());
    expect(proven).not.toBeNull();
    const eventRepository=new PostgresPlatformSecurityEventRepository(runtime);
    const issued=await new IsolatedBusinessNativeCodeIssuer(runtime).issue({
      binding:proven!,clientId:"desktop",redirectUri:exchangeRedirect,
      codeChallenge:derivePkceS256Challenge(exchangeVerifier),state:exchangeState,
      recordAudit:async transaction=>{
        await eventRepository.append({
          user_id:binding.userId,session_id:binding.sessionId,tenant_id:binding.tenantId,
          event_code:PlatformSecurityEventCode.AUTHORIZATION_CODE_ISSUED,result:"SUCCEEDED",
          reason_code:"ISOLATED_NATIVE_CODE",correlation_id:uuidV7(),
          occurred_at:new Date(Date.now()-1000).toISOString(),
        },transaction);
      },
    });
    expect(issued).toMatch(/^[A-Za-z0-9_-]{64}$/);
    const events=await owner.query(`SELECT count(*)::int AS n FROM identity.security_events
      WHERE session_id=$1 AND event_code=$2 AND reason_code='ISOLATED_NATIVE_CODE'`,
      [binding.sessionId,PlatformSecurityEventCode.AUTHORIZATION_CODE_ISSUED]);
    expect(events.rows[0].n).toBe(1);
  });
  it("rolls back native code issuance if canonical security audit cannot be inserted",async()=>{
    const proven=await createIsolatedCommercialBindingPrerequisite(preparation,runtime,{
      authorityReference:"PHYSICAL_DEVICE_PROOF_AUDIT_FIXTURE",record:async()=>undefined,
    }).establish(reference,request());
    expect(proven).not.toBeNull();
    const audit=new PostgresPlatformSecurityEventRepository(runtime);
    await owner.query("REVOKE INSERT ON identity.security_events FROM pos_platform_app");
    try {
      await expect(new IsolatedBusinessNativeCodeIssuer(runtime).issue({
        binding:proven!,clientId:"desktop",redirectUri:exchangeRedirect,
        codeChallenge:derivePkceS256Challenge(exchangeVerifier),state:exchangeState,
        recordAudit:async transaction=>{
          await audit.append({user_id:binding.userId,session_id:binding.sessionId,
            tenant_id:binding.tenantId,event_code:PlatformSecurityEventCode.AUTHORIZATION_CODE_ISSUED,
            result:"SUCCEEDED",reason_code:"ISOLATED_NATIVE_CODE",correlation_id:uuidV7(),
            occurred_at:new Date(Date.now()-1000).toISOString()},transaction);
        },
      })).rejects.toMatchObject({code:"42501"});
    } finally {await owner.query("GRANT INSERT ON identity.security_events TO pos_platform_app");}
    const rows=await owner.query(`SELECT count(*)::int AS n FROM identity.native_authorization_code_validation
      WHERE session_id=$1`,[binding.sessionId]);
    expect(rows.rows[0].n).toBe(0);
  });
  it("exchanges a BUSINESS-bound PKCE code exactly once with concurrent consumers",async()=>{
    const code=await issueExchangeReadyCode();
    expect(code).not.toBeNull();
    const results=await Promise.all(Array.from({length:8},()=>
      linkedExchange().exchange({code:code!,verifier:exchangeVerifier,state:exchangeState})));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter(Boolean)[0]).toMatchObject({
      sessionId:binding.sessionId,deviceId,tenantId,credentialId:deviceCredentialId,
    });
  });
  it("persists canonical redemption audit for one successful PKCE exchange",async()=>{
    const code=await issueExchangeReadyCode();
    expect(await linkedExchange().exchange({code:code!,verifier:exchangeVerifier,state:exchangeState})).not.toBeNull();
    const rows=await owner.query(`SELECT count(*)::int AS n FROM identity.security_events
      WHERE session_id=$1 AND event_code=$2`,
      [binding.sessionId,PlatformSecurityEventCode.AUTHORIZATION_CODE_REDEEMED]);
    expect(rows.rows[0].n).toBe(1);
  });
  it("persists canonical rejection audit when a valid code has incorrect PKCE",async()=>{
    const code=await issueExchangeReadyCode();
    expect(await linkedExchange().exchange({code:code!,verifier:"Q".repeat(43),state:exchangeState})).toBeNull();
    const rows=await owner.query(`SELECT count(*)::int AS n FROM identity.security_events
      WHERE session_id=$1 AND event_code=$2`,
      [binding.sessionId,PlatformSecurityEventCode.AUTHORIZATION_CODE_REJECTED]);
    expect(rows.rows[0].n).toBe(1);
  });
  it("rolls back code consumption if canonical redemption audit fails",async()=>{
    const code=await issueExchangeReadyCode();
    await owner.query("REVOKE INSERT ON identity.security_events FROM pos_platform_app");
    try {
      await expect(linkedExchange().exchange({code:code!,verifier:exchangeVerifier,state:exchangeState}))
        .rejects.toMatchObject({code:"42501"});
    } finally { await owner.query("GRANT INSERT ON identity.security_events TO pos_platform_app"); }
    const digest=createHash("sha256").update(code!).digest("hex");
    const rows=await owner.query(`SELECT consumed_at FROM identity.native_authorization_code_validation
      WHERE code_hash=$1`,[digest]);
    expect(rows.rows[0].consumed_at).toBeNull();
  });
  it("burns the code after invalid PKCE without leaking a device binding",async()=>{
    const code=await issueExchangeReadyCode();
    expect(await linkedExchange().exchange({code:code!,verifier:"Q".repeat(43),state:exchangeState})).toBeNull();
    expect(await linkedExchange().exchange({code:code!,verifier:exchangeVerifier,state:exchangeState})).toBeNull();
  });
  it("rejects a code exchanged after the original BUSINESS session is revoked",async()=>{
    const code=await issueExchangeReadyCode();
    await owner.query(`UPDATE identity.sessions SET revoked_at=clock_timestamp(),
      revoked_by_actor_type='SYSTEM',revocation_reason='FIXTURE' WHERE id=$1`,[binding.sessionId]);
    expect(await linkedExchange().exchange({code:code!,verifier:exchangeVerifier,state:exchangeState})).toBeNull();
  });
  it("rejects a code if the bound device credential is revoked before exchange",async()=>{
    const code=await issueExchangeReadyCode();
    await owner.query(`UPDATE identity.device_credentials
      SET status='REVOKED',revoked_at=clock_timestamp(),revoked_reason='FIXTURE'
      WHERE credential_id=$1`,[deviceCredentialId]);
    expect(await linkedExchange().exchange({code:code!,verifier:exchangeVerifier,state:exchangeState})).toBeNull();
  });

  it("rotates isolated refresh atomically, then detects replay and revokes the family",async()=>{
    const rotation=new IsolatedBusinessRefreshRotation(runtime);
    const initial=await rotation.issue(binding,uuidV7());
    expect(initial).toMatch(/^[A-Za-z0-9_-]{64}$/);
    const first=await rotation.rotate(binding,initial!,uuidV7());
    expect(first?.status).toBe("ROTATED");
    const replay=await rotation.rotate(binding,initial!,uuidV7());
    expect(replay).toEqual({status:"REUSE_DETECTED"});
    const replacement=first?.status==="ROTATED" ? first.refreshToken : "";
    expect(await rotation.rotate(binding,replacement,uuidV7())).toBeNull();
    const rows=await owner.query(`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE revoked_at IS NOT NULL)::int AS revoked
      FROM identity.session_refresh_tokens WHERE session_id=$1`,[binding.sessionId]);
    expect(rows.rows[0]).toEqual({total:2,revoked:2});
    const events=await owner.query(`SELECT event_code FROM identity.security_events
      WHERE session_id=$1 AND event_code=ANY($2::text[])`,[binding.sessionId,[
      PlatformSecurityEventCode.REFRESH_ROTATED,PlatformSecurityEventCode.REFRESH_REUSE_DETECTED]]);
    expect(events.rows.map((row:{event_code:string})=>row.event_code).sort()).toEqual([
      PlatformSecurityEventCode.REFRESH_REUSE_DETECTED,
      PlatformSecurityEventCode.REFRESH_ROTATED,
    ].sort());
  });
  it("serializes concurrent refresh requests and returns at most one replacement",async()=>{
    const rotation=new IsolatedBusinessRefreshRotation(runtime);
    const token=await rotation.issue(binding,uuidV7());
    expect(token).not.toBeNull();
    const results=await Promise.all(Array.from({length:4},()=>rotation.rotate(binding,token!,uuidV7())));
    expect(results.filter(value=>value?.status==="ROTATED")).toHaveLength(1);
    expect(results.some(value=>value?.status==="REUSE_DETECTED")).toBe(true);
    const rows=await owner.query(`SELECT count(*)::int AS n FROM identity.session_refresh_tokens
      WHERE session_id=$1 AND parent_token_id IS NOT NULL`,[binding.sessionId]);
    expect(rows.rows[0].n).toBe(1);
  });
  it("rolls back refresh consumption and replacement on canonical audit write failure",async()=>{
    const rotation=new IsolatedBusinessRefreshRotation(runtime);
    const token=await rotation.issue(binding,uuidV7());
    await owner.query("REVOKE INSERT ON identity.security_events FROM pos_platform_app");
    try {
      await expect(rotation.rotate(binding,token!,uuidV7())).rejects.toMatchObject({code:"42501"});
    } finally {
      await owner.query("GRANT INSERT ON identity.security_events TO pos_platform_app");
    }
    const rows=await owner.query(`SELECT consumed_at FROM identity.session_refresh_tokens
      WHERE session_id=$1`,[binding.sessionId]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].consumed_at).toBeNull();
  });
  it("rejects refresh renewal after BUSINESS session revocation",async()=>{
    const rotation=new IsolatedBusinessRefreshRotation(runtime);
    const token=await rotation.issue(binding,uuidV7());
    await owner.query(`UPDATE identity.sessions SET revoked_at=clock_timestamp(),
      revoked_by_actor_type='SYSTEM',revocation_reason='FIXTURE' WHERE id=$1`,[binding.sessionId]);
    expect(await rotation.rotate(binding,token!,uuidV7())).toBeNull();
  });

  function isolatedAccessCodec() {
    const keys=generateKeyPairSync("ed25519");
    return new IsolatedBusinessAccessTokenCodec(runtime,{
      privatePem:keys.privateKey.export({format:"pem",type:"pkcs8"}).toString(),
      publicPem:keys.publicKey.export({format:"pem",type:"spki"}).toString(),
    },{issuer:"https://business.example.test",audience:"camacho-pos-isolated",
      keyId:"ACCESS_SIGNING_TEST_fixture"});
  }
  async function signedAccessForSequence(){
    const codec=isolatedAccessCodec();
    const access=await codec.issue(binding,{deviceId,credentialId:deviceCredentialId},uuidV7());
    if(!access)throw Error("SEQUENCE_ACCESS_FIXTURE_REQUIRED");
    return {codec,access};
  }
  function ssaMaterial(validUntil?:string){
    const root=generateKeyPairSync("ed25519"),operational=generateKeyPairSync("ed25519");
    return {mode:"ISOLATED_VALIDATION" as const,environment:"isolated-validation" as const,
      operationalPrivateKey:operational.privateKey,rootTrustAnchor:root.publicKey,
      signedOperationalKey:new SessionTrustKeyIssuer(root.privateKey).issue({key_id:"ssa-integration",key_purpose:"SESSION_ASSERTION",
        environment:"isolated-validation",status:"ACTIVE",version:1,
        public_key_pem:operational.publicKey.export({format:"pem",type:"spki"}).toString(),
        valid_from:new Date(Date.now()-60_000).toISOString(),valid_until:validUntil??new Date(Date.now()+120_000).toISOString()}),
      policy:{maximumClaimAgeMs:10_000,maximumOfflineLifetimeMs:30_000,maximumReauthenticationAgeMs:30_000}};
  }
  function ssaCoordinator(){return new IsolatedBusinessAuthCoordinator(preparation,runtime,{
    authorityReference:"UNUSED_SSA_BINDING_AUDIT",record:async()=>{throw Error("NO_NEW_CODE_BINDING_IN_SSA_TEST");}});}
  async function sasFixture(assign=true){
    const branchId=uuidV7(),roleId=uuidV7(),assignmentId=uuidV7(),grantId=uuidV7();
    await owner.query("INSERT INTO organization.branches(id,tenant_id,company_id,name,timezone,status,created_at,updated_at) VALUES($1,$2,$3,'SAS fixture branch','America/Bogota','ACTIVE',clock_timestamp(),clock_timestamp())",[branchId,tenantId,companyId]);
    await owner.query(`INSERT INTO "authorization".roles(id,code,name,scope_type,version,status,created_at) VALUES($1,$2,'Isolated SAS audit reader','BUSINESS',1,'ACTIVE',clock_timestamp())`,[roleId,"SAS_FIXTURE_"+roleId]);
    const permission=await owner.query(`INSERT INTO "authorization".permissions(id,code,module,description,status,created_at)
      VALUES($1,'AUDIT_EVENT_READ','AUDIT','Authorized isolated fixture','ACTIVE',clock_timestamp())
      ON CONFLICT(code) DO UPDATE SET status='ACTIVE',retired_at=NULL RETURNING id`,[uuidV7()]);
    const permissionId=permission.rows[0].id as string;
    await owner.query(`INSERT INTO "authorization".role_permission_grants(id,role_id,permission_id,grant_version,status,valid_from,created_at) VALUES($1,$2,$3,1,'ACTIVE',clock_timestamp()-interval '1 minute',clock_timestamp())`,[grantId,roleId,permissionId]);
    if(assign)await owner.query(`INSERT INTO "authorization".user_role_assignments(id,tenant_id,tenant_membership_id,role_id,company_id,branch_id,status,valid_from,created_at,created_by_actor_type)
      VALUES($1,$2,$3,$4,$5,$6,'ACTIVE',clock_timestamp()-interval '1 minute',clock_timestamp(),'SYSTEM')`,[assignmentId,tenantId,membershipId,roleId,companyId,branchId]);
    const key=generateKeyPairSync("ed25519");
    const material:IsolatedAuthorizationSigning={mode:"ISOLATED_VALIDATION",environment:"isolated-validation",purpose:"AUTHORIZATION_SNAPSHOT",keyId:"SAS_TEST_AUDIT",status:"ACTIVE",
      privateKey:key.privateKey,publicKey:key.publicKey,validFrom:new Date(Date.now()-60_000).toISOString(),validUntil:new Date(Date.now()+120_000).toISOString()};
    const deployment={tenantId,companyId,branchId,installationId,deviceId};
    const sasPolicy={mode:"ISOLATED_VALIDATION" as const,lifetimeMs:30_000,maximumReauthenticationAgeMs:30_000};
    return {branchId,roleId,permissionId,assignmentId,grantId,material,deployment,sasPolicy};
  }
  function sasProof(sessionId=binding.sessionId){
    const payload={session_id:sessionId},p=nativeSigned("/v1/business-session/authorization",payload);
    return {body:p.raw,authorization:p.headers.authorization,requestId:p.headers["x-request-id"],correlationId:p.headers["x-correlation-id"]};
  }
  function sasIssuer(codec:IsolatedBusinessAccessTokenCodec,s:Awaited<ReturnType<typeof sasFixture>>){
    return new IsolatedAuthorizationSnapshotIssuer(runtime,codec,s.deployment,s.sasPolicy,s.material);
  }
  async function withSasSqlRehearsal(work:(s:Awaited<ReturnType<typeof sasFixture>>,issuer:IsolatedAuthorizationSnapshotIssuer,access:string,codec:IsolatedBusinessAccessTokenCodec)=>Promise<void>){
    const s=await sasFixture(),{codec,access}=await signedAccessForSequence();
    // Remove the OLD laboratory FOR SHARE privileges for this experiment.
    // Restore that pre-existing fixture only; never a production role/database.
    await owner.query('REVOKE UPDATE ON "authorization".roles,"authorization".permissions,"authorization".role_permission_grants FROM pos_platform_app');
    try{await work(s,new IsolatedAuthorizationSnapshotIssuer(runtime,codec,s.deployment,s.sasPolicy,s.material,
      {mode:"DEC011_SQL_REHEARSAL",lockTimeoutMs:5000}),access,codec);}
    finally{await owner.query('GRANT UPDATE ON "authorization".roles,"authorization".permissions,"authorization".role_permission_grants TO pos_platform_app');}
  }
  async function waitForSourceLock(mode:string,relation='"authorization".role_permission_grants'){
    for(let i=0;i<200;i++){
      const waiting=await owner.query(`SELECT 1 FROM pg_locks WHERE relation=$2::regclass AND mode=$1 AND NOT granted`,[mode,relation]);
      if(waiting.rowCount)return;await new Promise(resolve=>setTimeout(resolve,10));
    }
    throw Error("SAS_EXPECTED_LOCK_NOT_OBSERVED");
  }
  async function recordSasLockMeasurement(name:"cross-tenant"|"timeout",measurement:Record<string,unknown>){
    const directory=new URL("../../../artifacts/windows-p0/sql-lock-measurement/",import.meta.url);
    await mkdir(directory,{recursive:true});
    await writeFile(new URL(`${name}.json`,directory),JSON.stringify({observedAt:new Date().toISOString(),...measurement},null,2)+"\n");
  }
  it("SAS SQL rehearsal: canonical counter and least-privilege source reader issue the real signed projection",async()=>withSasSqlRehearsal(async(s,issuer,access)=>{
    for(const table of ["roles","permissions","role_permission_grants"])
      expect((await runtime.query("SELECT has_any_column_privilege(current_user,$1,'UPDATE') AS allowed",[`"authorization".${table}`])).rows[0].allowed).toBe(false);
    const issued=await issuer.issue(access,sasProof());
    expect(issued?.claims.assignments[0]?.permissions).toEqual([{code:"AUDIT_EVENT_READ",status:"ACTIVE"}]);
    expect(verify(null,Buffer.from(canonicalSessionTrustJson(issued!.claims)),s.material.publicKey,Buffer.from(issued!.signature,"base64url"))).toBe(true);
    expect((await runtime.query('SELECT last_issued_sequence::int AS n FROM "authorization".snapshot_sequences WHERE user_id=$1',[userId])).rows).toEqual([{n:1}]);
    expect((await runtime.query('SELECT count(*)::int AS n FROM "authorization".snapshot_sequence_validation WHERE user_id=$1',[userId])).rows[0].n).toBe(0);
  }));
  it("SAS SQL rehearsal: replay is denied and concurrent fresh proofs reserve exact distinct sequences",async()=>withSasSqlRehearsal(async(_s,issuer,access)=>{
    const proof=sasProof();expect((await issuer.issue(access,proof))?.claims.sequence).toBe(1);
    expect(await issuer.issue(access,proof)).toBeNull();
    const next=await Promise.all([issuer.issue(access,sasProof()),issuer.issue(access,sasProof())]);
    expect(next.map(x=>x?.claims.sequence).sort()).toEqual([2,3]);
  }));
  it("SAS SQL rehearsal: audit failure rolls back proposed counter and fresh retry starts at one",async()=>withSasSqlRehearsal(async(_s,issuer,access)=>{
    await owner.query("REVOKE INSERT ON identity.security_events FROM pos_platform_app");
    const proof=sasProof();
    try{await expect(issuer.issue(access,proof)).rejects.toMatchObject({code:"42501"});}
    finally{await owner.query("GRANT INSERT ON identity.security_events TO pos_platform_app");}
    expect((await runtime.query('SELECT count(*)::int AS n FROM "authorization".snapshot_sequences WHERE user_id=$1',[userId])).rows[0].n).toBe(0);
    expect(await issuer.issue(access,proof)).toBeNull();expect((await issuer.issue(access,sasProof()))?.claims.sequence).toBe(1);
  }));
  it("SAS SQL rehearsal: source lock does not bypass caller RLS or grant a different company",async()=>withSasSqlRehearsal(async(s,_issuer,access,codec)=>{
    const wrong=new IsolatedAuthorizationSnapshotIssuer(runtime,codec,{...s.deployment,companyId:uuidV7()},s.sasPolicy,s.material,{mode:"DEC011_SQL_REHEARSAL",lockTimeoutMs:5000});
    expect(await wrong.issue(access,sasProof())).toBeNull();
    const c=await runtime.connect();try{
      await c.query("BEGIN");await c.query("SELECT set_config('app.tenant_id',$1,true)",[uuidV7()]);
      await c.query('SELECT "authorization".lock_sas_sources_for_read()');
      expect((await c.query('SELECT count(*)::int AS n FROM "authorization".user_role_assignments WHERE id=$1',[s.assignmentId])).rows[0].n).toBe(0);
    }finally{await c.query("ROLLBACK");c.release();}
    expect((await runtime.query("SELECT has_function_privilege('pos_app','authorization.lock_sas_sources_for_read()','EXECUTE') AS allowed")).rows[0].allowed).toBe(false);
  }));
  it("SAS SQL rehearsal: revocation committed by an earlier writer is observed before projection",async()=>withSasSqlRehearsal(async(s,issuer,access)=>{
    const writer=await owner.connect();let issuing:ReturnType<typeof issuer.issue>|undefined;
    try{
      await writer.query("BEGIN");await writer.query('UPDATE "authorization".role_permission_grants SET status=\'RETIRED\',retired_at=clock_timestamp() WHERE id=$1',[s.grantId]);
      issuing=issuer.issue(access,sasProof());await waitForSourceLock("ShareLock");
      await writer.query("COMMIT");expect((await issuing)?.claims.assignments[0]?.permissions[0]?.status).toBe("RETIRED");
    }finally{await writer.query("ROLLBACK");writer.release();await issuing?.catch(()=>undefined);}
  }));
  it("SAS SQL rehearsal: reader transaction blocks INSERT phantoms from ordinary writers until commit",async()=>withSasSqlRehearsal(async(s)=>{
    const reader=await runtime.connect();let writing:Promise<unknown>|undefined;
    try{
      await reader.query("BEGIN");await reader.query("SELECT set_config('app.tenant_id',$1,true)",[tenantId]);
      await reader.query('SELECT "authorization".lock_sas_sources_for_read()');
      writing=owner.query(`INSERT INTO "authorization".role_permission_grants SELECT $1,role_id,permission_id,2,status,valid_from,valid_until,created_at,retired_at FROM "authorization".role_permission_grants WHERE id=$2`,[uuidV7(),s.grantId]);
      await waitForSourceLock("RowExclusiveLock");await reader.query("COMMIT");await writing;
    }finally{await reader.query("ROLLBACK");reader.release();await writing?.catch(()=>undefined);}
  }));
  it("SAS lock measurement: global reader blocks another tenant writer while allowing ordinary reads",async()=>withSasSqlRehearsal(async(s)=>{
    const otherTenant=uuidV7(),otherMembership=uuidV7(),otherCompany=uuidV7(),otherAssignment=uuidV7();
    await owner.query(`INSERT INTO tenancy.tenants(id,name,status,created_at,updated_at) VALUES($1,'Contention fixture','ACTIVE',clock_timestamp(),clock_timestamp())`,[otherTenant]);
    await owner.query(`INSERT INTO tenancy.tenant_memberships(id,tenant_id,user_id,membership_type,status,created_by_actor_type,created_at,activated_at) VALUES($1,$2,$3,'MEMBER','ACTIVE','SYSTEM',clock_timestamp(),clock_timestamp())`,[otherMembership,otherTenant,userId]);
    await owner.query(`INSERT INTO organization.companies(id,tenant_id,trade_name,timezone,currency_code,status,created_at,updated_at) VALUES($1,$2,'Contention fixture','America/Bogota','COP','ACTIVE',clock_timestamp(),clock_timestamp())`,[otherCompany,otherTenant]);
    await owner.query(`INSERT INTO "authorization".user_role_assignments(id,tenant_id,tenant_membership_id,role_id,company_id,status,valid_from,created_at,created_by_actor_type) VALUES($1,$2,$3,$4,$5,'ACTIVE',clock_timestamp(),clock_timestamp(),'SYSTEM')`,[otherAssignment,otherTenant,otherMembership,s.roleId,otherCompany]);
    const reader=await runtime.connect();let writing:Promise<unknown>|undefined;
    try{
      await reader.query("BEGIN");await reader.query("SELECT set_config('app.tenant_id',$1,true)",[tenantId]);
      await reader.query('SELECT "authorization".lock_sas_sources_for_read()');
      let finished=false;const start=performance.now();
      writing=owner.query(`UPDATE "authorization".user_role_assignments SET status='REVOKED',revoked_at=clock_timestamp() WHERE id=$1`,[otherAssignment]).then(result=>{finished=true;return result;});
      await waitForSourceLock("RowExclusiveLock",'"authorization".user_role_assignments');
      const readStart=performance.now();
      expect((await owner.query('SELECT status FROM "authorization".user_role_assignments WHERE id=$1',[otherAssignment])).rows[0].status).toBe("ACTIVE");
      const readMs=performance.now()-readStart;
      await new Promise(resolve=>setTimeout(resolve,200));expect(finished).toBe(false);
      await reader.query("COMMIT");await writing;
      const writerWaitMs=performance.now()-start;expect(writerWaitMs).toBeGreaterThanOrEqual(200);
      expect((await owner.query('SELECT status FROM "authorization".user_role_assignments WHERE id=$1',[otherAssignment])).rows[0].status).toBe("REVOKED");
      await recordSasLockMeasurement("cross-tenant",{scope:"temporary-postgres-cross-tenant",controlledHoldMs:200,writerWaitMs,readMs});
    }finally{await reader.query("ROLLBACK");reader.release();await writing?.catch(()=>undefined);}
  }));
  it("SAS lock measurement: bounded timeout rolls back issuance and burns proof before a fresh retry",async()=>withSasSqlRehearsal(async(s,_issuer,access,codec)=>{
    const issuer=new IsolatedAuthorizationSnapshotIssuer(runtime,codec,s.deployment,s.sasPolicy,s.material,{mode:"DEC011_SQL_REHEARSAL",lockTimeoutMs:100});
    const writer=await owner.connect(),proof=sasProof();
    const events=async()=>Number((await owner.query("SELECT count(*) AS n FROM identity.security_events WHERE event_code=$1",[PlatformSecurityEventCode.AUTHORIZATION_SNAPSHOT_ISSUED])).rows[0].n);
    const before=await events();
    try{
      await writer.query("BEGIN");await writer.query('UPDATE "authorization".role_permission_grants SET valid_until=valid_until WHERE id=$1',[s.grantId]);
      const start=performance.now();await expect(issuer.issue(access,proof)).rejects.toMatchObject({code:"55P03"});
      const elapsedMs=performance.now()-start;
      expect((await runtime.query('SELECT count(*)::int AS n FROM "authorization".snapshot_sequences WHERE user_id=$1',[userId])).rows[0].n).toBe(0);
      expect(await events()).toBe(before);
      await writer.query("ROLLBACK");expect(await issuer.issue(access,proof)).toBeNull();
      expect((await issuer.issue(access,sasProof()))?.claims.sequence).toBe(1);
      expect(await events()).toBe(before+1);
      await recordSasLockMeasurement("timeout",{scope:"temporary-postgres-timeout",configuredTimeoutMs:100,elapsedMs,rollback:true,replayDenied:true,freshRetrySequence:1});
    }finally{await writer.query("ROLLBACK");writer.release();}
  }));
  it("central SAS: projects canonical scoped grants and signs separate from SSA",async()=>{
    const s=await sasFixture(),{codec,access}=await signedAccessForSequence(),issued=await sasIssuer(codec,s).issue(access,sasProof());
    expect(issued?.claims).toMatchObject({user_id:userId,device_id:deviceId,installation_id:installationId,sequence:1,
      assignments:[{tenant_id:tenantId,company_id:companyId,branch_id:s.branchId,status:"ACTIVE",role_status:"ACTIVE",permissions:[{code:"AUDIT_EVENT_READ",status:"ACTIVE"}]}]});
    expect(verify(null,Buffer.from(canonicalSessionTrustJson(issued!.claims)),s.material.publicKey,Buffer.from(issued!.signature,"base64url"))).toBe(true);
    expect(issued?.claims).not.toHaveProperty("session_id");
  });
  it.each(["assignment","role","permission","grant"])("central SAS: propagates revoked or retired %s without implicit grants",async target=>{
    const s=await sasFixture(),{codec,access}=await signedAccessForSequence();
    if(target==="assignment")await owner.query(`UPDATE "authorization".user_role_assignments SET status='REVOKED',revoked_at=clock_timestamp() WHERE id=$1`,[s.assignmentId]);
    if(target==="role")await owner.query(`UPDATE "authorization".roles SET status='RETIRED',retired_at=clock_timestamp() WHERE id=$1`,[s.roleId]);
    if(target==="permission")await owner.query(`UPDATE "authorization".permissions SET status='RETIRED',retired_at=clock_timestamp() WHERE id=$1`,[s.permissionId]);
    if(target==="grant")await owner.query(`UPDATE "authorization".role_permission_grants SET status='RETIRED',retired_at=clock_timestamp() WHERE id=$1`,[s.grantId]);
    const issued=await sasIssuer(codec,s).issue(access,sasProof());
    if(target==="assignment")expect(issued?.claims.assignments[0]?.status).toBe("REVOKED");
    if(target==="role")expect(issued?.claims.assignments[0]?.role_status).toBe("RETIRED");
    if(["permission","grant"].includes(target))expect(issued?.claims.assignments[0]?.permissions[0]?.status).toBe("RETIRED");
  });
  it("central SAS: a user without assigned role receives an empty projection",async()=>{
    const s=await sasFixture(false),{codec,access}=await signedAccessForSequence();
    expect((await sasIssuer(codec,s).issue(access,sasProof()))?.claims.assignments).toEqual([]);
  });
  it.each(["company","branch"])("central SAS: assignments for another %s do not authorize this deployment",async target=>{
    const s=await sasFixture(),{codec,access}=await signedAccessForSequence();
    if(target==="company")s.deployment.companyId=uuidV7();
    else{const other=uuidV7();await owner.query("INSERT INTO organization.branches(id,tenant_id,company_id,name,timezone,status,created_at,updated_at) VALUES($1,$2,$3,'Other','America/Bogota','ACTIVE',clock_timestamp(),clock_timestamp())",[other,tenantId,companyId]);s.deployment.branchId=other;}
    const issued=await sasIssuer(codec,s).issue(access,sasProof());
    if(target==="company")expect(issued).toBeNull();else expect(issued?.claims.assignments).toEqual([]);
  });
  it.each(["purpose","status","key","expiry"])("central SAS: rejects invalid signing %s",async target=>{
    const s=await sasFixture(),{codec}=await signedAccessForSequence();
    if(target==="purpose")s.material.purpose="SESSION_ASSERTION" as never;
    if(target==="status")s.material.status="REVOKED" as never;
    if(target==="key")s.material.publicKey=generateKeyPairSync("ed25519").publicKey;
    if(target==="expiry")s.material.validUntil=new Date(Date.now()-1).toISOString();
    expect(()=>sasIssuer(codec,s)).toThrow();
  });
  it("central SAS: expired grants are denied and future transitions cap snapshot lifetime",async()=>{
    const s=await sasFixture(),{codec,access}=await signedAccessForSequence();
    await owner.query(`UPDATE "authorization".role_permission_grants SET valid_until=clock_timestamp()-interval '1 second' WHERE id=$1`,[s.grantId]);
    expect((await sasIssuer(codec,s).issue(access,sasProof()))?.claims.assignments[0]?.permissions[0]?.status).toBe("RETIRED");
    await owner.query(`UPDATE "authorization".role_permission_grants SET valid_until=NULL,valid_from=clock_timestamp()+interval '5 seconds' WHERE id=$1`,[s.grantId]);
    const issued=await sasIssuer(codec,s).issue(access,sasProof());
    expect(issued?.claims.assignments[0]?.permissions[0]?.status).toBe("RETIRED");
    expect(Date.parse(issued!.claims.expires_at)-Date.parse(issued!.claims.issued_at)).toBeLessThanOrEqual(5000);
  });
  it.each(["session","credential"])("central SAS: revoked %s cannot obtain a projection",async target=>{
    const s=await sasFixture(),{codec,access}=await signedAccessForSequence();
    if(target==="session")await owner.query("UPDATE identity.sessions SET revoked_at=clock_timestamp(),revoked_by_actor_type='SYSTEM',revocation_reason='FIXTURE' WHERE id=$1",[binding.sessionId]);
    else await owner.query("UPDATE identity.device_credentials SET status='REVOKED',revoked_at=clock_timestamp() WHERE credential_id=$1",[deviceCredentialId]);
    expect(await sasIssuer(codec,s).issue(access,sasProof())).toBeNull();
  });
  it("central SAS: UUID identity and assertion-path proof cannot substitute for authenticated possession",async()=>{
    const s=await sasFixture(),{codec,access}=await signedAccessForSequence(),issuer=sasIssuer(codec,s);
    expect(await issuer.issue(binding.sessionId,sasProof())).toBeNull();
    expect(await issuer.issue(access,request())).toBeNull();
  });
  it("central SAS: replay is rejected and concurrent fresh proofs reserve distinct durable sequences",async()=>{
    const s=await sasFixture(),{codec,access}=await signedAccessForSequence(),issuer=sasIssuer(codec,s),proof=sasProof();
    const replay=await Promise.all([issuer.issue(access,proof),issuer.issue(access,proof)]);expect(replay.filter(Boolean)).toHaveLength(1);
    const fresh=await Promise.all([issuer.issue(access,sasProof()),issuer.issue(access,sasProof())]);
    expect(fresh.map(x=>x?.claims.sequence).sort()).toEqual([2,3]);
    expect((await sasIssuer(codec,s).issue(access,sasProof()))?.claims.sequence).toBe(4);
  });
  it("central SAS: two different roles at one scope require an explicit composition decision",async()=>{
    const s=await sasFixture(),{codec,access}=await signedAccessForSequence(),issuer=sasIssuer(codec,s);
    const second=uuidV7();await owner.query(`INSERT INTO "authorization".roles(id,code,name,scope_type,version,status,created_at) VALUES($1,$2,'Second fixture role','BUSINESS',1,'ACTIVE',clock_timestamp())`,[second,"SAS_SECOND_"+second]);
    await owner.query(`INSERT INTO "authorization".user_role_assignments SELECT $1,tenant_id,tenant_membership_id,$3,company_id,branch_id,status,valid_from,valid_until,created_at,created_by_actor_type,created_by_actor_id,revoked_at,version
      FROM "authorization".user_role_assignments WHERE id=$2`,[uuidV7(),s.assignmentId,second]);
    await expect(issuer.issue(access,sasProof())).rejects.toThrow("SAS_ROLE_COMPOSITION_DECISION_REQUIRED");
  });
  it("central SAS: overlapping grant versions are never resolved by silently selecting the highest",async()=>{
    const s=await sasFixture(),{codec,access}=await signedAccessForSequence();
    await owner.query(`INSERT INTO "authorization".role_permission_grants SELECT $1,role_id,permission_id,2,status,valid_from,valid_until,created_at,retired_at FROM "authorization".role_permission_grants WHERE id=$2`,[uuidV7(),s.grantId]);
    await expect(sasIssuer(codec,s).issue(access,sasProof())).rejects.toThrow("SAS_GRANT_VERSION_DECISION_REQUIRED");
  });
  it("central SAS: a permission change in the publication transaction rolls audit and sequence back",async()=>{
    const s=await sasFixture(),{codec,access}=await signedAccessForSequence();
    await owner.query(`CREATE FUNCTION "authorization".sas_test_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      UPDATE "authorization".role_permission_grants SET status='RETIRED',retired_at=clock_timestamp() WHERE id='${s.grantId}'; RETURN NEW; END $$;
      CREATE TRIGGER sas_change AFTER INSERT ON "authorization".snapshot_sequence_validation FOR EACH ROW EXECUTE FUNCTION "authorization".sas_test_change()`);
    try{await expect(sasIssuer(codec,s).issue(access,sasProof())).rejects.toThrow("SAS_SOURCE_CHANGED_BEFORE_COMMIT");}
    finally{await owner.query('DROP TRIGGER sas_change ON "authorization".snapshot_sequence_validation; DROP FUNCTION "authorization".sas_test_change()');}
    const count=await owner.query('SELECT count(*)::int AS n FROM "authorization".snapshot_sequence_validation WHERE user_id=$1',[userId]);expect(count.rows[0].n).toBe(0);
  });
  it("central SAS: audit failure rolls sequence back while the device proof stays consumed",async()=>{
    const s=await sasFixture(),{codec,access}=await signedAccessForSequence(),issuer=sasIssuer(codec,s),proof=sasProof();
    await owner.query("REVOKE INSERT ON identity.security_events FROM pos_platform_app");
    try{await expect(issuer.issue(access,proof)).rejects.toMatchObject({code:"42501"});}finally{await owner.query("GRANT INSERT ON identity.security_events TO pos_platform_app");}
    expect(await issuer.issue(access,proof)).toBeNull();
    expect((await issuer.issue(access,sasProof()))?.claims.sequence).toBe(1);
  });
  it("business SSA composition: emits canonical identity from real verified access proof and durable reservation",async()=>{
    const {codec,access}=await signedAccessForSequence(),material=ssaMaterial();
    const issued=await ssaCoordinator().issueSessionAssertion(access,request(),codec,material);
    expect(issued?.claims).toMatchObject({session_id:binding.sessionId,user_id:userId,tenant_membership_id:membershipId,device_id:deviceId,installation_id:installationId,sequence:1});
    expect(issued?.claims).not.toHaveProperty("permissions");expect(issued?.claims).not.toHaveProperty("roles");
    expect(verify(null,Buffer.from(canonicalSessionTrustJson(issued!.claims)),material.signedOperationalKey.claims.public_key_pem,Buffer.from(issued!.signature,"base64url"))).toBe(true);
    expect(Date.parse(issued!.claims.offline_valid_until)).toBeLessThanOrEqual(Date.parse(binding.expiresAt));
    const events=await owner.query("SELECT count(*)::int AS n FROM identity.security_events WHERE session_id=$1 AND reason_code='ISOLATED_SSA_ISSUED'",[binding.sessionId]);
    expect(events.rows[0].n).toBe(1);
  });
  it.each(["root","key","status"])("business SSA composition: rejects invalid %s signing material",async target=>{
    const {codec,access}=await signedAccessForSequence(),material=ssaMaterial();
    if(target==="root")material.rootTrustAnchor=generateKeyPairSync("ed25519").publicKey;
    if(target==="key")material.operationalPrivateKey=generateKeyPairSync("ed25519").privateKey;
    if(target==="status")material.signedOperationalKey.claims.status="REVOKED";
    await expect(ssaCoordinator().issueSessionAssertion(access,request(),codec,material)).rejects.toThrow();
    const events=await owner.query("SELECT count(*)::int AS n FROM identity.security_events WHERE session_id=$1 AND reason_code='ISOLATED_SSA_ISSUED'",[binding.sessionId]);
    expect(events.rows[0].n).toBe(0);
  });
  it("business SSA composition: missing or forged identity never emits an assertion",async()=>{
    const {codec}=await signedAccessForSequence();
    expect(await ssaCoordinator().issueSessionAssertion(binding.sessionId,request(),codec,ssaMaterial())).toBeNull();
    expect(await counters()).toEqual({nonces:0,sequence:0});
  });
  it("business SSA composition: expired certified key cannot emit and missing policy fails before reservation",async()=>{
    const {codec,access}=await signedAccessForSequence(),missing=ssaMaterial();
    missing.policy.maximumOfflineLifetimeMs=0;
    await expect(ssaCoordinator().issueSessionAssertion(access,request(),codec,missing)).rejects.toThrow("BUSINESS_SSA_ISOLATED_SIGNING_POLICY_REQUIRED");
    expect(await counters()).toEqual({nonces:0,sequence:0});
    expect(await ssaCoordinator().issueSessionAssertion(access,request(),codec,ssaMaterial(new Date(Date.now()-1000).toISOString()))).toBeNull();
  });
  it.each(["BUSINESS","device credential"])("business SSA composition: rejects revoked %s",async target=>{
    const {codec,access}=await signedAccessForSequence();
    if(target==="BUSINESS")await owner.query("UPDATE identity.sessions SET revoked_at=clock_timestamp(),revoked_by_actor_type='SYSTEM',revocation_reason='FIXTURE' WHERE id=$1",[binding.sessionId]);
    else await owner.query("UPDATE identity.device_credentials SET status='REVOKED',revoked_at=clock_timestamp() WHERE credential_id=$1",[deviceCredentialId]);
    expect(await ssaCoordinator().issueSessionAssertion(access,request(),codec,ssaMaterial())).toBeNull();
    expect(await counters()).toEqual({nonces:0,sequence:0});
  });
  it("business SSA composition: audit rollback returns no assertion and preserves burned sequence",async()=>{
    const {codec,access}=await signedAccessForSequence(),material=ssaMaterial();
    await owner.query("REVOKE INSERT ON identity.security_events FROM pos_platform_app");
    try{await expect(ssaCoordinator().issueSessionAssertion(access,request(),codec,material)).rejects.toMatchObject({code:"42501"});}
    finally{await owner.query("GRANT INSERT ON identity.security_events TO pos_platform_app");}
    expect(await counters()).toEqual({nonces:1,sequence:1});
    expect((await ssaCoordinator().issueSessionAssertion(access,request(),codec,material))?.claims.sequence).toBe(2);
  });
  it("business SSA composition: concurrent replay emits only one assertion",async()=>{
    const {codec,access}=await signedAccessForSequence(),proof=request(),material=ssaMaterial(),coordinator=ssaCoordinator();
    const issued=await Promise.all([coordinator.issueSessionAssertion(access,proof,codec,material),coordinator.issueSessionAssertion(access,proof,codec,material)]);
    expect(issued.filter(Boolean)).toHaveLength(1);
  });
  it("access-to-sequence: rejects UUIDs serialized identities and modified access before consuming device nonce",async()=>{
    const {codec,access}=await signedAccessForSequence();
    for(const value of [binding.sessionId,JSON.stringify(binding),access.slice(0,-4)+"AAAA"]){
      expect(await preparation.prepareSequenceFromAccess(value,request(),codec)).toBeNull();
    }
    expect(await counters()).toEqual({nonces:0,sequence:0});
  });
  it("access-to-sequence: rejects another signed session selector before consuming the proof",async()=>{
    const {codec,access}=await signedAccessForSequence();
    expect(await preparation.prepareSequenceFromAccess(access,request(uuidV7()),codec)).toBeNull();
    expect(await counters()).toEqual({nonces:0,sequence:0});
  });
  it("access-to-sequence: accepts exactly one concurrent replay and retains the durable watermark",async()=>{
    const {codec,access}=await signedAccessForSequence(),proof=request();
    const results=await Promise.all([preparation.prepareSequenceFromAccess(access,proof,codec),preparation.prepareSequenceFromAccess(access,proof,codec)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await counters()).toEqual({nonces:1,sequence:1});
  });
  it("access-to-sequence: fresh proofs reserve increasing sequences for the same verified access",async()=>{
    const {codec,access}=await signedAccessForSequence();
    const results=await Promise.all([preparation.prepareSequenceFromAccess(access,request(),codec),preparation.prepareSequenceFromAccess(access,request(),codec)]);
    expect(results.map(value=>value?.reservation.sequence).sort()).toEqual([1,2]);
    expect(await counters()).toEqual({nonces:2,sequence:2});
  });
  it("access-to-sequence: rejects a different valid device credential despite matching device and signature",async()=>{
    const {codec,access}=await signedAccessForSequence(),other=uuidV7();
    await owner.query(`INSERT INTO identity.device_credentials(credential_id,device_id,installation_id,tenant_id,company_id,device_key_id,trust_key_id,key_purpose,status,generation,issued_at,expires_at,credential_checksum,issuer_signature,created_at)
      SELECT $1,device_id,installation_id,tenant_id,company_id,device_key_id,trust_key_id,key_purpose,'ACTIVE',2,issued_at,expires_at,$2,issuer_signature,created_at
      FROM identity.device_credentials WHERE credential_id=$3`,[other,randomBytes(32).toString("hex"),deviceCredentialId]);
    const body=JSON.stringify({session_id:binding.sessionId}),requestId=uuidV7(),correlationId=uuidV7();
    const authorization=createDeviceRequestAuthorization({method:"POST",path:BUSINESS_SSA_DEVICE_PROOF_PATH,requestId,correlationId,credentialId:other,body},deviceKeys.privateKey);
    expect(await preparation.prepareSequenceFromAccess(access,{authorization,requestId,correlationId,body},codec)).toBeNull();
    const watermark=await counters();expect(watermark.sequence).toBe(0);
  });
  it("access-to-sequence: rejects membership suspension before reservation",async()=>{
    const {codec,access}=await signedAccessForSequence();
    await owner.query("UPDATE tenancy.tenant_memberships SET status='SUSPENDED',suspended_at=clock_timestamp() WHERE id=$1",[membershipId]);
    expect(await preparation.prepareSequenceFromAccess(access,request(),codec)).toBeNull();
    expect(await counters()).toEqual({nonces:0,sequence:0});
  });
  it.each(["device","session"])("access-to-sequence: rejects revoked %s before consuming the proof",async target=>{
    const {codec,access}=await signedAccessForSequence();
    if(target==="device")await owner.query("UPDATE identity.device_credentials SET status='REVOKED',revoked_at=clock_timestamp() WHERE credential_id=$1",[deviceCredentialId]);
    else await owner.query("UPDATE identity.sessions SET revoked_at=clock_timestamp(),revoked_by_actor_type='SYSTEM',revocation_reason='FIXTURE' WHERE id=$1",[binding.sessionId]);
    expect(await preparation.prepareSequenceFromAccess(access,request(),codec)).toBeNull();
    expect(await counters()).toEqual({nonces:0,sequence:0});
  });
  it("access-to-sequence: final revocation rejects the reservation without restoring its nonce or watermark",async()=>{
    const {codec,access}=await signedAccessForSequence();
    await owner.query(`CREATE FUNCTION identity.sequence_test_revoke_session() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      UPDATE identity.sessions SET revoked_at=clock_timestamp(),revoked_by_actor_type='SYSTEM',revocation_reason='FIXTURE'
      WHERE id='${binding.sessionId}'; RETURN NEW; END $$;
      CREATE TRIGGER sequence_test_revoke_session AFTER INSERT ON identity.session_assertion_sequences
      FOR EACH ROW EXECUTE FUNCTION identity.sequence_test_revoke_session()`);
    try{expect(await preparation.prepareSequenceFromAccess(access,request(),codec)).toBeNull();}
    finally{await owner.query("DROP TRIGGER sequence_test_revoke_session ON identity.session_assertion_sequences; DROP FUNCTION identity.sequence_test_revoke_session()");}
    expect(await counters()).toEqual({nonces:1,sequence:1});
  });
  it("access-to-sequence: allocation failure rolls watermark back and burns the independently committed nonce",async()=>{
    const {codec,access}=await signedAccessForSequence(),proof=request();
    await owner.query("REVOKE INSERT ON identity.session_assertion_sequences FROM pos_platform_app");
    try{await expect(preparation.prepareSequenceFromAccess(access,proof,codec)).rejects.toMatchObject({code:"42501"});}
    finally{await owner.query("GRANT INSERT ON identity.session_assertion_sequences TO pos_platform_app");}
    expect(await counters()).toEqual({nonces:1,sequence:0});
    expect(await preparation.prepareSequenceFromAccess(access,proof,codec)).toBeNull();
    expect((await preparation.prepareSequenceFromAccess(access,request(),codec))?.reservation.sequence).toBe(1);
  });
  it("issues signed short-lived access with canonical atomic audit and verifies live BUSINESS/device",async()=>{
    const codec=isolatedAccessCodec();
    const token=await codec.issue(binding,{deviceId,credentialId:deviceCredentialId},uuidV7());
    expect(token?.split(".")).toHaveLength(3);
    const decoded=await codec.verify(token!);
    expect(decoded).toMatchObject({sub:userId,sid:binding.sessionId,
      tid:tenantId,mid:membershipId,did:deviceId,cid:deviceCredentialId});
    expect(decoded!.exp-decoded!.iat).toBeLessThanOrEqual(300);
    const rows=await owner.query(`SELECT count(*)::int AS n FROM identity.security_events
      WHERE session_id=$1 AND event_code=$2`,[binding.sessionId,PlatformSecurityEventCode.ACCESS_ISSUED]);
    expect(rows.rows[0].n).toBe(1);
  });
  it("rejects manipulated or unknown-key access signatures",async()=>{
    const codec=isolatedAccessCodec();
    const token=await codec.issue(binding,{deviceId,credentialId:deviceCredentialId},uuidV7());
    expect(await codec.verify(token!.slice(0,-2)+"ab")).toBeNull();
    expect(await isolatedAccessCodec().verify(token!)).toBeNull();
  });
  it("rejects access after the BUSINESS session or bound device credential is revoked",async()=>{
    const codec=isolatedAccessCodec();
    const token=await codec.issue(binding,{deviceId,credentialId:deviceCredentialId},uuidV7());
    await owner.query(`UPDATE identity.device_credentials SET status='REVOKED',
      revoked_at=clock_timestamp(),revoked_reason='FIXTURE' WHERE credential_id=$1`,[deviceCredentialId]);
    expect(await codec.verify(token!)).toBeNull();
  });
  it("rolls back access emission when canonical audit cannot be persisted",async()=>{
    const codec=isolatedAccessCodec();
    await owner.query("REVOKE INSERT ON identity.security_events FROM pos_platform_app");
    try {
      await expect(codec.issue(binding,{deviceId,credentialId:deviceCredentialId},uuidV7()))
        .rejects.toMatchObject({code:"42501"});
    } finally {await owner.query("GRANT INSERT ON identity.security_events TO pos_platform_app");}
  });

  it("coordinates trusted BUSINESS reference and device proof to one-use PKCE exchange",async()=>{
    const coordinator=new IsolatedBusinessAuthCoordinator(preparation,runtime,{
      authorityReference:"DURABLE_FIXTURE_BINDING_AUDIT",
      record:async checked=>{
        await owner.query(`INSERT INTO identity.native_code_audit_fixture (session_id,code_hash)
          VALUES ($1,$2)`,[checked.identity.sessionId,"proof-"+uuidV7()]);
      },
    });
    const registration={clientId:"desktop",redirectUri:exchangeRedirect,
      authorizationOrigin:"https://business.example.test"};
    expect(await coordinator.authorize({...reference},request(),registration,{
      codeChallenge:derivePkceS256Challenge(exchangeVerifier),state:exchangeState,
    })).toBeNull();
    const code=await coordinator.authorize(reference,request(),registration,{
      codeChallenge:derivePkceS256Challenge(exchangeVerifier),state:exchangeState,
    });
    expect(code).toMatch(/^[A-Za-z0-9_-]{64}$/);
    const result=await coordinator.exchange(registration,{code:code!,verifier:exchangeVerifier,state:exchangeState});
    expect(result).toEqual({sessionId:binding.sessionId,deviceId,tenantId,credentialId:deviceCredentialId});
    expect(await coordinator.exchange(registration,{code:code!,verifier:exchangeVerifier,state:exchangeState})).toBeNull();
  });

  async function getPairBinding() {
    const verified=await createIsolatedCommercialBindingPrerequisite(preparation,runtime,{
      authorityReference:"DURABLE_PHYSICAL_PAIR_FIXTURE",
      record:async checked=>{
        await owner.query(`INSERT INTO identity.native_code_audit_fixture (session_id,code_hash)
          VALUES ($1,$2)`,[checked.identity.sessionId,"pair-"+uuidV7()]);
      },
    }).establish(reference,request());
    if(!verified)throw Error("PAIR_BINDING_FIXTURE_FAILED");
    return verified;
  }
  it("atomically issues both access and refresh from the verified BUSINESS binding",async()=>{
    const trusted=await getPairBinding(),codec=isolatedAccessCodec();
    const pair=await new IsolatedBusinessCredentialPairIssuer(runtime,codec).issue(trusted,uuidV7());
    expect(pair?.refreshToken).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(await codec.verify(pair!.accessToken)).toMatchObject({
      sid:binding.sessionId,sub:userId,tid:tenantId,did:deviceId,
    });
    const saved=await owner.query(`SELECT count(*)::int AS n FROM identity.session_refresh_tokens
      WHERE session_id=$1 AND token_hash=$2`,
      [binding.sessionId,createHash("sha256").update(pair!.refreshToken).digest("hex")]);
    expect(saved.rows[0].n).toBe(1);
    const audit=await owner.query(`SELECT count(*)::int AS n FROM identity.security_events
      WHERE session_id=$1 AND event_code=$2`,[binding.sessionId,PlatformSecurityEventCode.ACCESS_ISSUED]);
    expect(audit.rows[0].n).toBe(1);
  });
  it("rolls back access audit when refresh insertion fails",async()=>{
    const trusted=await getPairBinding(),codec=isolatedAccessCodec();
    await owner.query("REVOKE INSERT ON identity.session_refresh_tokens FROM pos_platform_app");
    try {
      await expect(new IsolatedBusinessCredentialPairIssuer(runtime,codec).issue(trusted,uuidV7()))
        .rejects.toMatchObject({code:"42501"});
    } finally {await owner.query("GRANT INSERT ON identity.session_refresh_tokens TO pos_platform_app");}
    const events=await owner.query(`SELECT count(*)::int AS n FROM identity.security_events
      WHERE session_id=$1 AND event_code=$2`,[binding.sessionId,PlatformSecurityEventCode.ACCESS_ISSUED]);
    expect(events.rows[0].n).toBe(0);
  });
  it("rolls back refresh and access when canonical audit fails",async()=>{
    const trusted=await getPairBinding(),codec=isolatedAccessCodec();
    await owner.query("REVOKE INSERT ON identity.security_events FROM pos_platform_app");
    try {
      await expect(new IsolatedBusinessCredentialPairIssuer(runtime,codec).issue(trusted,uuidV7()))
        .rejects.toMatchObject({code:"42501"});
    } finally {await owner.query("GRANT INSERT ON identity.security_events TO pos_platform_app");}
    const refreshed=await owner.query(`SELECT count(*)::int AS n FROM identity.session_refresh_tokens
      WHERE session_id=$1`,[binding.sessionId]);
    expect(refreshed.rows[0].n).toBe(0);
  });
  it("rejects a revoked BUSINESS session before issuing any credential pair",async()=>{
    const trusted=await getPairBinding(),codec=isolatedAccessCodec();
    await owner.query(`UPDATE identity.sessions SET revoked_at=clock_timestamp(),
      revoked_by_actor_type='SYSTEM',revocation_reason='FIXTURE' WHERE id=$1`,[binding.sessionId]);
    expect(await new IsolatedBusinessCredentialPairIssuer(runtime,codec).issue(trusted,uuidV7())).toBeNull();
  });

  function coordinatedCredentials() {
    const coordinator=new IsolatedBusinessAuthCoordinator(preparation,runtime,{
      authorityReference:"DURABLE_PHYSICAL_CREDENTIAL_FLOW",
      record:async checked=>{
        await owner.query(`INSERT INTO identity.native_code_audit_fixture (session_id,code_hash)
          VALUES ($1,$2)`,[checked.identity.sessionId,"credential-"+uuidV7()]);
      },
    });
    const registration={clientId:"desktop",redirectUri:exchangeRedirect,
      authorizationOrigin:"https://business.example.test"};
    const pair=new IsolatedBusinessCredentialPairIssuer(runtime,isolatedAccessCodec());
    return {coordinator,registration,pair};
  }
  it("commits PKCE consumption and access-refresh pair together",async()=>{
    const {coordinator,registration,pair}=coordinatedCredentials();
    const code=await coordinator.authorize(reference,request(),registration,{
      codeChallenge:derivePkceS256Challenge(exchangeVerifier),state:exchangeState,
    });
    expect(code).toMatch(/^[A-Za-z0-9_-]{64}$/);
    const credentials=await coordinator.exchangeCredentials(registration,{
      code:code!,verifier:exchangeVerifier,state:exchangeState,
    },pair);
    expect(credentials?.accessToken.split(".")).toHaveLength(3);
    expect(credentials?.refreshToken).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(await coordinator.exchangeCredentials(registration,{
      code:code!,verifier:exchangeVerifier,state:exchangeState,
    },pair)).toBeNull();
    const stored=await owner.query(`SELECT consumed_at FROM identity.native_authorization_code_validation
      WHERE code_hash=$1`,[createHash("sha256").update(code!).digest("hex")]);
    expect(stored.rows[0].consumed_at).not.toBeNull();
    const refresh=await owner.query(`SELECT count(*)::int AS n FROM identity.session_refresh_tokens
      WHERE session_id=$1`,[binding.sessionId]);
    expect(refresh.rows[0].n).toBe(1);
  });
  it("rolls back PKCE redemption when credential pair persistence fails, allowing retry",async()=>{
    const {coordinator,registration,pair}=coordinatedCredentials();
    const code=await coordinator.authorize(reference,request(),registration,{
      codeChallenge:derivePkceS256Challenge(exchangeVerifier),state:exchangeState,
    });
    await owner.query("REVOKE INSERT ON identity.session_refresh_tokens FROM pos_platform_app");
    try {
      await expect(coordinator.exchangeCredentials(registration,{
        code:code!,verifier:exchangeVerifier,state:exchangeState,
      },pair)).rejects.toMatchObject({code:"42501"});
    } finally {await owner.query("GRANT INSERT ON identity.session_refresh_tokens TO pos_platform_app");}
    const digest=createHash("sha256").update(code!).digest("hex");
    const state=await owner.query(`SELECT consumed_at FROM identity.native_authorization_code_validation
      WHERE code_hash=$1`,[digest]);
    expect(state.rows[0].consumed_at).toBeNull();
    const delivered=await coordinator.exchangeCredentials(registration,{
      code:code!,verifier:exchangeVerifier,state:exchangeState,
    },pair);
    expect(delivered?.accessToken.split(".")).toHaveLength(3);
  });

  it("bridges protected browser BUSINESS reference to registered native PKCE without client redirect override",async()=>{
    const registration={clientId:"desktop",redirectUri:exchangeRedirect,
      authorizationOrigin:"https://business.example.test"};
    const coordinator=new IsolatedBusinessAuthCoordinator(preparation,runtime,{
      authorityReference:"DURABLE_BROWSER_BRIDGE_TEST",
      record:async checked=>{
        await owner.query(`INSERT INTO identity.native_code_audit_fixture(session_id,code_hash)
          VALUES ($1,$2)`,[checked.identity.sessionId,"browser-"+uuidV7()]);
      },
    });
    const browser=new IsolatedBusinessBrowserLogin(flow,preparation,coordinator,
      new CommercialNativeClientCatalog([registration]));
    const invalid=await browser.authorize(reference,request(),{
      clientId:"desktop",redirectUri:"http://127.0.0.1:23456/callback",
      codeChallenge:derivePkceS256Challenge(exchangeVerifier),state:exchangeState,
    });
    expect(invalid).toBeNull();
    const authorized=await browser.authorize(reference,request(),{
      clientId:"desktop",redirectUri:exchangeRedirect,
      codeChallenge:derivePkceS256Challenge(exchangeVerifier),state:exchangeState,
    });
    expect(authorized).toMatchObject({redirectUri:exchangeRedirect,state:exchangeState});
    const trusted=await coordinator.exchange(registration,{
      code:authorized!.code,verifier:exchangeVerifier,state:exchangeState,
    });
    expect(trusted).toEqual({sessionId:binding.sessionId,deviceId,tenantId,
      credentialId:deviceCredentialId});
  });

  it("binds browser cookie and CSRF to genuine BUSINESS DeviceProof PKCE, rotates and durably logs out",async()=>{
    const registration={clientId:"desktop",redirectUri:exchangeRedirect,
      authorizationOrigin:"https://business.example.test"};
    const coordinator=new IsolatedBusinessAuthCoordinator(preparation,runtime,{
      authorityReference:"DURABLE_COOKIE_BRIDGE_FIXTURE",
      record:async checked=>{
        await owner.query(`INSERT INTO identity.native_code_audit_fixture(session_id,code_hash)
          VALUES ($1,$2)`,[checked.identity.sessionId,"cookie-"+uuidV7()]);
      },
    });
    const origin="https://business.example.test";
    const browser=new IsolatedBusinessBrowserLogin(flow,preparation,coordinator,
      new CommercialNativeClientCatalog([registration]));
    const vault=new IsolatedBrowserSessionVault(origin);
    const bridge=new IsolatedBusinessBrowserSessionBridge(browser,vault,preparation);
    const issued=vault.establish(reference,origin)!;
    const protectedRequest=(cookie=issued.setCookie,csrfToken=issued.csrfToken)=>({
      cookie:cookie.split(";")[0]!,csrfToken,origin,fetchSite:"same-origin",method:"POST",
    });
    expect(await bridge.authorize(protectedRequest(issued.setCookie,"x".repeat(43)),request(),{
      clientId:"desktop",redirectUri:exchangeRedirect,
      codeChallenge:derivePkceS256Challenge(exchangeVerifier),state:exchangeState,
    })).toBeNull();
    const rotated=bridge.rotate(protectedRequest())!;
    expect(rotated).not.toBeNull();
    expect(vault.inspect(protectedRequest())).toBeNull();
    const valid=protectedRequest(rotated.setCookie,rotated.csrfToken);
    const auth=await bridge.authorize(valid,request(),{
      clientId:"desktop",redirectUri:exchangeRedirect,
      codeChallenge:derivePkceS256Challenge(exchangeVerifier),state:exchangeState,
    });
    expect(auth?.code).toMatch(/^[A-Za-z0-9_-]{64}$/);
    const closed=await bridge.logout(valid);
    expect(closed?.sessionState).toBe("REVOKED");
    expect(closed?.clearCookie).toContain("Max-Age=0");
    expect(vault.inspect(valid)).toBeNull();
  });

  it("persists opaque browser sessions across independent store instances, rotating atomically",async()=>{
    const one=new IsolatedDurableBrowserSessionStore(runtime,origin);
    const second=new IsolatedDurableBrowserSessionStore(runtime,origin);
    expect(await one.establish(preparation,{...reference})).toBeNull();
    const issued=await one.establish(preparation,reference);
    expect(issued?.setCookie).toContain("Secure; HttpOnly; SameSite=Strict");
    const req=(cookie:string,csrfToken:string)=>({
      cookie:cookie.split(";")[0]!,csrfToken,origin,fetchSite:"same-origin",method:"POST",
    });
    expect(await second.inspect(req(issued!.setCookie,issued!.csrfToken)))
      .toEqual({sessionId:binding.sessionId,userId,tenantId,tenantMembershipId:membershipId});
    const rotated=await Promise.all([
      one.rotate(req(issued!.setCookie,issued!.csrfToken)),
      second.rotate(req(issued!.setCookie,issued!.csrfToken)),
    ]);
    expect(rotated.filter(Boolean)).toHaveLength(1);
    expect(await one.inspect(req(issued!.setCookie,issued!.csrfToken))).toBeNull();
    const next=rotated.find(Boolean)!;
    expect(await second.inspect(req(next.setCookie,next.csrfToken))).not.toBeNull();
    expect(await one.logout(req(next.setCookie,next.csrfToken))).toBe(true);
    expect(await second.inspect(req(next.setCookie,next.csrfToken))).toBeNull();
  });
  it("rejects durable browser sessions after canonical BUSINESS session revocation",async()=>{
    const store=new IsolatedDurableBrowserSessionStore(runtime,origin);
    const issued=await store.establish(preparation,reference);
    expect(issued).not.toBeNull();
    await owner.query(`UPDATE identity.sessions SET revoked_at=clock_timestamp(),
      revoked_by_actor_type='SYSTEM',revocation_reason='FIXTURE' WHERE id=$1`,[binding.sessionId]);
    expect(await store.inspect({cookie:issued!.setCookie.split(";")[0]!,csrfToken:issued!.csrfToken,
      origin,fetchSite:"same-origin",method:"POST"})).toBeNull();
  });

  const canonicalPolicy={mode:"CANONICAL" as const,lifetimeMs:30_000,idleTimeoutMs:20_000,maximumReauthenticationAgeMs:30_000};
  const browserRequest=(issued:{setCookie:string;csrfToken:string})=>({cookie:issued.setCookie.split(";")[0]!,csrfToken:issued.csrfToken,origin,fetchSite:"same-origin",method:"POST"});
  async function canonicalHandoff(){
    const writer=new PostgresBrowserSessionHandoffWriter(origin,15_000);
    const token=await authority.createBrowserHandoff({mfaReceipt:await authenticate(),selection:{tenantId,membershipId}},writer);
    if(!token)throw Error("CANONICAL_HANDOFF_MISSING");
    const row=await owner.query<{session_id:string}>("SELECT session_id::text FROM identity.browser_session_handoffs WHERE handoff_hash=$1",[sha(token).toString("hex")]);
    return {token,sessionId:row.rows[0]!.session_id};
  }
  it("canonical browser: requires original MFA provenance and consumes its durable handoff once across workers",async()=>{
    const writer=new PostgresBrowserSessionHandoffWriter(origin,15_000);
    expect(await authority.createBrowserHandoff({mfaReceipt:{kind:"BUSINESS_INITIAL_MFA_RECEIPT"},selection:{tenantId,membershipId}},writer)).toBeNull();
    const proof=await canonicalHandoff();
    const one=new DurableBrowserSessionStore(runtime,origin,canonicalPolicy),two=new DurableBrowserSessionStore(runtime,origin,canonicalPolicy);
    expect(await one.establishFromHandoff(binding.sessionId)).toBeNull();
    expect(await one.establishFromHandoff({...binding})).toBeNull();
    expect("establish" in one).toBe(false);
    const issued=await Promise.all([one.establishFromHandoff(proof.token),two.establishFromHandoff(proof.token)]);
    expect(issued.filter(Boolean)).toHaveLength(1);const cookie=issued.find(Boolean)!;
    expect(await two.inspect(browserRequest(cookie))).toMatchObject({sessionId:proof.sessionId,userId,tenantId});
    expect(await one.establishFromHandoff(proof.token)).toBeNull();
    const persisted=await owner.query("SELECT * FROM identity.browser_sessions WHERE session_id=$1",[proof.sessionId]);
    expect(JSON.stringify(persisted.rows)).not.toContain(cookie.csrfToken);
    expect(JSON.stringify(persisted.rows)).not.toContain(cookie.setCookie.split("=")[1]!.split(";")[0]!);
  });
  it("canonical browser: rejects forged and duplicate cookies, bad CSRF, origin and fetch metadata",async()=>{
    const store=new DurableBrowserSessionStore(runtime,origin,canonicalPolicy);const proof=await canonicalHandoff();
    const issued=(await store.establishFromHandoff(proof.token))!;const req=browserRequest(issued);
    for(const input of [{...req,cookie:req.cookie+"; "+req.cookie},{...req,cookie:"__Host-camacho_business="+"x".repeat(43)},
      {...req,csrfToken:"x".repeat(43)},{...req,origin:"https://evil.example.test"},{...req,fetchSite:"cross-site"},{...req,method:"GET"}])expect(await store.inspect(input)).toBeNull();
    expect(await store.inspect(req)).not.toBeNull();
  });
  it.each(["user","tenant","membership","factor","password","session"])("canonical browser: revalidates %s changes across instances",async(kind)=>{
    const proof=await canonicalHandoff();const store=new DurableBrowserSessionStore(runtime,origin,canonicalPolicy);
    const issued=(await store.establishFromHandoff(proof.token))!;
    if(kind==="user")await owner.query("UPDATE identity.users SET status='INACTIVE' WHERE id=$1",[userId]);
    if(kind==="tenant")await owner.query("UPDATE tenancy.tenants SET status='SUSPENDED' WHERE id=$1",[tenantId]);
    if(kind==="membership")await owner.query("UPDATE tenancy.tenant_memberships SET status='SUSPENDED',suspended_at=clock_timestamp() WHERE id=$1",[membershipId]);
    if(kind==="factor")await owner.query("UPDATE identity.mfa_factors SET status='REVOKED',revoked_at=clock_timestamp() WHERE id=$1",[factorId]);
    if(kind==="password")await owner.query("UPDATE identity.user_credentials SET version=version+1 WHERE id=$1",[credentialId]);
    if(kind==="session")await owner.query("UPDATE identity.sessions SET revoked_at=clock_timestamp(),revoked_by_actor_type='SYSTEM',revocation_reason='TEST' WHERE id=$1",[proof.sessionId]);
    expect(await new DurableBrowserSessionStore(runtime,origin,canonicalPolicy).inspect(browserRequest(issued))).toBeNull();
  });
  it("canonical browser: concurrent rotation has one winner and preserves absolute expiry",async()=>{
    const proof=await canonicalHandoff();const one=new DurableBrowserSessionStore(runtime,origin,canonicalPolicy),two=new DurableBrowserSessionStore(runtime,origin,canonicalPolicy);
    const issued=(await one.establishFromHandoff(proof.token))!;const req=browserRequest(issued);
    const results=await Promise.all([one.rotate(req),two.rotate(req)]);expect(results.filter(Boolean)).toHaveLength(1);
    expect(await one.inspect(req)).toBeNull();expect(await two.inspect(browserRequest(results.find(Boolean)!))).not.toBeNull();
    const rows=await owner.query<{n:number}>("SELECT count(DISTINCT expires_at)::int AS n FROM identity.browser_sessions WHERE session_id=$1",[proof.sessionId]);expect(rows.rows[0]!.n).toBe(1);
  });
  it("canonical browser: logout revokes BUSINESS, every refresh and browser session atomically",async()=>{
    const proof=await canonicalHandoff();const store=new DurableBrowserSessionStore(runtime,origin,canonicalPolicy);
    const issued=(await store.establishFromHandoff(proof.token))!;
    await owner.query("INSERT INTO identity.session_refresh_tokens(id,session_id,token_family_id,token_hash,issued_at,expires_at) VALUES($1,$2,$3,$4,clock_timestamp(),clock_timestamp()+interval '1 minute')",[uuidV7(),proof.sessionId,uuidV7(),randomBytes(32).toString("hex")]);
    expect(await store.logout(browserRequest(issued))).toBe(true);
    expect(await new DurableBrowserSessionStore(runtime,origin,canonicalPolicy).inspect(browserRequest(issued))).toBeNull();
    const rows=await owner.query("SELECT revoked_at IS NOT NULL AS closed FROM identity.sessions WHERE id=$1",[proof.sessionId]);expect(rows.rows[0].closed).toBe(true);
    const refresh=await owner.query("SELECT revoked_at IS NOT NULL AS closed FROM identity.session_refresh_tokens WHERE session_id=$1",[proof.sessionId]);expect(refresh.rows[0].closed).toBe(true);
  });
  it("canonical browser: audit failure rolls cookie creation and handoff consumption back",async()=>{
    const proof=await canonicalHandoff();const store=new DurableBrowserSessionStore(runtime,origin,canonicalPolicy);
    await owner.query(`CREATE FUNCTION identity.test_browser_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_code='PLATFORM_BROWSER_SESSION_ISSUED' THEN RAISE EXCEPTION 'browser audit unavailable'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER test_browser_audit_failure BEFORE INSERT ON identity.security_events FOR EACH ROW EXECUTE FUNCTION identity.test_browser_audit_failure()`);
    try{await expect(store.establishFromHandoff(proof.token)).rejects.toThrow("browser audit unavailable");}
    finally{await owner.query("DROP TRIGGER test_browser_audit_failure ON identity.security_events; DROP FUNCTION identity.test_browser_audit_failure()");}
    expect((await owner.query("SELECT consumed_at FROM identity.browser_session_handoffs WHERE session_id=$1",[proof.sessionId])).rows[0].consumed_at).toBeNull();
    expect(await store.establishFromHandoff(proof.token)).not.toBeNull();
  });
  it("canonical browser: expires using PostgreSQL time and refuses unapproved policy omissions",async()=>{
    const proof=await canonicalHandoff();const store=new DurableBrowserSessionStore(runtime,origin,{...canonicalPolicy,lifetimeMs:100});
    const issued=(await store.establishFromHandoff(proof.token))!;await new Promise(resolve=>setTimeout(resolve,150));
    expect(await store.inspect(browserRequest(issued))).toBeNull();
    expect(()=>new DurableBrowserSessionStore(runtime,origin,{} as never)).toThrow("EXPLICIT_POLICY_REQUIRED");
  });
  it("canonical browser: handoff writer failure rolls BUSINESS and its issuance audit back",async()=>{
    const before=await owner.query("SELECT count(*)::int AS n FROM identity.sessions WHERE user_id=$1",[userId]);
    const next=await authenticate();const writer=new PostgresBrowserSessionHandoffWriter(origin,15_000);
    await owner.query(`CREATE FUNCTION identity.test_handoff_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'handoff write unavailable'; END $$;
      CREATE TRIGGER test_handoff_failure BEFORE INSERT ON identity.browser_session_handoffs FOR EACH ROW EXECUTE FUNCTION identity.test_handoff_failure()`);
    try{await expect(authority.createBrowserHandoff({mfaReceipt:next,selection:{tenantId,membershipId}},writer)).rejects.toThrow("handoff write unavailable");}
    finally{await owner.query("DROP TRIGGER test_handoff_failure ON identity.browser_session_handoffs; DROP FUNCTION identity.test_handoff_failure()");}
    expect((await owner.query("SELECT count(*)::int AS n FROM identity.sessions WHERE user_id=$1",[userId])).rows[0].n).toBe(before.rows[0].n);
    expect(await authority.createBrowserHandoff({mfaReceipt:next,selection:{tenantId,membershipId}},writer)).toBeNull();
  });
  it("canonical browser: idle expiry, immutable history and least-privilege permissions",async()=>{
    const proof=await canonicalHandoff();const store=new DurableBrowserSessionStore(runtime,origin,{...canonicalPolicy,idleTimeoutMs:100});
    const issued=(await store.establishFromHandoff(proof.token))!;
    await expect(runtime.query("UPDATE identity.browser_sessions SET user_id=$1 WHERE session_id=$2",[userId,proof.sessionId])).rejects.toThrow("permission denied");
    await expect(runtime.query("DELETE FROM identity.browser_sessions WHERE session_id=$1",[proof.sessionId])).rejects.toThrow("permission denied");
    await expect(runtime.query("UPDATE identity.browser_session_handoffs SET consumed_at=NULL WHERE session_id=$1",[proof.sessionId])).rejects.toThrow("cannot be replaced or reused");
    await new Promise(resolve=>setTimeout(resolve,150));expect(await store.inspect(browserRequest(issued))).toBeNull();
    const role=await runtime.query("SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user");expect(role.rows[0]).toEqual({rolsuper:false,rolbypassrls:false});
  });

  let tls:ReturnType<typeof labTls>|undefined;
  const androidRegistration={clientId:"android",platform:"ANDROID" as const,authorizationOrigin:origin,redirectUri:origin+"/android/callback",
    androidPackageId:"co.camachopos.android",androidSigningCertificateSha256:Array(32).fill("A1").join(":")};
  async function withHttps(work:(post:(path:string,payload:unknown,headers?:Record<string,string|string[]>,raw?:string|Buffer)=>ReturnType<typeof postLabHttps>,codec:IsolatedBusinessAccessTokenCodec,server:Server,coordinator:IsolatedBusinessAuthCoordinator,signing:ReturnType<typeof ssaMaterial>)=>Promise<void>,requestsPerMinute=100,browserEntry=false,nativePolicy?:Partial<IsolatedNativeRequestPolicy>,authorization?:(codec:IsolatedBusinessAccessTokenCodec)=>IsolatedAuthorizationSnapshotIssuer,authorizationTrustCandidate?:SignedAuthorizationTrustCandidate){
    tls??=labTls();
    const codec=isolatedAccessCodec();
    const coordinator=new IsolatedBusinessAuthCoordinator(preparation,runtime,{
      authorityReference:"CANONICAL_HTTPS_BINDING_AUDIT",
      record:async checked=>{
        const client=await runtime.connect();
        try{
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.tenant_id',$1,true)",[checked.identity.tenantId]);
        const clock=await client.query<{at:Date}>("SELECT clock_timestamp() AS at");
        await new PostgresPlatformSecurityEventRepository(runtime).append({user_id:checked.identity.userId,
          session_id:checked.identity.sessionId,tenant_id:checked.identity.tenantId,
          event_code:PlatformSecurityEventCode.LOGIN_SUCCEEDED,result:"SUCCEEDED",reason_code:"ISOLATED_HTTPS_DEVICE_BINDING",
          correlation_id:uuidV7(),occurred_at:clock.rows[0]!.at.toISOString()},client);
        await client.query("COMMIT");
        }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
      },
    });
    const registration={clientId:nativePolicy?nativeClientId:"desktop",redirectUri:exchangeRedirect,authorizationOrigin:origin};
    const signing=ssaMaterial();
    const native=nativePolicy?new IsolatedNativeBusinessRequests(runtime,{mode:"ISOLATED_VALIDATION",challengeLifetimeMs:60_000,
      requestLifetimeMs:120_000,codeLifetimeMs:60_000,maximumChallengesPerMinute:20,maximumReauthenticationAgeMs:30_000,...nativePolicy}):undefined;
    const server=await createIsolatedCommercialHttpsServer({pool:runtime,tls,origin,mfa:flow,authority,
      handoffs:new PostgresBrowserSessionHandoffWriter(origin,15_000),browser:new DurableBrowserSessionStore(runtime,origin,canonicalPolicy),
      coordinator,clients:new CommercialNativeClientCatalog([registration,androidRegistration]),pair:new IsolatedBusinessCredentialPairIssuer(runtime,codec),
      ...(native?{nativeValidation:{requests:native,codec,signing}}:{}),
      ...(authorization?{authorizationIssuer:authorization(codec)}:{}),
      ...(authorizationTrustCandidate?{authorizationTrustCandidate}:{}),
      ...(browserEntry?{browserEntry:{rpId,factorId,tenantId,membershipId,logoPng:await readFile(new URL("../../../docs/brand/camacho-pos-colombia-logo-960.png",import.meta.url))}}:{}),
      policy:{mode:"ISOLATED_VALIDATION",maximumBodyBytes:32*1024,requestsPerMinute}});
    try{await work((path,payload,headers={},raw)=>postLabHttps(server,tls!.cert,"/v1/commercial/"+path,payload,headers,raw),codec,server,coordinator,signing);}
    finally{await closeLabHttps(server);}
  }
  const originHeaders={origin,"sec-fetch-site":"same-origin"};
  it("HTTPS browser entry: exact registered native request nonce CSP and no authentication side effects",async()=>withHttps(async(_post,_codec,server)=>{
    const query=new URLSearchParams({client_id:"desktop",redirect_uri:exchangeRedirect,code_challenge:derivePkceS256Challenge(exchangeVerifier),code_challenge_method:"S256",state:exchangeState});
    const path="/v1/commercial/login?"+query;
    const before=await owner.query("SELECT count(*)::int AS n FROM identity.webauthn_challenges WHERE user_id=$1",[userId]);
    const page=await getLabHttps(server,tls!.cert,path);
    expect(page.status).toBe(200);expect(page.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(page.headers["cache-control"]).toBe("no-store");expect(page.headers["set-cookie"]).toBeUndefined();
    expect(page.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(page.headers["content-security-policy"]).toContain("connect-src 'self'");
    const nonce=page.body.match(/<script nonce="([A-Za-z0-9_-]+)"/)!;
    expect(nonce?.[1]).toBeTruthy();expect(page.headers["content-security-policy"]).toContain("'nonce-"+nonce[1]+"'");
    expect(page.body).toContain("navigator.credentials.get");expect(page.body).not.toContain(password);
    expect(page.body).not.toContain("localStorage.setItem");
    const again=await getLabHttps(server,tls!.cert,path);expect(again.body).not.toContain('nonce="'+nonce[1]+'"');
    const bad=[path+"&client_id=desktop",path+"&unexpected=1"];
    for(const [key,value] of [["redirect_uri","http://127.0.0.1:1/callback"],["client_id","unknown"],["code_challenge_method","plain"],["state","short"]]){
      const altered=new URLSearchParams(query);altered.set(key!,value!);bad.push("/v1/commercial/login?"+altered);
    }
    for(const target of bad)expect((await getLabHttps(server,tls!.cert,target)).status).toBe(400);
    expect((await getLabHttps(server,tls!.cert,path,{host:"another.example.test"})).status).toBe(400);
    expect((await getLabHttps(server,tls!.cert,path,{origin:"https://another.example.test"})).status).toBe(400);
    const after=await owner.query("SELECT count(*)::int AS n FROM identity.webauthn_challenges WHERE user_id=$1",[userId]);
    expect(after.rows).toEqual(before.rows);
  },100,true));
  it.runIf(process.platform==="win32")("Electron browser ceremony: native PKCE entry real Chromium WebAuthn BUSINESS and confirmed logout",async()=>withHttps(async(_post,_codec,server)=>{
    const address=server.address();if(!address||typeof address==="string")throw Error("HTTPS_BROWSER_ADDRESS_MISSING");
    const before=await owner.query("SELECT count(*)::int AS n FROM identity.sessions WHERE user_id=$1",[userId]);
    const counter=await owner.query("SELECT counter::int AS n FROM identity.webauthn_credential_material WHERE id=$1",[materialId]);
    const observed=await exerciseElectronCommercialBrowser({port:address.port,certificateFingerprint:new X509Certificate(tls!.cert).fingerprint256,
      email,password,credentialId:Buffer.from(publicCredentialId,"base64url").toString("base64"),
      privateKey:keys.privateKey.export({format:"der",type:"pkcs8"}).toString("base64"),counter:counter.rows[0].n,
      registration:{clientId:"desktop",redirectUri:exchangeRedirect,authorizationOrigin:origin},
      tenantId,companyId,branchId:uuidV7(),installationId,deviceId});
    expect(observed).toMatchObject({browserIntegration:true,phase:"BUSINESS_VERIFIED",erased:true,posStillClosed:true,
      credentialCustodyEmpty:true,cancelled:"CANCELLED",wrongPasswordRejected:true,centralLogout:true,protectedCookie:true,secure:true});
    expect(observed.phases).toEqual(expect.arrayContaining(["AUTHENTICATING","MFA_REQUIRED","VERIFYING_MFA","BUSINESS_VERIFIED","SIGNED_OUT"]));
    const after=await owner.query("SELECT count(*)::int AS n FROM identity.sessions WHERE user_id=$1",[userId]);
    expect(after.rows[0].n).toBe(before.rows[0].n+1);
    const persisted=await owner.query("SELECT s.revoked_at IS NOT NULL AS revoked FROM identity.sessions s JOIN identity.browser_sessions b ON b.session_id=s.id WHERE s.user_id=$1",[userId]);
    expect(persisted.rows).toEqual([{revoked:true}]);
    const advanced=await owner.query("SELECT counter::int AS n FROM identity.webauthn_credential_material WHERE id=$1",[materialId]);
    expect(advanced.rows[0].n).toBeGreaterThan(counter.rows[0].n);
  },100,true),90_000);
  async function httpLogin(post:Parameters<Parameters<typeof withHttps>[0]>[0],selection={tenantId,membershipId}){
    const start=await post("login",{phase:"begin",email,password,factorId},originHeaders);
    expect(start.status).toBe(200);
    const complete={phase:"complete",email,password,challenge:start.body.challenge,
      response:await assertionFor(start.body.challenge as string),...selection};
    const established=await post("login",complete,originHeaders);
    expect(established.status).toBe(200);
    expect(established.headers["cache-control"]).toBe("no-store");
    expect(established.headers["set-cookie"]?.[0]).toContain("Secure; HttpOnly; SameSite=Strict");
    const headers={...originHeaders,cookie:established.headers["set-cookie"]![0]!.split(";")[0]!,"x-csrf-token":established.body.csrfToken as string};
    const current=await post("browser/session",{},headers);expect(current.status).toBe(200);
    return {headers,sessionId:current.body.sessionId as string,complete};
  }
  type LabPost=Parameters<Parameters<typeof withHttps>[0]>[0];
  function nativeSigned(path:string,payload:unknown,credential=deviceCredentialId,key=deviceKeys.privateKey){
    const raw=JSON.stringify(payload),requestId=uuidV7(),correlationId=uuidV7();
    return {raw,headers:{authorization:createDeviceRequestAuthorization({method:"POST",path,body:raw,requestId,correlationId,credentialId:credential},key),
      "x-request-id":requestId,"x-correlation-id":correlationId}};
  }
  const nativeParams=()=>({client_id:nativeClientId,redirect_uri:exchangeRedirect,code_challenge:derivePkceS256Challenge(exchangeVerifier),code_challenge_method:"S256",state:exchangeState});
  async function nativeAttempt(post:LabPost){
    const p=nativeParams(),challenge=await post("native-request-challenges",p);
    expect(challenge.status).toBe(200);
    const payload={...p,purpose:"BUSINESS_NATIVE_AUTHORIZATION_V1",challenge_id:challenge.body.challenge_id,challenge:challenge.body.challenge};
    const proof=nativeSigned("/v1/commercial/native-requests",payload);
    const registered=await post("native-requests",payload,proof.headers,proof.raw);
    expect(registered.status).toBe(200);return {payload,proof,registered,token:registered.body.request as string};
  }
  async function nativeCode(post:LabPost){
    const attempt=await nativeAttempt(post),login=await httpLogin(post);
    const grant=await post("authorize",{request:attempt.token,confirmed:true},login.headers);
    expect(grant.status).toBe(200);
    return {...attempt,login,grant,payloadToken:{grant_type:"authorization_code",code:grant.body.code,
      code_verifier:exchangeVerifier,state:exchangeState,client_id:nativeClientId,redirect_uri:exchangeRedirect}};
  }
  it("native binding: signed registration hashes secrets and requires BUSINESS plus explicit confirmation",async()=>withHttps(async post=>{
    const a=await nativeAttempt(post);
    const stored=await owner.query("SELECT * FROM identity.native_request_validation WHERE id=$1",[a.payload.challenge_id]);
    expect(stored.rows[0].challenge_hash).toBe(sha(a.payload.challenge as string).toString("hex"));
    expect(stored.rows[0].request_hash).toBe(sha(a.token).toString("hex"));expect(stored.rows[0].credential_id).toBe(deviceCredentialId);
    expect((await post("authorize",{request:a.token,confirmed:true},originHeaders)).status).toBe(401);
    const login=await httpLogin(post);
    expect((await post("authorize",{request:a.token,confirmed:false},login.headers)).status).toBe(400);
    expect((await post("authorize",{request:a.token,confirmed:true},login.headers)).status).toBe(200);
    expect((await post("authorize",{request:a.token,confirmed:true},login.headers)).status).toBe(401);
  },100,true,{}));
  it.each(["unsigned","wrong path","wrong key","body tampering"])("native binding: rejects %s registration",async target=>withHttps(async post=>{
    const c=await post("native-request-challenges",nativeParams());
    const p={...nativeParams(),purpose:"BUSINESS_NATIVE_AUTHORIZATION_V1",challenge_id:c.body.challenge_id,challenge:c.body.challenge};
    const proof=nativeSigned(target==="wrong path"?BUSINESS_SSA_DEVICE_PROOF_PATH:"/v1/commercial/native-requests",p,deviceCredentialId,
      target==="wrong key"?generateKeyPairSync("ed25519").privateKey:deviceKeys.privateKey);
    const result=await post("native-requests",p,target==="unsigned"?{}:proof.headers,target==="body tampering"?JSON.stringify({...p,state:"x".repeat(43)}):proof.raw);
    expect([400,401]).toContain(result.status);
    const count=await owner.query("SELECT count(*)::int AS n FROM identity.native_request_validation WHERE id=$1 AND request_hash IS NOT NULL",[c.body.challenge_id]);expect(count.rows[0].n).toBe(0);
  },100,true,{}));
  it("native binding: challenge and DeviceProof are each single-use under concurrent registration",async()=>withHttps(async post=>{
    const c=await post("native-request-challenges",nativeParams()),p={...nativeParams(),purpose:"BUSINESS_NATIVE_AUTHORIZATION_V1",challenge_id:c.body.challenge_id,challenge:c.body.challenge};
    const proof=nativeSigned("/v1/commercial/native-requests",p);
    const results=await Promise.all([post("native-requests",p,proof.headers,proof.raw),post("native-requests",p,proof.headers,proof.raw)]);
    expect(results.map(r=>r.status).sort()).toEqual([200,401]);
    const fresh=nativeSigned("/v1/commercial/native-requests",p);expect((await post("native-requests",p,fresh.headers,fresh.raw)).status).toBe(401);
  },100,true,{}));
  it.each(["challenge","request","code"])("native binding: expired %s cannot advance",async target=>withHttps(async post=>{
    if(target==="challenge"){
      const c=await post("native-request-challenges",nativeParams()),p={...nativeParams(),purpose:"BUSINESS_NATIVE_AUTHORIZATION_V1",challenge_id:c.body.challenge_id,challenge:c.body.challenge};
      await owner.query("UPDATE identity.native_request_validation SET challenge_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[c.body.challenge_id]);
      const proof=nativeSigned("/v1/commercial/native-requests",p);expect((await post("native-requests",p,proof.headers,proof.raw)).status).toBe(401);return;
    }
    if(target==="request"){
      const a=await nativeAttempt(post),login=await httpLogin(post);
      await owner.query("UPDATE identity.native_request_validation SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[a.payload.challenge_id]);
      expect((await post("authorize",{request:a.token,confirmed:true},login.headers)).status).toBe(401);return;
    }
    const c=await nativeCode(post);await owner.query("UPDATE identity.native_authorization_code_validation SET expires_at=clock_timestamp()-interval '1 second' WHERE code_hash=$1",[sha(c.payloadToken.code as string).toString("hex")]);
    const proof=nativeSigned("/v1/commercial/token",c.payloadToken);expect((await post("token",c.payloadToken,proof.headers,proof.raw)).status).toBe(401);
  },100,true,{}));
  it.each(["BUSINESS","credential"])("native binding: revocation of %s rejects confirmation",async target=>withHttps(async post=>{
    const a=await nativeAttempt(post),login=await httpLogin(post);
    if(target==="BUSINESS")await owner.query("UPDATE identity.sessions SET revoked_at=clock_timestamp(),revoked_by_actor_type='SYSTEM',revocation_reason='FIXTURE' WHERE id=$1",[login.sessionId]);
    else await owner.query("UPDATE identity.device_credentials SET status='REVOKED',revoked_at=clock_timestamp() WHERE credential_id=$1",[deviceCredentialId]);
    expect((await post("authorize",{request:a.token,confirmed:true},login.headers)).status).toBe(401);
  },100,true,{}));
  it("native binding: another valid tenant session cannot approve device destination",async()=>withHttps(async post=>{
    const a=await nativeAttempt(post),otherTenant=uuidV7(),otherMembership=uuidV7();
    await owner.query("INSERT INTO tenancy.tenants(id,name,status,created_at,updated_at) VALUES ($1,'Other tenant','ACTIVE',clock_timestamp(),clock_timestamp())",[otherTenant]);
    await owner.query("INSERT INTO tenancy.tenant_memberships(id,tenant_id,user_id,membership_type,status,created_by_actor_type,created_at,activated_at) VALUES ($1,$2,$3,'MEMBER','ACTIVE','SYSTEM',clock_timestamp(),clock_timestamp())",[otherMembership,otherTenant,userId]);
    const login=await httpLogin(post,{tenantId:otherTenant,membershipId:otherMembership});
    expect((await post("authorize",{request:a.token,confirmed:true},login.headers)).status).toBe(401);
  },100,true,{}));
  it("native binding: concurrent confirmation issues only one audited code",async()=>withHttps(async post=>{
    const a=await nativeAttempt(post),login=await httpLogin(post);
    const results=await Promise.all([post("authorize",{request:a.token,confirmed:true},login.headers),post("authorize",{request:a.token,confirmed:true},login.headers)]);
    expect(results.filter(r=>r.status===200)).toHaveLength(1);
    const codes=await owner.query("SELECT count(*)::int AS n FROM identity.native_authorization_code_validation WHERE session_id=$1",[login.sessionId]);expect(codes.rows[0].n).toBe(1);
  },100,true,{}));
  it.each(["challenge","confirmation","token"])("native binding: audit rollback preserves %s transition for fresh retry",async target=>withHttps(async post=>{
    if(target==="challenge"){
      await owner.query("REVOKE INSERT ON identity.security_events FROM pos_platform_app");
      try{expect((await post("native-request-challenges",nativeParams())).status).toBe(503);}finally{await owner.query("GRANT INSERT ON identity.security_events TO pos_platform_app");}
      expect((await post("native-request-challenges",nativeParams())).status).toBe(200);return;
    }
    const c=target==="token"?await nativeCode(post):null;
    const a=c??await nativeAttempt(post),login=c?.login??await httpLogin(post);
    await owner.query("REVOKE INSERT ON identity.security_events FROM pos_platform_app");
    try{
      if(c){const proof=nativeSigned("/v1/commercial/token",c.payloadToken);expect((await post("token",c.payloadToken,proof.headers,proof.raw)).status).toBe(503);}
      else expect((await post("authorize",{request:a.token,confirmed:true},login.headers)).status).toBe(503);
    }finally{await owner.query("GRANT INSERT ON identity.security_events TO pos_platform_app");}
    if(c){const proof=nativeSigned("/v1/commercial/token",c.payloadToken);expect((await post("token",c.payloadToken,proof.headers,proof.raw)).status).toBe(200);}
    else expect((await post("authorize",{request:a.token,confirmed:true},login.headers)).status).toBe(200);
  },100,true,{}));
  it("native binding: registration audit failure rolls back challenge and binding but burns proof",async()=>withHttps(async post=>{
    const c=await post("native-request-challenges",nativeParams()),p={...nativeParams(),purpose:"BUSINESS_NATIVE_AUTHORIZATION_V1",challenge_id:c.body.challenge_id,challenge:c.body.challenge};
    const proof=nativeSigned("/v1/commercial/native-requests",p);
    await owner.query("REVOKE INSERT ON identity.security_events FROM pos_platform_app");
    try{expect((await post("native-requests",p,proof.headers,proof.raw)).status).toBe(503);}finally{await owner.query("GRANT INSERT ON identity.security_events TO pos_platform_app");}
    const row=await owner.query("SELECT request_hash,challenge_consumed_at FROM identity.native_request_validation WHERE id=$1",[c.body.challenge_id]);
    expect(row.rows[0]).toEqual({request_hash:null,challenge_consumed_at:null});
    expect((await post("native-requests",p,proof.headers,proof.raw)).status).toBe(401);
    const fresh=nativeSigned("/v1/commercial/native-requests",p);expect((await post("native-requests",p,fresh.headers,fresh.raw)).status).toBe(200);
  },100,true,{}));
  it.each(["PKCE","state","unsigned","other credential"])("native binding: token rejects %s",async target=>withHttps(async post=>{
    const c=await nativeCode(post),p={...c.payloadToken};let credential=deviceCredentialId;
    if(target==="PKCE")p.code_verifier="x".repeat(64);
    if(target==="state")p.state="x".repeat(43);
    if(target==="other credential"){
      credential=uuidV7();await owner.query(`INSERT INTO identity.device_credentials
        (credential_id,device_id,installation_id,tenant_id,company_id,device_key_id,trust_key_id,key_purpose,status,generation,issued_at,expires_at,credential_checksum,issuer_signature,created_at)
        SELECT $1,device_id,installation_id,tenant_id,company_id,device_key_id,trust_key_id,key_purpose,'ACTIVE',2,issued_at,expires_at,$2,issuer_signature,created_at
        FROM identity.device_credentials WHERE credential_id=$3`,[credential,randomBytes(32).toString("hex"),deviceCredentialId]);
    }
    const proof=nativeSigned("/v1/commercial/token",p,credential);
    expect((await post("token",p,target==="unsigned"?{}:proof.headers,proof.raw)).status).toBe(target==="unsigned"?400:401);
    if(target==="other credential"){
      const audit=await owner.query("SELECT event_code,result,reason_code FROM identity.security_events WHERE session_id=$1 AND event_code=ANY($2::text[])",
        [c.login.sessionId,[PlatformSecurityEventCode.AUTHORIZATION_CODE_REDEEMED,PlatformSecurityEventCode.AUTHORIZATION_CODE_REJECTED]]);
      expect(audit.rows).toEqual([{event_code:PlatformSecurityEventCode.AUTHORIZATION_CODE_REJECTED,result:"REJECTED",reason_code:"ISOLATED_DEVICE_MISMATCH"}]);
    }
    if(target!=="unsigned"){
      const retry=nativeSigned("/v1/commercial/token",c.payloadToken);expect((await post("token",c.payloadToken,retry.headers,retry.raw)).status).toBe(401);
    }
  },100,true,{}));
  it("native binding: stale reauthentication rejects token delivery before credentials exist",async()=>withHttps(async post=>{
    const c=await nativeCode(post);
    await owner.query("UPDATE identity.sessions SET last_reauthenticated_at=clock_timestamp()-interval '31 seconds' WHERE id=$1",[c.login.sessionId]);
    const proof=nativeSigned("/v1/commercial/token",c.payloadToken);
    expect((await post("token",c.payloadToken,proof.headers,proof.raw)).status).toBe(401);
    const refresh=await owner.query("SELECT count(*)::int AS n FROM identity.session_refresh_tokens WHERE session_id=$1",[c.login.sessionId]);
    expect(refresh.rows[0].n).toBe(0);
  },100,true,{}));
  it("native binding: token proof cannot authorize a different raw request and fresh retry remains possible",async()=>withHttps(async post=>{
    const c=await nativeCode(post),proof=nativeSigned("/v1/commercial/token",c.payloadToken);
    expect((await post("token",c.payloadToken,proof.headers,JSON.stringify({...c.payloadToken,state:"x".repeat(43)}))).status).toBe(401);
    const fresh=nativeSigned("/v1/commercial/token",c.payloadToken);
    expect((await post("token",c.payloadToken,fresh.headers,fresh.raw)).status).toBe(200);
  },100,true,{}));
  it("native binding: concurrent token replay has one winner and no proof reuse",async()=>withHttps(async post=>{
    const c=await nativeCode(post),proof=nativeSigned("/v1/commercial/token",c.payloadToken);
    const results=await Promise.all([post("token",c.payloadToken,proof.headers,proof.raw),post("token",c.payloadToken,proof.headers,proof.raw)]);
    expect(results.map(r=>r.status).sort()).toEqual([200,401]);
  },100,true,{}));
  it("native binding: durable challenge budget rejects concurrent overflow",async()=>withHttps(async post=>{
    const results=await Promise.all([post("native-request-challenges",nativeParams()),post("native-request-challenges",nativeParams())]);
    expect(results.map(r=>r.status).sort()).toEqual([200,429]);
  },100,true,{maximumChallengesPerMinute:1}));
  it.runIf(process.platform==="win32")("native binding: Electron signed request Chromium MFA confirmation callback token SSA and denied grants",async()=>withHttps(async(_post,_codec,server,_coordinator,signing)=>{
    const address=server.address();if(!address||typeof address==="string")throw Error("NATIVE_E2E_ADDRESS_MISSING");
    const counter=await owner.query("SELECT counter::int AS n FROM identity.webauthn_credential_material WHERE id=$1",[materialId]);
    const observed=await exerciseElectronCommercialBrowser({port:address.port,certificateFingerprint:new X509Certificate(tls!.cert).fingerprint256,
      email,password,credentialId:Buffer.from(publicCredentialId,"base64url").toString("base64"),privateKey:keys.privateKey.export({format:"der",type:"pkcs8"}).toString("base64"),counter:counter.rows[0].n,
      registration:{clientId:nativeClientId,redirectUri:exchangeRedirect,authorizationOrigin:origin},tenantId,companyId,branchId:uuidV7(),installationId,deviceId,
      ssaPublicTrust:{rootPublicPem:signing.rootTrustAnchor.export({format:"pem",type:"spki"}).toString(),artifact:signing.signedOperationalKey},
      nativeBinding:{deviceCredentialId,devicePrivatePem:deviceKeys.privateKey.export({format:"pem",type:"pkcs8"}).toString(),ca:tls!.cert.toString()}});
    expect(observed).toMatchObject({boundNative:true,destinationConfirmed:true,custodyCleared:true,wrongPasswordRejected:true,erased:true,dashboardClosed:true,grantsFabricated:false,
      nativeSsa:{invalid:"REJECTED",activated:"ACTIVATED",replay:"REJECTED",recovered:"ACTIVE",channelLossRejected:true,
        capabilities:{result_code:"AUTHORIZATION_SNAPSHOT_UNAVAILABLE"}}});
  },100,true,{}),90_000);
  it.runIf(process.platform==="win32").each([false,true])("central SAS: Electron HTTPS WebAuthn BUSINESS SSA central grants and authorized dashboard custody=%s",async serviceCustody=>{
    const s=await sasFixture();
    const sasRoot=generateKeyPairSync("ed25519");
    const sasTrust=signIsolatedAuthorizationTrust({profile:"DEC011_LAB_CANDIDATE_1",mode:"ISOLATED_VALIDATION",schema_version:1,
      purpose:"AUTHORIZATION_SNAPSHOT",environment:"isolated-validation",issuer:origin,authority_id:"LAB_SAS_ROOT",generation:1,complete:true,
      issued_at:s.material.validFrom,valid_from:s.material.validFrom,valid_until:s.material.validUntil,
      keys:[{key_id:s.material.keyId,purpose:"AUTHORIZATION_SNAPSHOT",public_key_pem:s.material.publicKey.export({format:"pem",type:"spki"}).toString(),
        status:"ACTIVE",version:1,valid_from:s.material.validFrom,valid_until:s.material.validUntil}]},sasRoot.privateKey);
    const deviceRoot=generateKeyPairSync("ed25519"),deviceOperational=generateKeyPairSync("ed25519"),at=new Date(Date.now()-1000).toISOString(),until=new Date(Date.now()+300000).toISOString();
    const operationalClaims={key_id:"NATIVE_DEVICE_TEST",key_purpose:"DEVICE_TRUST",public_key_pem:deviceOperational.publicKey.export({format:"pem",type:"spki"}).toString(),status:"ACTIVE",valid_from:at,version:1};
    const credentialClaims={credential_id:deviceCredentialId,key_id:operationalClaims.key_id,tenant_id:tenantId,company_id:companyId,installation_id:installationId,device_id:deviceId,
      device_public_key_pem:deviceKeys.publicKey.export({format:"pem",type:"spki"}).toString(),issued_at:at,not_before:at,expires_at:until,version:1};
    const activation={activation_id:uuidV7(),tenant_id:tenantId,company_id:companyId,installation_id:installationId,device_id:deviceId,
      activation_secret:randomBytes(48).toString("base64url"),status:"ISSUED",issued_at:at,expires_at:until,version:1};
    const custodyFixture={activation,rootPublicPem:deviceRoot.publicKey.export({format:"pem",type:"spki"}).toString(),
      operational:{claims:operationalClaims,signature:sign(null,Buffer.from(canonicalSessionTrustJson(operationalClaims)),deviceRoot.privateKey).toString("base64url")},
      result:{status:"ENROLLED",activation_id:activation.activation_id,credential_id:deviceCredentialId,
        credential:{claims:credentialClaims,signature:sign(null,Buffer.from(canonicalSessionTrustJson(credentialClaims)),deviceOperational.privateKey).toString("base64url")},
        enrolled_at:at,reason:null,version:1}};
    await withHttps(async(_post,_codec,server,_coordinator,signing)=>{
      const address=server.address();if(!address||typeof address==="string")throw Error("SAS_E2E_ADDRESS_REQUIRED");
      const counter=await owner.query("SELECT counter::int AS n FROM identity.webauthn_credential_material WHERE id=$1",[materialId]);
      const observed=await exerciseElectronCommercialBrowser({port:address.port,certificateFingerprint:new X509Certificate(tls!.cert).fingerprint256,
        email,password,credentialId:Buffer.from(publicCredentialId,"base64url").toString("base64"),privateKey:keys.privateKey.export({format:"der",type:"pkcs8"}).toString("base64"),counter:counter.rows[0].n,
        registration:{clientId:nativeClientId,redirectUri:exchangeRedirect,authorizationOrigin:origin},tenantId,companyId,branchId:s.branchId,installationId,deviceId,
        ssaPublicTrust:{rootPublicPem:signing.rootTrustAnchor.export({format:"pem",type:"spki"}).toString(),artifact:signing.signedOperationalKey},
        nativeBinding:{deviceCredentialId,devicePrivatePem:deviceKeys.privateKey.export({format:"pem",type:"pkcs8"}).toString(),ca:tls!.cert.toString()},
        ...(serviceCustody?{serviceCustody:custodyFixture}:{}),
        sasTrustCandidate:{issuer:origin,authorityId:"LAB_SAS_ROOT",minimumGeneration:1,
          rootPublicPem:sasRoot.publicKey.export({format:"pem",type:"spki"}).toString(),url:`https://${rpId}:${address.port}/v1/isolated/authorization-trust`,ca:tls!.cert.toString()},
        beforeAuthorizationRevocation:async()=>{await owner.query(`UPDATE "authorization".user_role_assignments SET status='REVOKED',revoked_at=clock_timestamp(),version=version+1 WHERE id=$1`,[s.assignmentId]);}});
      if(serviceCustody)expect(observed).toMatchObject({serviceCustody:true,devicePrivateKeyInMain:false,dashboardAuthorized:true,
        observed:{recovery:{result_code:"ACTIVE"},capabilities:{result:{permissions:["AUDIT_EVENT_READ"]}},forbidden:{result_code:"UNAUTHORIZED"}}});
      else expect(observed).toMatchObject({centralSas:true,dashboardAuthorized:true,revocationDenied:true,dashboardClosed:true,nativeSsa:{activated:"ACTIVATED",recovered:"ACTIVE",
        capabilities:{status:"SUCCEEDED",result_code:"AVAILABLE",result:{permissions:["AUDIT_EVENT_READ"]}},forbidden:{status:"REJECTED",result_code:"UNAUTHORIZED"}}});
    },100,true,{},codec=>sasIssuer(codec,s),sasTrust);
  },90_000);
  it.runIf(process.platform==="win32")("business SSA composition: Electron main activates Central assertion but no grants cannot open dashboard",async()=>withHttps(async(post,codec,server,coordinator)=>{
    const login=await httpLogin(post),material=ssaMaterial();
    const code=await post("authorize",{clientId:"desktop",redirectUri:exchangeRedirect,codeChallenge:derivePkceS256Challenge(exchangeVerifier),state:exchangeState,deviceProof:request(login.sessionId)},login.headers);
    expect(code.status).toBe(200);
    const tokens=await post("token",{grant_type:"authorization_code",code:code.body.code,code_verifier:exchangeVerifier,state:exchangeState,client_id:"desktop",redirect_uri:exchangeRedirect});
    expect(tokens.status).toBe(200);
    const assertion=await coordinator.issueSessionAssertion(tokens.body.accessToken as string,request(login.sessionId),codec,material);
    if(!assertion)throw Error("CENTRAL_SSA_COMPOSITION_MISSING");
    const address=server.address();if(!address||typeof address==="string")throw Error("SSA_HTTPS_FIXTURE_MISSING");
    const observed=await exerciseElectronCommercialBrowser({port:address.port,certificateFingerprint:new X509Certificate(tls!.cert).fingerprint256,
      email,password,credentialId:Buffer.from(publicCredentialId,"base64url").toString("base64"),privateKey:"",counter:0,
      registration:{clientId:"desktop",redirectUri:exchangeRedirect,authorizationOrigin:origin},tenantId,companyId,branchId:uuidV7(),installationId,deviceId,
      issuedAssertion:assertion,ssaPublicTrust:{rootPublicPem:material.rootTrustAnchor.export({format:"pem",type:"spki"}).toString(),artifact:material.signedOperationalKey}});
    expect(observed).toMatchObject({dashboardClosed:true,grantsFabricated:false,nativeSsa:{invalid:"REJECTED",channelLossRejected:true,activated:"ACTIVATED",replay:"REJECTED",recovered:"ACTIVE",
      capabilities:{status:"REJECTED",result_code:"AUTHORIZATION_SNAPSHOT_UNAVAILABLE"}}});
    expect((await post("browser/logout",{},login.headers)).status).toBe(200);
  }),90_000);
  it("access-to-sequence: HTTPS password MFA code exchange then verified access and fresh DeviceProof reserve 011",async()=>withHttps(async(post,codec,_server,coordinator)=>{
    const login=await httpLogin(post);
    const authorized=await post("authorize",{clientId:"desktop",redirectUri:exchangeRedirect,
      codeChallenge:derivePkceS256Challenge(exchangeVerifier),state:exchangeState,deviceProof:request(login.sessionId)},login.headers);
    expect(authorized.status).toBe(200);
    const credentials=await post("token",{grant_type:"authorization_code",code:authorized.body.code,code_verifier:exchangeVerifier,
      state:exchangeState,client_id:"desktop",redirect_uri:exchangeRedirect});
    expect(credentials.status).toBe(200);
    const prepared=await coordinator.prepareSessionAssertion(credentials.body.accessToken as string,request(login.sessionId),codec);
    expect(prepared?.reservation).toMatchObject({sequence:1,eligibleScope:{sessionId:login.sessionId,userId,tenantId,deviceId,installationId}});
    expect(prepared).not.toHaveProperty("claims");expect(prepared).not.toHaveProperty("signature");
    expect(await counters()).toEqual({nonces:2,sequence:1});
    expect((await post("browser/logout",{},login.headers)).status).toBe(200);
    expect(await coordinator.prepareSessionAssertion(credentials.body.accessToken as string,request(login.sessionId),codec)).toBeNull();
  }));
  it("HTTPS commercial: actual password MFA BUSINESS cookie DeviceProof PKCE signed JWT refresh and logout",async()=>withHttps(async(post,codec)=>{
    const login=await httpLogin(post);
    const authorized=await post("authorize",{clientId:"desktop",redirectUri:exchangeRedirect,
      codeChallenge:derivePkceS256Challenge(exchangeVerifier),state:exchangeState,deviceProof:request(login.sessionId)},login.headers);
    expect(authorized.status).toBe(200);expect(authorized.headers.location).toBeUndefined();
    const redeem={grant_type:"authorization_code",code:authorized.body.code,code_verifier:exchangeVerifier,state:exchangeState,client_id:"desktop",redirect_uri:exchangeRedirect};
    const credentials=await post("token",redeem);expect(credentials.status).toBe(200);
    expect(credentials.body.accessToken).toEqual(expect.any(String));expect(credentials.body.refreshToken).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(await codec.verify(credentials.body.accessToken as string)).not.toBeNull();
    const forged=(credentials.body.accessToken as string).split(".");
    const claims=JSON.parse(Buffer.from(forged[1]!,"base64url").toString()) as Record<string,unknown>;
    forged[1]=Buffer.from(JSON.stringify({...claims,did:uuidV7()})).toString("base64url");
    expect(await codec.verify(forged.join("."))).toBeNull();
    const rotation=new IsolatedBusinessRefreshRotation(runtime);
    const current={sessionId:login.sessionId,userId,tenantId,tenantMembershipId:membershipId};
    const next=await rotation.rotate(current,credentials.body.refreshToken as string,uuidV7());expect(next?.status).toBe("ROTATED");
    expect((await rotation.rotate(current,credentials.body.refreshToken as string,uuidV7()))?.status).toBe("REUSE_DETECTED");
    if(next?.status!=="ROTATED")throw Error("HTTPS_REFRESH_ROTATION_MISSING");
    expect(await rotation.rotate(current,next.refreshToken,uuidV7())).toBeNull();
    expect((await post("token",redeem)).status).toBe(401);
    expect((await post("login",login.complete,originHeaders)).status).toBe(401);
    expect((await post("browser/logout",{},login.headers)).status).toBe(200);
    expect((await post("browser/session",{},login.headers)).status).toBe(401);
    expect(await codec.verify(credentials.body.accessToken as string)).toBeNull();
    const refresh=await owner.query("SELECT revoked_at IS NOT NULL AS closed FROM identity.session_refresh_tokens WHERE session_id=$1",[login.sessionId]);expect(refresh.rows[0].closed).toBe(true);
  }));
  it("HTTPS commercial: rejects wrong password altered assertion and suspended membership without cookie",async()=>withHttps(async post=>{
    expect((await post("login",{phase:"begin",email,password:"wrong-password",factorId},originHeaders)).status).toBe(401);
    const start=await post("login",{phase:"begin",email,password,factorId},originHeaders);
    const assertion=await assertionFor(start.body.challenge as string);assertion.response.signature=randomBytes(72).toString("base64url");
    const invalid=await post("login",{phase:"complete",email,password,challenge:start.body.challenge,response:assertion,tenantId,membershipId},originHeaders);
    expect(invalid.status).toBe(401);expect(invalid.headers["set-cookie"]).toBeUndefined();
    const wrongTenant=await post("login",{phase:"begin",email,password,factorId},originHeaders);
    expect((await post("login",{phase:"complete",email,password,challenge:wrongTenant.body.challenge,
      response:await assertionFor(wrongTenant.body.challenge as string),tenantId:uuidV7(),membershipId},originHeaders)).status).toBe(403);
    const fresh=await post("login",{phase:"begin",email,password,factorId},originHeaders);
    await owner.query("UPDATE tenancy.tenant_memberships SET status='SUSPENDED',suspended_at=clock_timestamp() WHERE id=$1",[membershipId]);
    const suspended=await post("login",{phase:"complete",email,password,challenge:fresh.body.challenge,response:await assertionFor(fresh.body.challenge as string),tenantId,membershipId},originHeaders);
    expect(suspended.status).toBe(403);expect(suspended.headers["set-cookie"]).toBeUndefined();
  }));
  it("HTTPS commercial: rejects forged cookies CSRF cross-origin duplicated headers proxies and extra parameters",async()=>withHttps(async post=>{
    const {headers}=await httpLogin(post);
    for(const altered of [{...headers,cookie:"__Host-camacho_business="+"f".repeat(43)},
      {...headers,cookie:headers.cookie+"; "+headers.cookie},{...headers,"x-csrf-token":"f".repeat(43)}])expect((await post("browser/session",{},altered)).status).toBe(401);
    for(const altered of [{...headers,origin:"https://evil.example.test"},{...headers,"sec-fetch-site":"cross-site"}])expect((await post("browser/session",{},altered)).status).toBe(403);
    for(const altered of [{...headers,"x-forwarded-host":"business.example.test"},{...headers,origin:[origin,origin]}])expect((await post("browser/session",{},altered)).status).toBe(400);
    expect((await post("browser/session?tenantId="+tenantId,{},headers)).status).toBe(400);
    expect((await post("browser/session",{userId},headers)).status).toBe(400);
    expect((await post("browser/session",{},headers,'{"userId":1,"userId":2}')).status).toBe(400);
    expect((await post("browser/session",{},headers,'{"userId":1,"\\u0075serId":2}')).status).toBe(400);
    expect((await post("browser/session",{},headers)).status).toBe(200);
  }));
  it("HTTPS commercial: bounds bodies JSON content-type and remote-address abuse budget",async()=>withHttps(async post=>{
    expect((await post("login",{extra:"x".repeat(33*1024)},originHeaders)).status).toBe(413);
    expect((await post("login",{}, {...originHeaders,"content-type":"text/plain"})).status).toBe(415);
    expect((await post("login",{},originHeaders,"{")).status).toBe(400);
    expect((await post("login",{},originHeaders,Buffer.from([0xc3,0x28]))).status).toBe(400);
    expect((await post("login",{},originHeaders)).status).toBe(429);
    const audit=await owner.query("SELECT count(*)::int AS n FROM identity.security_events WHERE event_code=$1",[PlatformSecurityEventCode.ABUSE_RATE_LIMITED]);expect(audit.rows[0].n).toBeGreaterThan(0);
  },4));
  it("HTTPS commercial: rejects invalid replayed device proof malicious redirect and PKCE mismatch",async()=>withHttps(async post=>{
    const {headers,sessionId}=await httpLogin(post);
    const proof=request(sessionId),payload={clientId:"desktop",redirectUri:exchangeRedirect,codeChallenge:derivePkceS256Challenge(exchangeVerifier),state:exchangeState,deviceProof:proof};
    expect((await post("authorize",{...payload,redirectUri:"https://evil.example.test/callback"},headers)).status).toBe(403);
    expect((await post("authorize",{...payload,deviceProof:{...proof,authorization:"DeviceProof invalid"}},headers)).status).toBe(401);
    const code=await post("authorize",payload,headers);expect(code.status).toBe(200);
    expect((await post("authorize",payload,headers)).status).toBe(401);
    const redeem={grant_type:"authorization_code",code:code.body.code,code_verifier:"x".repeat(64),state:exchangeState,client_id:"desktop",redirect_uri:exchangeRedirect};
    expect((await post("token",redeem)).status).toBe(401);
    expect((await post("token",{...redeem,code_verifier:exchangeVerifier})).status).toBe(401);
  }));
  it("HTTPS commercial: concurrent cookie rotation has one winner and rejects old cookie across requests",async()=>withHttps(async post=>{
    const {headers}=await httpLogin(post);
    const results=await Promise.all([post("browser/rotate",{},headers),post("browser/rotate",{},headers)]);
    expect(results.map(r=>r.status).sort()).toEqual([200,401]);
    expect((await post("browser/session",{},headers)).status).toBe(401);
    const winner=results.find(r=>r.status===200)!;
    expect((await post("browser/session",{},{...headers,cookie:winner.headers["set-cookie"]![0]!.split(";")[0]!,"x-csrf-token":winner.body.csrfToken as string})).status).toBe(200);
  }));
  it("HTTPS commercial: audit failure rolls atomic code redemption and credentials back before retry",async()=>withHttps(async post=>{
    const {headers,sessionId}=await httpLogin(post);
    const authorized=await post("authorize",{clientId:"desktop",redirectUri:exchangeRedirect,codeChallenge:derivePkceS256Challenge(exchangeVerifier),state:exchangeState,deviceProof:request(sessionId)},headers);
    expect(authorized.status).toBe(200);
    const redeem={grant_type:"authorization_code",code:authorized.body.code,code_verifier:exchangeVerifier,state:exchangeState,client_id:"desktop",redirect_uri:exchangeRedirect};
    await owner.query(`CREATE FUNCTION identity.test_https_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_code='PLATFORM_ACCESS_ISSUED' THEN RAISE EXCEPTION 'https audit unavailable'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER test_https_audit_failure BEFORE INSERT ON identity.security_events FOR EACH ROW EXECUTE FUNCTION identity.test_https_audit_failure()`);
    try{
      const denied=await post("token",redeem);expect(denied.status).toBe(503);expect(JSON.stringify(denied.body)).not.toContain("audit unavailable");
      expect((await owner.query("SELECT count(*)::int AS n FROM identity.session_refresh_tokens WHERE session_id=$1",[sessionId])).rows[0].n).toBe(0);
      expect((await owner.query("SELECT consumed_at FROM identity.native_authorization_code_validation WHERE code_hash=$1",[sha(authorized.body.code as string).toString("hex")])).rows[0].consumed_at).toBeNull();
    }finally{await owner.query("DROP TRIGGER test_https_audit_failure ON identity.security_events; DROP FUNCTION identity.test_https_audit_failure()");}
    const races=await Promise.all([post("token",redeem),post("token",redeem)]);expect(races.map(r=>r.status).sort()).toEqual([200,401]);
  }));
  it("HTTPS commercial: logout audit failure rolls revocation back and permits a verified retry",async()=>withHttps(async post=>{
    const {headers,sessionId}=await httpLogin(post);
    await owner.query(`CREATE FUNCTION identity.test_https_logout_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_code='PLATFORM_SESSION_REVOKED' THEN RAISE EXCEPTION 'logout audit unavailable'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER test_https_logout_failure BEFORE INSERT ON identity.security_events FOR EACH ROW EXECUTE FUNCTION identity.test_https_logout_failure()`);
    try{
      expect((await post("browser/logout",{},headers)).status).toBe(503);
      expect((await post("browser/session",{},headers)).status).toBe(200);
      expect((await owner.query("SELECT revoked_at FROM identity.sessions WHERE id=$1",[sessionId])).rows[0].revoked_at).toBeNull();
    }finally{await owner.query("DROP TRIGGER test_https_logout_failure ON identity.security_events; DROP FUNCTION identity.test_https_logout_failure()");}
    expect((await post("browser/logout",{},headers)).status).toBe(200);
  }));
  it("HTTPS commercial: Android registration uses its HTTPS App Link and cannot exchange as Electron",async()=>withHttps(async post=>{
    const {headers,sessionId}=await httpLogin(post);
    const authorized=await post("authorize",{clientId:androidRegistration.clientId,redirectUri:androidRegistration.redirectUri,
      codeChallenge:derivePkceS256Challenge(exchangeVerifier),state:exchangeState,deviceProof:request(sessionId)},headers);
    expect(authorized.status).toBe(200);expect(authorized.body.redirectUri).toBe(androidRegistration.redirectUri);
    const redeem={grant_type:"authorization_code",code:authorized.body.code,code_verifier:exchangeVerifier,state:exchangeState,client_id:"desktop",redirect_uri:exchangeRedirect};
    expect((await post("token",redeem)).status).toBe(401);
    const fresh=await post("authorize",{clientId:androidRegistration.clientId,redirectUri:androidRegistration.redirectUri,
      codeChallenge:derivePkceS256Challenge(exchangeVerifier),state:exchangeState,deviceProof:request(sessionId)},headers);
    const exchanged=await post("token",{...redeem,code:fresh.body.code,client_id:androidRegistration.clientId,redirect_uri:androidRegistration.redirectUri});
    expect(exchanged.status).toBe(200);
  }));
  it("HTTPS commercial: lost CSRF state requires fresh password and MFA instead of trusting an ambient cookie",async()=>withHttps(async post=>{
    const original=await httpLogin(post);
    const ambient={...originHeaders,cookie:original.headers.cookie};
    expect((await post("browser/session",{},ambient)).status).toBe(401);
    expect((await post("login",{phase:"begin",email,password:"wrong",factorId},ambient)).status).toBe(401);
    const begin=await post("login",{phase:"begin",email,password,factorId},ambient);
    expect(begin.status).toBe(200);expect(begin.headers["set-cookie"]![0]).toContain("Max-Age=0");
    const completed=await post("login",{phase:"complete",email,password,challenge:begin.body.challenge,
      response:await assertionFor(begin.body.challenge as string),tenantId,membershipId},ambient);
    expect(completed.status).toBe(200);
    const cookie=completed.headers["set-cookie"]![0]!.split(";")[0]!;expect(cookie).not.toBe(original.headers.cookie);
    expect((await post("browser/session",{},{...originHeaders,cookie,"x-csrf-token":completed.body.csrfToken as string})).status).toBe(200);
  }));
  it("canonical browser: migration rollback refuses to erase authentication history",async()=>{
    await canonicalHandoff();
    const down=await readFile(new URL("../../../tools/target-migrations/sql/postgres/013_business_browser_sessions.down.sql",import.meta.url),"utf8");
    const client=await owner.connect();try{
      await client.query("BEGIN");await client.query("SET LOCAL ROLE pos_schema_owner");
      await expect(client.query(down)).rejects.toThrow("013 rollback refused");
    }finally{await client.query("ROLLBACK");client.release();}
    expect((await runtime.query("SELECT to_regclass('identity.browser_sessions') AS name")).rows[0].name).toBe("identity.browser_sessions");
  });

});
