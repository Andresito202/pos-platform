import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPostgresPool, type BusinessSessionValidationPolicy } from "@pos-platform/database-postgres";
import { uuidV7 } from "@pos-platform/contracts";
import { createPlatformPasswordVerifier } from "../src/platform-password-verifier.js";
import { BusinessInitialMfaFlow, type BusinessInitialMfaReceipt } from "../src/business-initial-mfa-flow.js";
import { BusinessSessionAuthority } from "../src/business-session-authority.js";

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

describe.runIf(Boolean(serverUrl))("BUSINESS session authority - physical isolated PostgreSQL", () => {
  let admin: DatabasePool, owner: DatabasePool, runtime: DatabasePool;
  let created = false, verifier: string, rejectionVerifier: string;
  let userId: string, credentialId: string, factorId: string, tenantId: string, membershipId: string;
  let email: string, publicCredentialId: string, materialId: string;
  let keys: ReturnType<typeof generateKeyPairSync>, flow: BusinessInitialMfaFlow, authority: BusinessSessionAuthority;
  let receipt: BusinessInitialMfaReceipt;

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
      for (const name of ["001_central_foundation.up.sql","009_webauthn_challenges.up.sql","010_webauthn_credential_material.up.sql"]) {
        await ddl.query(await readFile(new URL(name,root),"utf8"));
      }
    } finally { try { await ddl.query("RESET ROLE"); } finally { ddl.release(); } }
    url.username="pos_platform_app";
    runtime=createPostgresPool(url.toString(),5,"business-session-central-runtime");
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
  });

  afterAll(async () => {
    await runtime?.end(); await owner?.end();
    if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
    await admin?.end();
  },30_000);

  const create = (proof: unknown=receipt, service=authority, selection={tenantId,membershipId}) => service.create({mfaReceipt:proof,selection});
  async function counts() {
    const result=await owner.query(`SELECT
      (SELECT count(*)::int FROM identity.sessions WHERE user_id=$1) AS sessions,
      (SELECT count(*)::int FROM identity.security_events WHERE user_id=$1 AND event_code='PLATFORM_SESSION_ISSUED') AS events`,[userId]);
    return result.rows[0];
  }
  const empty=()=>expect(counts()).resolves.toEqual({sessions:0,events:0});

  it("persists BUSINESS from genuine password + WebAuthn, current membership and audited transaction", async () => {
    const role=await runtime.query("SELECT current_user AS role,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user");
    expect(role.rows[0]).toEqual({role:"pos_platform_app",rolsuper:false,rolbypassrls:false});
    const session=await create(); expect(session).not.toBeNull();
    expect(session).toMatchObject({scope:"BUSINESS",userId,tenantId,tenantMembershipId:membershipId,deviceId:null,accessProof:null});
    expect(Date.parse(session!.expiresAt)-Date.parse(session!.authenticatedAt)).toBe(policy.sessionLifetimeMs);
    const row=await owner.query("SELECT device_id,mfa_status,authenticated_at,last_reauthenticated_at,offline_valid_until,authorization_policy_version_id FROM identity.sessions WHERE id=$1",[session!.sessionId]);
    expect(row.rows[0]).toMatchObject({device_id:null,mfa_status:"SATISFIED",offline_valid_until:null,authorization_policy_version_id:null});
    expect(row.rows[0].authenticated_at).toEqual(row.rows[0].last_reauthenticated_at);
    expect(await counts()).toEqual({sessions:1,events:1});
    expect(flow.takeForBusinessSession(receipt)).toBeNull();
    const event=await owner.query("SELECT session_id::text,tenant_id::text,result,reason_code FROM identity.security_events WHERE user_id=$1 AND event_code='PLATFORM_SESSION_ISSUED'",[userId]);
    expect(event.rows[0]).toEqual({session_id:session!.sessionId,tenant_id:tenantId,result:"SUCCEEDED",reason_code:"BUSINESS_INITIAL_MFA"});
    const refresh=await owner.query("SELECT count(*)::int AS count FROM identity.session_refresh_tokens WHERE session_id=$1",[session!.sessionId]);
    expect(refresh.rows[0].count).toBe(0);
  });

  it("rejects a second consumption of the same MFA evidence",async()=>{
    expect(await create()).not.toBeNull(); expect(await create()).toBeNull();
    expect(await counts()).toEqual({sessions:1,events:1});
  });
  it("rejects serialized objects, flags, UUIDs, copied receipts and evidence metadata",async()=>{
    for (const fake of [true,userId,JSON.stringify(receipt),{...receipt},{purpose:"BUSINESS_INITIAL_MFA",userId},null]) {
      expect(await create(fake)).toBeNull();
    }
    await empty(); expect(await create()).not.toBeNull();
  });
  it("rejects inactive users and burns the receipt even after identity is restored",async()=>{
    await owner.query("UPDATE identity.users SET status='INACTIVE' WHERE id=$1",[userId]);
    expect(await create()).toBeNull(); await empty();
    await owner.query("UPDATE identity.users SET status='ACTIVE' WHERE id=$1",[userId]);
    expect(await create()).toBeNull();
  });
  it("rejects a rotated credential version",async()=>{
    await owner.query("UPDATE identity.user_credentials SET version=version+1,rotated_at=clock_timestamp() WHERE id=$1",[credentialId]);
    expect(await create()).toBeNull(); await empty();
  });
  it("rejects a retired password replaced by another active credential",async()=>{
    await owner.query("UPDATE identity.user_credentials SET status='RETIRED',rotated_at=clock_timestamp(),version=version+1 WHERE id=$1",[credentialId]);
    await owner.query(`INSERT INTO identity.user_credentials(id,user_id,credential_type,verifier,status,created_at)
      VALUES ($1,$2,'PASSWORD',$3,'ACTIVE',clock_timestamp())`,[uuidV7(),userId,verifier]);
    expect(await create()).toBeNull(); await empty();
  });
  it("rejects a password locked after MFA",async()=>{
    await owner.query("UPDATE identity.user_credentials SET locked_until=clock_timestamp()+interval '5 minutes' WHERE id=$1",[credentialId]);
    expect(await create()).toBeNull(); await empty();
  });
  it("rejects suspended memberships",async()=>{
    await owner.query("UPDATE tenancy.tenant_memberships SET status='SUSPENDED',suspended_at=clock_timestamp() WHERE id=$1",[membershipId]);
    expect(await create()).toBeNull(); await empty();
  });
  it("rejects an incorrect tenant selection",async()=>{
    expect(await create(receipt,authority,{tenantId:uuidV7(),membershipId})).toBeNull(); await empty();
  });
  it("rejects a membership belonging to another user in the same tenant",async()=>{
    const another=uuidV7(),otherMembership=uuidV7();
    await owner.query(`INSERT INTO identity.users(id,email,email_normalized,full_name,status,created_at,updated_at)
      VALUES ($1,$2,$2,'Other user','ACTIVE',clock_timestamp(),clock_timestamp())`,[another,`other-${another}@example.test`]);
    await owner.query(`INSERT INTO tenancy.tenant_memberships(id,tenant_id,user_id,membership_type,status,created_by_actor_type,created_at,activated_at)
      VALUES ($1,$2,$3,'MEMBER','ACTIVE','SYSTEM',clock_timestamp(),clock_timestamp())`,[otherMembership,tenantId,another]);
    expect(await create(receipt,authority,{tenantId,membershipId:otherMembership})).toBeNull(); await empty();
  });
  it("rejects a suspended tenant",async()=>{
    await owner.query("UPDATE tenancy.tenants SET status='SUSPENDED' WHERE id=$1",[tenantId]);
    expect(await create()).toBeNull(); await empty();
  });
  it("rejects a revoked factor after MFA was verified",async()=>{
    await owner.query("UPDATE identity.mfa_factors SET status='REVOKED',revoked_at=clock_timestamp() WHERE id=$1",[factorId]);
    expect(await create()).toBeNull(); await empty();
  });
  it("rejects expired MFA using the PostgreSQL clock",async()=>{
    const service=new BusinessSessionAuthority(runtime,flow,{...policy,maximumMfaAgeMs:1});
    await owner.query("SELECT pg_sleep(0.03)");
    expect(await create(receipt,service)).toBeNull(); await empty();
  });
  it("rejects expired reauthentication independently of the MFA age limit",async()=>{
    const service=new BusinessSessionAuthority(runtime,flow,{...policy,maximumReauthenticationAgeMs:1});
    await owner.query("SELECT pg_sleep(0.03)");
    expect(await create(receipt,service)).toBeNull(); await empty();
  });
  it("allows exactly one concurrent creation through two authorities sharing the flow",async()=>{
    const other=new BusinessSessionAuthority(runtime,flow,policy);
    const results=await Promise.all([create(),create(receipt,other)]);
    expect(results.filter(Boolean)).toHaveLength(1); expect(await counts()).toEqual({sessions:1,events:1});
  });
  async function waitUntilBlocked() {
    for (let attempt=0;attempt<100;attempt++) {
      const waiting=await owner.query("SELECT 1 FROM pg_stat_activity WHERE application_name='business-session-central-runtime' AND wait_event_type='Lock'");
      if (waiting.rows.length) return;
      await owner.query("SELECT pg_sleep(0.01)");
    }
    throw new Error("BUSINESS_SESSION_FIXTURE_EXPECTED_LOCK_WAIT");
  }
  it("revalidates membership suspension committed while creation waits for its row lock",async()=>{
    const blocker=await owner.connect(); let pending: ReturnType<typeof create> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("UPDATE tenancy.tenant_memberships SET status='SUSPENDED',suspended_at=clock_timestamp() WHERE id=$1",[membershipId]);
      pending=create(); await waitUntilBlocked();
      await blocker.query("COMMIT"); expect(await pending).toBeNull();
    } finally { await blocker.query("ROLLBACK"); blocker.release(); await pending; }
    await empty();
  });
  it("revalidates credential rotation committed while creation waits for its row lock",async()=>{
    const blocker=await owner.connect(); let pending: ReturnType<typeof create> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("UPDATE identity.user_credentials SET version=version+1,rotated_at=clock_timestamp() WHERE id=$1",[credentialId]);
      pending=create(); await waitUntilBlocked();
      await blocker.query("COMMIT"); expect(await pending).toBeNull();
    } finally { await blocker.query("ROLLBACK"); blocker.release(); await pending; }
    await empty();
  });
  it("checks MFA freshness after waiting for challenge locks",async()=>{
    const blocker=await owner.connect(); let pending: ReturnType<typeof create> | undefined;
    const service=new BusinessSessionAuthority(runtime,flow,{...policy,maximumMfaAgeMs:100});
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM identity.webauthn_challenges WHERE user_id=$1 FOR UPDATE",[userId]);
      pending=create(receipt,service); await waitUntilBlocked();
      await blocker.query("SELECT pg_sleep(0.15)");
      await blocker.query("COMMIT"); expect(await pending).toBeNull();
    } finally { await blocker.query("ROLLBACK"); blocker.release(); await pending; }
    await empty();
  });
  it("rolls back session creation on audit failure; old receipt cannot be retried",async()=>{
    await owner.query("REVOKE INSERT ON identity.security_events FROM pos_platform_app");
    try { await expect(create()).rejects.toMatchObject({code:"42501"}); }
    finally { await owner.query("GRANT INSERT ON identity.security_events TO pos_platform_app"); }
    await empty(); expect(await create()).toBeNull();
    receipt=await authenticate(); expect(await create()).not.toBeNull();
  });
  it("rolls back if the session INSERT returns no row",async()=>{
    await owner.query(`CREATE FUNCTION identity.session_test_drop_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
      CREATE TRIGGER session_test_drop_insert BEFORE INSERT ON identity.sessions FOR EACH ROW EXECUTE FUNCTION identity.session_test_drop_insert()`);
    try { expect(await create()).toBeNull(); }
    finally { await owner.query("DROP TRIGGER session_test_drop_insert ON identity.sessions; DROP FUNCTION identity.session_test_drop_insert()"); }
    await empty(); expect(await create()).toBeNull();
  });
  it("rolls back both session and an appended audit event if MFA ages during auditing",async()=>{
    const service=new BusinessSessionAuthority(runtime,flow,{...policy,maximumMfaAgeMs:300});
    // Sequence state survives rollback, proving the real INSERT trigger ran.
    // All instrumentation exists only in this disposable database.
    await owner.query(`CREATE SEQUENCE identity.session_test_audit_calls;
      GRANT USAGE ON SEQUENCE identity.session_test_audit_calls TO pos_platform_app;
      CREATE FUNCTION identity.session_test_slow_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN PERFORM nextval('identity.session_test_audit_calls'); PERFORM pg_sleep(0.4); RETURN NEW; END $$;
      CREATE TRIGGER session_test_slow_audit BEFORE INSERT ON identity.security_events
      FOR EACH ROW EXECUTE FUNCTION identity.session_test_slow_audit()`);
    try {
      expect(await create(receipt,service)).toBeNull();
      const called=await owner.query("SELECT is_called FROM identity.session_test_audit_calls");
      expect(called.rows[0].is_called).toBe(true);
    } finally {
      await owner.query("DROP TRIGGER session_test_slow_audit ON identity.security_events; DROP FUNCTION identity.session_test_slow_audit(); DROP SEQUENCE identity.session_test_audit_calls");
    }
    await empty(); expect(await create()).toBeNull();
  });
  it("rejects absent or invalid policies before consuming MFA",async()=>{
    for (const field of ["mode","version","sessionLifetimeMs","maximumMfaAgeMs","maximumReauthenticationAgeMs","accessProof","abuse"]) {
      const missing={...policy,[field]:undefined};
      expect(()=>new BusinessSessionAuthority(runtime,flow,missing as never)).toThrow("BUSINESS_SESSION_EXPLICIT_POLICIES_REQUIRED");
    }
    expect(()=>new BusinessSessionAuthority(runtime,flow,undefined as never)).toThrow("BUSINESS_SESSION_EXPLICIT_POLICIES_REQUIRED");
    expect(()=>new BusinessSessionAuthority(runtime,flow,{...policy,sessionLifetimeMs:0})).toThrow();
    expect(()=>new BusinessSessionAuthority(runtime,flow,{...policy,maximumMfaAgeMs:60_001})).toThrow();
    await empty(); expect(await create()).not.toBeNull();
  });
  it("blocks production even when numeric policies and fabricated approval flags are supplied",async()=>{
    expect(()=>new BusinessSessionAuthority(runtime,flow,{...policy,mode:"PRODUCTION",approved:true} as never))
      .toThrow("BUSINESS_SESSION_PRODUCTION_BLOCKED_PENDING_D3");
    await empty(); expect(flow.takeForBusinessSession(receipt)).not.toBeNull();
  });
  it("refuses persistent databases despite an isolated-validation config label",async()=>{
    const persistent=new BusinessSessionAuthority(admin,flow,policy);
    await expect(create(receipt,persistent)).rejects.toThrow("BUSINESS_SESSION_REQUIRES_ISOLATED_VALIDATION_DATABASE");
    await empty(); expect(await create()).toBeNull();
  });
  it("rejects an MFA receipt from another flow instance",async()=>{
    const otherFlow=new BusinessInitialMfaFlow(runtime,{rpId,origin,rejectionVerifier,challengeLifetimeMs:60_000});
    expect(await create(receipt,new BusinessSessionAuthority(runtime,otherFlow,policy))).toBeNull();
    await empty(); expect(await create()).not.toBeNull();
  });
});
