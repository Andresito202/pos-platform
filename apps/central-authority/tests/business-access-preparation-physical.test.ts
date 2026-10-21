import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPostgresPool, type BusinessSessionValidationPolicy } from "@pos-platform/database-postgres";
import { uuidV7 } from "@pos-platform/contracts";
import { createPlatformPasswordVerifier } from "../src/platform-password-verifier.js";
import { BusinessInitialMfaFlow, type BusinessInitialMfaReceipt } from "../src/business-initial-mfa-flow.js";
import { BusinessSessionAuthority } from "../src/business-session-authority.js";
import { BusinessAccessPreparation, type BusinessAccessPreparationReference } from "../src/business-access-preparation.js";
import { PostgresBusinessSessionAccessRepository, BUSINESS_SSA_DEVICE_PROOF_PATH, type TrustedBusinessSessionBinding } from "@pos-platform/database-postgres";
import { createDeviceRequestAuthorization } from "@pos-platform/device-trust";

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
      for (const name of ["001_central_foundation.up.sql","004_device_trust.up.sql","009_webauthn_challenges.up.sql","010_webauthn_credential_material.up.sql","011_session_assertion_sequences.up.sql","012_device_request_proof_replays.up.sql"]) {
        await ddl.query(await readFile(new URL(name,root),"utf8"));
      }
    } finally { try { await ddl.query("RESET ROLE"); } finally { ddl.release(); } }
    url.username="pos_platform_app";
    runtime=createPostgresPool(url.toString(),5,"business-access-central-runtime");
    verifier=await createPlatformPasswordVerifier(password,"owasp-19m-t2-p1");
    rejectionVerifier=await createPlatformPasswordVerifier(randomBytes(24).toString("hex"),"owasp-19m-t2-p1");
  },60_000);

  async function authenticate(): Promise<BusinessInitialMfaReceipt> {
    const challenge=await flow.begin({email,password,factorId,correlationId:uuidV7()});
    if (!challenge) throw new Error("BUSINESS_SESSION_FIXTURE_CHALLENGE_MISSING");
    const data=Buffer.from(JSON.stringify({type:"webauthn.get",challenge:challenge.challenge,origin,crossOrigin:false}));
    const auth=Buffer.alloc(37); sha(rpId).copy(auth); auth[32]=0x05;
    const counter=await owner.query("SELECT counter::int AS counter FROM identity.webauthn_credential_material WHERE id=$1",[materialId]);
    auth.writeUInt32BE(counter.rows[0].counter+1,33);
    const result=await flow.complete({email,password,challenge:challenge.challenge,response:{
      id:publicCredentialId,rawId:publicCredentialId,type:"public-key",clientExtensionResults:{},response:{
        clientDataJSON:data.toString("base64url"),authenticatorData:auth.toString("base64url"),
        signature:sign("sha256",Buffer.concat([auth,sha(data)]),keys.privateKey).toString("base64url"),
      },
    }});
    if (!result) throw new Error("BUSINESS_SESSION_FIXTURE_MFA_MISSING");
    return result;
  }

  beforeEach(async () => {
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
});
