import {afterAll,beforeAll,expect,it} from "vitest";
import {createPostgresPool,PostgresCommercialDeploymentContext,assertCommercialDeployment,type Pool} from "@pos-platform/database-postgres";
import {uuidV7,CommercialHttpV2,PlatformSecurityEventCode,type LicenseOfferDraft} from "@pos-platform/contracts";
import {LicenseOfferDrafts} from "../src/license-offer-drafts.js";
import {createHash,generateKeyPairSync,randomBytes,sign} from "node:crypto";
import {execFileSync} from "node:child_process";
import {mkdtemp,readFile,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve,dirname,basename} from "node:path";
import {createServer,request,type Server} from "node:https";
import {createDeviceRequestAuthorization,commercialPossessionChallenge,type CommercialPossessionContext} from "@pos-platform/device-trust";
import {prepareCentralCommercialRuntime} from "../src/central-commercial-runtime.js";
import {createPlatformPasswordVerifier} from "../src/platform-password-verifier.js";
import {SessionTrustKeyIssuer} from "../src/session-trust-key-issuer.js";
import {signAuthorizationTrust} from "../src/isolated-authorization-trust.js";

// Temporary cryptographic identities only. The commercial-looking hostname is
// SNI inside this process, never DNS, OS trust, or an actual Central deployment.
const serverUrl=process.env.POSTGRES_TEST_URL,host="auth.fixture-commercial.co",origin="https://"+host;
const db="pos_commercial_deployment_test_"+randomBytes(8).toString("hex");
const sha=(v:string|Buffer)=>createHash("sha256").update(v).digest("hex");
const id=()=>uuidV7(),user=id(),factor=id(),material=id(),membership=id(),tenant=id(),company=id(),branch=id(),device=id(),installation=id(),credential=id();
const password=randomBytes(24).toString("base64url"),email="fixture@example.test",publicCredential=randomBytes(32).toString("base64url");
const authenticator=generateKeyPairSync("ec",{namedCurve:"prime256v1"}),deviceKeys=generateKeyPairSync("ed25519");
const registration={clientId:"WINDOWS_DEPLOYMENT_TEST",redirectUri:"http://127.0.0.1:47123/callback",authorizationOrigin:origin,platform:"ELECTRON" as const};
let admin:Pool,owner:Pool,runtime:Pool,server:Server,dir:string,created=false,tls:{key:Buffer;cert:Buffer},config:any,manifest:Record<string,string>;
let provision:string,ssaFile:string,sasFile:string;
const rootSql=new URL("../../../tools/target-migrations/sql/postgres/",import.meta.url);
const tool=resolve("../../tools/target-migrations");
async function prepare(){return prepareCentralCommercialRuntime({pool:runtime,provisionFile:provision,origin,environment:"PREPRODUCTION",tls,publishedSsaFile:ssaFile,publishedSasFile:sasFile});}
beforeAll(async()=>{
  if(!serverUrl)return;
  const url=new URL(serverUrl);if(!["127.0.0.1","localhost"].includes(url.hostname)||url.port!=="55433")throw Error("TEMPORARY_POSTGRES_ONLY");
  admin=createPostgresPool(serverUrl,2,"deployment-fixture-admin");await admin.query(`CREATE DATABASE "${db}"`);created=true;
  await admin.query(`GRANT CREATE ON DATABASE "${db}" TO pos_schema_owner`);url.pathname="/"+db;
  owner=createPostgresPool(url.href,2,"deployment-fixture-owner");await owner.query(await readFile(new URL("bootstrap.sql",rootSql),"utf8"));
  const ddl=await owner.connect();try{
    await ddl.query("SET ROLE pos_schema_owner");
    for(const name of ["001_central_foundation","004_device_trust","006_licensing_foundation","007_password_recovery"])
      await ddl.query(await readFile(new URL(name+".up.sql",rootSql),"utf8"));
    await ddl.query(`INSERT INTO platform.target_migration_executions(execution_id,migration_id,dialect,manifest_version,checksum,status,started_at,body_committed_at,smoke_verified_at,applied_at,finished_at,runner_version)
      VALUES($1,'007_password_recovery','POSTGRESQL',1,$2,'APPLIED',clock_timestamp(),clock_timestamp(),clock_timestamp(),clock_timestamp(),clock_timestamp(),'TEMPORARY_FIXTURE_PREDECESSOR')`,
      [id(),Buffer.from(sha(await readFile(new URL("007_password_recovery.up.sql",rootSql))),"hex")]);
  }finally{await ddl.query("RESET ROLE");ddl.release();}
  url.username="pos_migrator";url.password="";
  execFileSync(process.execPath,["--import","tsx","src/postgres-commercial-cli.ts"],{cwd:tool,windowsHide:true,env:{...process.env,
    POSTGRES_MIGRATOR_URL:url.href,POSTGRES_EXPECTED_DATABASE:db,REPOSITORY_COMMIT:"e1f9d4f98345eb3224844377a497c1a573673d01",
    POSTGRES_MIGRATION_LOCK_TIMEOUT_MS:"5000",POSTGRES_MIGRATION_STATEMENT_TIMEOUT_MS:"20000"}});
  manifest=JSON.parse(execFileSync(process.execPath,["--import","tsx","src/postgres-commercial-cli.ts","--manifest"],{cwd:tool,windowsHide:true,encoding:"utf8"}));
  url.username="pos_platform_app";runtime=createPostgresPool(url.href,5,"deployment-runtime");
  dir=await mkdtemp(join(tmpdir(),"camacho-central-deployment-"));
  const put=async(name:string,value:string|Buffer)=>{const path=join(dir,name);await writeFile(path,value);return path;};
  const privateFile=async(name:string,k:ReturnType<typeof generateKeyPairSync>)=>put(name,k.privateKey.export({format:"pem",type:"pkcs8"}));
  const publicFile=async(name:string,k:ReturnType<typeof generateKeyPairSync>)=>put(name,k.publicKey.export({format:"pem",type:"spki"}));
  const root=generateKeyPairSync("ed25519"),ssa=generateKeyPairSync("ed25519"),sas=generateKeyPairSync("ed25519"),access=generateKeyPairSync("ed25519");
  const rootFile=await publicFile("root.pub",root),pin=sha(root.publicKey.export({format:"der",type:"spki"}));
  const from=new Date(Date.now()-60000).toISOString(),until=new Date(Date.now()+600000).toISOString();
  const signedSsa=new SessionTrustKeyIssuer(root.privateKey).issue({key_id:"SSA_FIXTURE",key_purpose:"SESSION_ASSERTION",environment:"PREPRODUCTION",status:"ACTIVE",version:1,
    public_key_pem:ssa.publicKey.export({format:"pem",type:"spki"}).toString(),valid_from:from,valid_until:until});
  const recipient={tenant_id:tenant,company_id:company,branch_id:branch,installation_id:installation,device_id:device};
  const signedSas=signAuthorizationTrust({profile:"CAMACHO_SAS_TRUST_V1",mode:"DEPLOYMENT",schema_version:1,purpose:"AUTHORIZATION_SNAPSHOT",environment:"PREPRODUCTION",issuer:origin,
    authority_id:"CENTRAL_FIXTURE",recipient,generation:1,complete:true,issued_at:from,valid_from:from,valid_until:until,
    keys:[{key_id:"SAS_FIXTURE",purpose:"AUTHORIZATION_SNAPSHOT",public_key_pem:sas.publicKey.export({format:"pem",type:"spki"}).toString(),status:"ACTIVE",version:1,valid_from:from,valid_until:until}]},root.privateKey);
  ssaFile=await put("ssa.json",JSON.stringify({version:1,keys:[signedSsa]}));sasFile=await put("sas.json",JSON.stringify(signedSas));
  const verifier=await createPlatformPasswordVerifier(password,"owasp-19m-t2-p1");
  config={profile:"CAMACHO_CENTRAL_COMMERCIAL_V2",environment:"PREPRODUCTION",expected_database:db,schema_checksums:manifest,policy_reference:"TEMPORARY_TEST_EXPLICIT_VALUES",
    registration,rp_id:host,recipient,factor_id:factor,membership_id:membership,rejection_verifier_file:await put("rejection",await createPlatformPasswordVerifier(randomBytes(32).toString("hex"),"owasp-19m-t2-p1")),
    access:{private_key_file:await privateFile("access.key",access),public_key_file:await publicFile("access.pub",access),key_id:"ACCESS_FIXTURE",audience:"BUSINESS_FIXTURE",valid_from:from,valid_until:until},
    ssa:{private_key_file:await privateFile("ssa.key",ssa),root_public_key_file:rootFile,root_spki_sha256:pin,operational_key_file:await put("ssa-key.json",JSON.stringify(signedSsa))},
    sas:{private_key_file:await privateFile("sas.key",sas),root_public_key_file:rootFile,root_spki_sha256:pin,trust_bundle_file:sasFile,authority_id:"CENTRAL_FIXTURE",key_id:"SAS_FIXTURE"},
    limits:{session_ms:300000,mfa_age_ms:120000,reauthentication_ms:300000,context_age_ms:30000,mfa_challenge_ms:60000,handoff_ms:30000,browser_ms:300000,browser_idle_ms:120000,
      refresh_family_ms:240000,access_ms:60000,proof_skew_ms:30000,rotation_window_ms:60000,maximum_rotations:10,native_challenge_ms:60000,native_request_ms:120000,native_code_ms:60000,
      maximum_challenges_per_minute:30,maximum_login_attempts:4,http_maximum_body_bytes:65536,http_requests_per_minute:100,http_maximum_buckets:1000,sas_ms:60000,ssa_claim_age_ms:30000,ssa_offline_ms:120000,sql_lock_timeout_ms:5000}};
  provision=await put("central.json",JSON.stringify(config));
  execFileSync("C:/Program Files/Git/usr/bin/openssl.exe",["req","-x509","-newkey","rsa:2048","-nodes","-days","1","-subj","/CN="+host,"-addext","subjectAltName=DNS:"+host,"-keyout",join(dir,"tls.key"),"-out",join(dir,"tls.crt")],{stdio:"ignore",windowsHide:true});
  tls={key:await readFile(join(dir,"tls.key")),cert:await readFile(join(dir,"tls.crt"))};
  const jwk=authenticator.publicKey.export({format:"jwk"}),cose=Buffer.concat([Buffer.from("a5010203262001215820","hex"),Buffer.from(jwk.x!,"base64url"),Buffer.from("225820","hex"),Buffer.from(jwk.y!,"base64url")]);
  await owner.query("INSERT INTO identity.users(id,email,email_normalized,full_name,status,created_at,updated_at) VALUES($1,$2,$2,'Temporary fixture','ACTIVE',clock_timestamp(),clock_timestamp())",[user,email]);
  await owner.query("INSERT INTO identity.user_credentials(id,user_id,credential_type,verifier,status,created_at) VALUES($1,$2,'PASSWORD',$3,'ACTIVE',clock_timestamp())",[id(),user,verifier]);
  await owner.query("INSERT INTO identity.mfa_factors(id,user_id,factor_type,secret_reference,status,enrolled_at,verified_at) VALUES($1,$2,'WEBAUTHN',$3,'ACTIVE',clock_timestamp(),clock_timestamp())",[factor,user,"webauthn:v1:"+material]);
  await owner.query("INSERT INTO identity.webauthn_credential_material(id,factor_id,credential_id,public_key_cose_base64url) VALUES($1,$2,$3,$4)",[material,factor,publicCredential,cose.toString("base64url")]);
  await owner.query("INSERT INTO tenancy.tenants(id,name,status,created_at,updated_at) VALUES($1,'Temporary tenant','ACTIVE',clock_timestamp(),clock_timestamp())",[tenant]);
  await owner.query("INSERT INTO tenancy.tenant_memberships(id,tenant_id,user_id,membership_type,status,created_by_actor_type,created_at,activated_at) VALUES($1,$2,$3,'MEMBER','ACTIVE','SYSTEM',clock_timestamp(),clock_timestamp())",[membership,tenant,user]);
  await owner.query("INSERT INTO organization.companies(id,tenant_id,trade_name,timezone,currency_code,status,created_at,updated_at) VALUES($1,$2,'Temporary company','America/Bogota','COP','ACTIVE',clock_timestamp(),clock_timestamp())",[company,tenant]);
  await owner.query("INSERT INTO organization.branches(id,tenant_id,company_id,code,code_normalized,name,timezone,status,created_at,updated_at) VALUES($1,$2,$3,'FIXTURE','FIXTURE','Temporary branch','America/Bogota','ACTIVE',clock_timestamp(),clock_timestamp())",[branch,tenant,company]);
  await owner.query("INSERT INTO identity.device_registry(device_id,installation_id,tenant_id,company_id,device_key_id,device_public_key,device_public_key_algorithm,status,trust_key_id,trust_key_purpose,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'Ed25519','ACTIVE','fixture','DEVICE_TRUST',clock_timestamp(),clock_timestamp())",[device,installation,tenant,company,"device-"+device,deviceKeys.publicKey.export({format:"pem",type:"spki"})]);
  await owner.query("INSERT INTO identity.device_credentials(credential_id,device_id,installation_id,tenant_id,company_id,device_key_id,trust_key_id,key_purpose,status,generation,issued_at,expires_at,credential_checksum,issuer_signature,created_at) VALUES($1,$2,$3,$4,$5,$6,'fixture','DEVICE_TRUST','ACTIVE',1,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '10 minutes',$7,$8,clock_timestamp())",[credential,device,installation,tenant,company,"device-"+device,randomBytes(32).toString("hex"),randomBytes(64)]);
  server=createServer(tls,await prepare());await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
},60000);
afterAll(async()=>{
  if(server){server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
  await runtime?.end();await owner?.end();if(created)await admin.query(`DROP DATABASE "${db}"`);await admin?.end();
  if(dir){if(dirname(resolve(dir))!==resolve(tmpdir())||!basename(dir).startsWith("camacho-central-deployment-"))throw Error("CLEANUP_REJECTED");await rm(dir,{recursive:true,force:true});}
});
function post(path:string,payload:unknown,headers:Record<string,string>={}){
  const raw=JSON.stringify(payload),port=(server.address() as {port:number}).port;
  return new Promise<{status:number;body:any;cookie:string|undefined}>((yes,no)=>{
    const req=request({host:"127.0.0.1",port,servername:host,ca:tls.cert,method:"POST",path,agent:false,
      headers:{host,"content-type":"application/json","content-length":Buffer.byteLength(raw),...headers}},res=>{
      const chunks:Buffer[]=[];res.on("data",c=>chunks.push(Buffer.from(c)));res.on("error",no);
      res.on("end",()=>{try{yes({status:res.statusCode!,body:JSON.parse(Buffer.concat(chunks).toString()),cookie:res.headers["set-cookie"]?.[0]?.split(";")[0]});}catch(e){no(e);}});
    });req.on("error",no);req.setTimeout(10000,()=>req.destroy(Error("TEST_TIMEOUT")));req.end(raw);
  });
}
const browserHeaders={origin,"sec-fetch-site":"same-origin"};
function proof(path:string,body:unknown){const raw=JSON.stringify(body),requestId=id(),correlationId=id();return {authorization:createDeviceRequestAuthorization({method:"POST",path,body:raw,requestId,correlationId,credentialId:credential},deviceKeys.privateKey),"x-request-id":requestId,"x-correlation-id":correlationId};}
function possession(operation:CommercialPossessionContext["operation"],token:string,body:unknown){
  const requestId=id(),correlationId=id(),timestamp=new Date().toISOString(),nonce=randomBytes(32).toString("base64url");
  const context={operation,origin,audience:config.access.audience,clientId:registration.clientId,tenantId:tenant,installationId:installation,deviceId:device,credentialId:credential,token,requestId,correlationId,body:JSON.stringify(body)};
  return {authorization:`CommercialProofV2 ${credential}.${timestamp}.${nonce}.${sign(null,commercialPossessionChallenge(context,{timestamp,nonce}),deviceKeys.privateKey).toString("base64url")}`,"x-request-id":requestId,"x-correlation-id":correlationId};
}
async function nativeRequest(){
  const verifier=randomBytes(32).toString("base64url"),state=randomBytes(32).toString("base64url");
  const params={client_id:registration.clientId,redirect_uri:registration.redirectUri,code_challenge:Buffer.from(sha(verifier),"hex").toString("base64url"),code_challenge_method:"S256",state};
  const ch=await post("/v1/commercial/native-request-challenges",params);expect(ch.status).toBe(200);
  const body={...params,...ch.body,purpose:"BUSINESS_NATIVE_AUTHORIZATION_V1"};delete body.expires_at;
  const registered=await post("/v1/commercial/native-requests",body,proof("/v1/commercial/native-requests",body));expect(registered.status).toBe(200);
  return {verifier,state,token:registered.body.request as string};
}
it.runIf(Boolean(serverUrl))("deployment composition: canonical runner, password/MFA, device-bound code, V2 SSA/SAS and refresh on real HTTPS",async()=>{
  const n=await nativeRequest(),headers={...browserHeaders,"x-commercial-native-request":n.token};
  expect((await post("/v1/commercial/login",{phase:"begin",email,password:"wrong",factorId:factor},headers)).status).toBe(401);
  const begin=await post("/v1/commercial/login",{phase:"begin",email,password,factorId:factor},headers);expect(begin.status).toBe(200);
  const clientData=Buffer.from(JSON.stringify({type:"webauthn.get",challenge:begin.body.challenge,origin,crossOrigin:false})),auth=Buffer.alloc(37);
  Buffer.from(sha(host),"hex").copy(auth);auth[32]=5;auth.writeUInt32BE(1,33);
  const response={id:publicCredential,rawId:publicCredential,type:"public-key",clientExtensionResults:{},response:{clientDataJSON:clientData.toString("base64url"),authenticatorData:auth.toString("base64url"),signature:sign("sha256",Buffer.concat([auth,Buffer.from(sha(clientData),"hex")]),authenticator.privateKey).toString("base64url")}};
  const login=await post("/v1/commercial/login",{phase:"complete",email,password,challenge:begin.body.challenge,response,tenantId:tenant,membershipId:membership},headers);expect(login.status).toBe(200);
  expect(login.cookie).toBeTruthy();
  const authorized=await post("/v1/commercial/authorize",{request:n.token,confirmed:true},{...browserHeaders,cookie:login.cookie!,"x-csrf-token":login.body.csrfToken});expect(authorized.status).toBe(200);
  const exchange={grant_type:"authorization_code",client_id:registration.clientId,redirect_uri:registration.redirectUri,code:authorized.body.code,code_verifier:n.verifier,state:n.state};
  const pair=await post("/v1/commercial/token",exchange,proof("/v1/commercial/token",exchange));expect(pair.status).toBe(200);
  expect((await post("/v1/commercial/token",exchange,proof("/v1/commercial/token",exchange))).status).toBe(401);
  const claims=JSON.parse(Buffer.from(pair.body.accessToken.split(".")[1],"base64url").toString()),body={session_id:claims.sid};
  const ssaProof=possession("SESSION_ASSERTION",pair.body.accessToken,body),ssa=await post("/v1/business-session/assertions",body,{...ssaProof,[CommercialHttpV2.accessHeader]:pair.body.accessToken});expect(ssa.status).toBe(200);expect(ssa.body.claims.session_id).toBe(claims.sid);
  expect((await post("/v1/business-session/assertions",body,{...ssaProof,[CommercialHttpV2.accessHeader]:pair.body.accessToken})).status).toBe(401);
  const sas=await post("/v1/business-session/authorization",body,{...possession("AUTHORIZATION_SNAPSHOT",pair.body.accessToken,body),[CommercialHttpV2.accessHeader]:pair.body.accessToken});expect(sas.status).toBe(200);
  expect(sas.body.claims.assignments).toEqual([]); // No fabricated grants: dashboard remains denied.
  const refresh={grant_type:"refresh_token",refresh_token:pair.body.refreshToken,client_id:registration.clientId};
  const rotated=await post("/v1/commercial/refresh",refresh,possession("REFRESH",pair.body.refreshToken,refresh));expect(rotated.status).toBe(200);
  expect(rotated.body.refreshToken).not.toBe(pair.body.refreshToken);
  const revoke={client_id:registration.clientId,refresh_token:rotated.body.refreshToken};
  expect((await post("/v1/commercial/revoke",revoke,possession("REFRESH",rotated.body.refreshToken,revoke))).status).toBe(401);
  await owner.query(`CREATE FUNCTION identity.reject_native_logout_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.event_code='${PlatformSecurityEventCode.SESSION_REVOKED}' THEN RAISE EXCEPTION 'LOGOUT_AUDIT_FIXTURE'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_native_logout_fixture BEFORE INSERT ON identity.security_events FOR EACH ROW EXECUTE FUNCTION identity.reject_native_logout_fixture()`);
  const failedProof=possession("REVOKE",rotated.body.refreshToken,revoke);
  try{
    expect((await post("/v1/commercial/revoke",revoke,failedProof)).status).toBe(503);
    expect((await owner.query("SELECT revoked_at FROM identity.sessions WHERE id=$1",[claims.sid])).rows[0].revoked_at).toBeNull();
    expect((await owner.query("SELECT count(*)::int AS n FROM identity.session_refresh_tokens WHERE session_id=$1 AND revoked_at IS NOT NULL",[claims.sid])).rows[0].n).toBe(0);
  }finally{await owner.query("DROP TRIGGER reject_native_logout_fixture ON identity.security_events; DROP FUNCTION identity.reject_native_logout_fixture()");}
  expect((await post("/v1/commercial/revoke",revoke,failedProof)).status).toBe(401);
  const freshProof=possession("REVOKE",rotated.body.refreshToken,revoke);
  const signedOut=await post("/v1/commercial/revoke",revoke,freshProof);expect(signedOut.status).toBe(200);
  expect((await post("/v1/commercial/revoke",revoke,freshProof)).status).toBe(401);
  expect((await post("/v1/commercial/revoke",revoke,possession("REVOKE",rotated.body.refreshToken,revoke))).status).toBe(200);
  expect((await post("/v1/business-session/assertions",body,{...possession("SESSION_ASSERTION",rotated.body.access,body),[CommercialHttpV2.accessHeader]:rotated.body.access})).status).toBe(401);
},30000);
it.runIf(Boolean(serverUrl))("deployment capability rejects serialized context, wrong pool, schema drift and missing policies",async()=>{
  const context=await PostgresCommercialDeploymentContext.verify(runtime,{expectedDatabase:db,checksums:manifest});
  expect(()=>assertCommercialDeployment(runtime,JSON.parse(JSON.stringify(context)))).toThrow("VERIFIED_DEPLOYMENT");
  expect(()=>assertCommercialDeployment(owner,context)).toThrow("VERIFIED_DEPLOYMENT");
  await expect(PostgresCommercialDeploymentContext.verify(runtime,{expectedDatabase:db,checksums:{...manifest,"016_native_business_authorization":"0".repeat(64)}})).rejects.toThrow("SCHEMA_REJECTED");
  const broken=structuredClone(config);delete broken.limits.sql_lock_timeout_ms;await writeFile(provision,JSON.stringify(broken));
  try{await expect(prepare()).rejects.toThrow();}finally{await writeFile(provision,JSON.stringify(config));}
});
it.runIf(Boolean(serverUrl))("deployment login budget is durable, atomic, bounded and rejects an unbound selector",async()=>{
  const n=await nativeRequest(),headers={...browserHeaders,"x-commercial-native-request":n.token},body={phase:"begin",email,password:"wrong",factorId:factor};
  const results=await Promise.all(Array.from({length:8},()=>post("/v1/commercial/login",body,headers)));
  expect(results.filter(r=>r.status===401)).toHaveLength(4);expect(results.filter(r=>r.status===429)).toHaveLength(4);
  expect((await owner.query("SELECT login_attempt_count FROM identity.native_authorization_requests WHERE request_hash=$1",[sha(n.token)])).rows[0].login_attempt_count).toBe(4);
  expect((await post("/v1/commercial/login",body,{...headers,"x-commercial-native-request":randomBytes(32).toString("base64url")})).status).toBe(429);
  await expect(owner.query("UPDATE identity.native_authorization_requests SET login_attempt_count=0 WHERE request_hash=$1",[sha(n.token)])).rejects.toThrow();
});

it.runIf(Boolean(serverUrl))("license draft pricing: persisted versions, one register, explicit GLOBAL grant, replay conflict, overflow and audit rollback",async()=>{
  const ddl=await owner.connect();try{await ddl.query("SET ROLE pos_schema_owner");await ddl.query(await readFile(new URL("proposals/license_offer_pricing.up.sql",rootSql),"utf8"));}finally{await ddl.query("RESET ROLE");ddl.release();}
  const global=id(),role=id(),permission=id(),grant=id();
  await owner.query("INSERT INTO identity.sessions(id,user_id,authenticated_at,expires_at,last_reauthenticated_at,mfa_status,created_at) VALUES($1,$2,clock_timestamp(),clock_timestamp()+interval '5 minutes',clock_timestamp(),'SATISFIED',clock_timestamp())",[global,user]);
  const drafts=new LicenseOfferDrafts(runtime,60000),offer:LicenseOfferDraft={id:id(),code:"TEMPORARY_PLAN",name:"Temporary draft only",billing_model:"MONTHLY",deployment_mode:"HYBRID",currency_code:"COP",price_minor:10000,
    included_registers:1,additional_register_price_minor:2000,support_price_minor:1000,support_charge:"OPTIONAL_SAME_TERM",policy_reference:"TEMPORARY_PRICING_NOT_A_PRODUCTION_POLICY"};
  await expect(drafts.save(global,offer,0,id())).rejects.toThrow("LICENSE_PLAN_MANAGE_REQUIRED");
  await owner.query("INSERT INTO \"authorization\".roles(id,code,name,scope_type,version,status,created_at) VALUES($1,'TEMPORARY_LICENSE_ADMIN','Fixture','PLATFORM',1,'ACTIVE',clock_timestamp())",[role]);
  await owner.query("INSERT INTO \"authorization\".permissions(id,code,module,description,status,created_at) VALUES($1,'LICENSE_PLAN_MANAGE','LICENSING','Fixture only','ACTIVE',clock_timestamp())",[permission]);
  await owner.query("INSERT INTO \"authorization\".role_permission_grants(id,role_id,permission_id,grant_version,status,valid_from,created_at) VALUES($1,$2,$3,1,'ACTIVE',clock_timestamp(),clock_timestamp())",[grant,role,permission]);
  const a=await owner.connect();try{await a.query("BEGIN");await a.query("SELECT set_config('app.audit_id',$1,true),set_config('app.correlation_id',$2,true)",[id(),id()]);
    await a.query("INSERT INTO \"authorization\".platform_role_assignments(id,user_id,role_id,status,valid_from,created_at,created_by_actor_type) VALUES($1,$2,$3,'ACTIVE',clock_timestamp(),clock_timestamp(),'SYSTEM')",[id(),user,role]);await a.query("COMMIT");
  }catch(e){await a.query("ROLLBACK");throw e;}finally{a.release();}
  expect(await drafts.save(global,offer,0,id())).toMatchObject({version:1,idempotent:false});
  expect(await drafts.save(global,offer,0,id())).toMatchObject({version:1,idempotent:true});
  await expect(drafts.save(global,{...offer,price_minor:999},0,id())).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  const revised={...offer,id:id(),price_minor:12000};expect(await drafts.save(global,revised,1,id())).toMatchObject({version:2});
  expect(await drafts.preview(global,offer.id,{additional_registers:2,support:true})).toMatchObject({plan_version:1,included_registers:1,total_registers:3,subtotal_minor:15000,payment_status:"NOT_REQUESTED",activation_status:"NOT_ACTIVATED"});
  expect(await drafts.preview(global,revised.id,{additional_registers:0,support:false})).toMatchObject({plan_version:2,total_registers:1,subtotal_minor:12000});
  await expect(drafts.preview(global,revised.id,{additional_registers:1,support:false,price_minor:1})).rejects.toThrow();
  await expect(owner.query("UPDATE licensing.plans SET price_minor=1 WHERE id=$1",[offer.id])).rejects.toThrow("immutable");
  const business=id();await owner.query("INSERT INTO identity.sessions(id,user_id,tenant_id,tenant_membership_id,authenticated_at,expires_at,last_reauthenticated_at,mfa_status,created_at) VALUES($1,$2,$3,$4,clock_timestamp(),clock_timestamp()+interval '5 minutes',clock_timestamp(),'SATISFIED',clock_timestamp())",[business,user,tenant,membership]);
  await expect(drafts.save(business,{...offer,id:id()},2,id())).rejects.toThrow("LICENSE_PLAN_MANAGE_REQUIRED");
  const failed=id();await owner.query(`CREATE FUNCTION audit.reject_offer_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action_code='LICENSE_OFFER_DRAFT_VERSIONED' THEN RAISE EXCEPTION 'OFFER_AUDIT_FAILURE'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_offer_fixture BEFORE INSERT ON audit.audit_events FOR EACH ROW EXECUTE FUNCTION audit.reject_offer_fixture()`);
  try{await expect(drafts.save(global,{...offer,id:failed},2,id())).rejects.toThrow("OFFER_AUDIT_FAILURE");
    expect((await owner.query("SELECT 1 FROM licensing.plans WHERE id=$1",[failed])).rowCount).toBe(0);
  }finally{await owner.query("DROP TRIGGER reject_offer_fixture ON audit.audit_events; DROP FUNCTION audit.reject_offer_fixture()");}
  for(const model of ["ANNUAL","PERPETUAL"] as const)expect(await drafts.save(global,{...offer,id:id(),code:"TEMPORARY_"+model,billing_model:model,deployment_mode:model==="PERPETUAL"?"LOCAL_PERPETUAL":"HYBRID"},0,id())).toMatchObject({version:1});
  const competing=await Promise.allSettled([drafts.save(global,{...offer,id:id(),price_minor:13000},2,id()),drafts.save(global,{...offer,id:id(),price_minor:14000},2,id())]);
  expect(competing.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect(competing.filter(r=>r.status==="rejected")).toHaveLength(1);
  expect((await owner.query("SELECT count(*)::int AS n FROM licensing.plans WHERE code=$1 AND version=3",[offer.code])).rows[0].n).toBe(1);
  const down=await owner.connect();try{await down.query("SET ROLE pos_schema_owner");await expect(down.query(await readFile(new URL("proposals/license_offer_pricing.down.sql",rootSql),"utf8"))).rejects.toThrow("history must be retained");}finally{await down.query("RESET ROLE");down.release();}
  const expensive={...offer,id:id(),code:"TEMPORARY_OVERFLOW",price_minor:Number.MAX_SAFE_INTEGER};await drafts.save(global,expensive,0,id());
  await expect(drafts.preview(global,expensive.id,{additional_registers:1,support:false})).rejects.toThrow("OVERFLOW");
  await owner.query("UPDATE \"authorization\".role_permission_grants SET status='RETIRED',retired_at=clock_timestamp() WHERE id=$1",[grant]);
  await expect(drafts.save(global,{...offer,id:id()},2,id())).rejects.toThrow("LICENSE_PLAN_MANAGE_REQUIRED");
  expect((await owner.query("SELECT 1 FROM licensing.licenses")).rowCount).toBe(0);
},30000);
