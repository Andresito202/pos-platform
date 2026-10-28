import {expect} from "vitest";
import {createHash,generateKeyPairSync,randomBytes,sign,verify} from "node:crypto";
import {execFileSync} from "node:child_process";
import {readFile,mkdtemp,writeFile,rm} from "node:fs/promises";
import {resolve,join,dirname,basename} from "node:path";
import {tmpdir} from "node:os";
import {createServer} from "node:https";
import {uuidV7 as id,canonicalSessionTrustJson,LicenseActivationPolicySchema} from "@pos-platform/contracts";
import {createDeviceRequestAuthorization} from "@pos-platform/device-trust";
import type {Pool} from "@pos-platform/database-postgres";
import {GlobalAdministrationSessions} from "../../src/global-administration-sessions.js";
import {createPlatformPasswordVerifier} from "../../src/platform-password-verifier.js";
import {SubscriptionLicenseContracts} from "../../src/subscription-license-contracts.js";
import {LicenseCapacityAuthority,LICENSE_ACTIVATION_PATH} from "../../src/license-capacity-authority.js";
import {createLicenseCapacityHandler} from "../../src/license-capacity-runtime.js";
import {labTls,postLabHttps,closeLabHttps} from "./lab-https.js";

export async function exerciseLicenseCapacity(f:{owner:Pool;runtime:Pool;user:string;grant:string;db:string;server:string;buyer:{tenant:string;company:string}}){
  const {owner,runtime,user,buyer}=f,tool=resolve("../../tools/target-migrations"),u=new URL(f.server);u.pathname="/"+f.db;u.username="pos_migrator";u.password="";
  const migrate=()=>JSON.parse(execFileSync(process.execPath,["--import","tsx","src/postgres-commercial-cli.ts","--license-activations"],{cwd:tool,encoding:"utf8",windowsHide:true,
    env:{...process.env,POSTGRES_MIGRATOR_URL:u.href,POSTGRES_EXPECTED_DATABASE:f.db,REPOSITORY_COMMIT:execFileSync("git",["rev-parse","HEAD"],{cwd:tool,encoding:"utf8",windowsHide:true}).trim(),POSTGRES_MIGRATION_LOCK_TIMEOUT_MS:"5000",POSTGRES_MIGRATION_STATEMENT_TIMEOUT_MS:"20000"}}));
  expect(migrate().some((r:any)=>r.migrationId==='022_license_activations'&&r.status==='APPLIED')).toBe(true);
  expect(migrate().every((r:any)=>r.status==='ALREADY_APPLIED')).toBe(true);
  expect((await runtime.query("SELECT has_table_privilege(current_user,'licensing.trusted_signing_keys','INSERT') AS writable")).rows[0].writable).toBe(false);
  const password=randomBytes(24).toString("hex"),factor=id(),material=id(),passwordId=id(),credentialId=randomBytes(32).toString("base64url"),origin="https://business.example.test";
  const pair=generateKeyPairSync("ec",{namedCurve:"prime256v1"}),jwk=pair.publicKey.export({format:"jwk"});
  const cose=Buffer.concat([Buffer.from("a5010203262001215820","hex"),Buffer.from(jwk.x!,"base64url"),Buffer.from("225820","hex"),Buffer.from(jwk.y!,"base64url")]);
  await owner.query("INSERT INTO identity.user_credentials(id,user_id,credential_type,verifier,status,created_at) VALUES($1,$2,'PASSWORD',$3,'ACTIVE',now())",[passwordId,user,await createPlatformPasswordVerifier(password,"owasp-19m-t2-p1")]);
  await owner.query("INSERT INTO identity.mfa_factors(id,user_id,factor_type,secret_reference,status,enrolled_at,verified_at) VALUES($1,$2,'WEBAUTHN',$3,'ACTIVE',now(),now())",[factor,user,"webauthn:v1:"+material]);
  await owner.query("INSERT INTO identity.webauthn_credential_material(id,factor_id,credential_id,public_key_cose_base64url) VALUES($1,$2,$3,$4)",[material,factor,credentialId,cose.toString("base64url")]);
  const roleId=(await owner.query('SELECT role_id FROM "authorization".role_permission_grants WHERE id=$1',[f.grant])).rows[0].role_id,permission=id(),issueGrant=id();
  await owner.query('INSERT INTO "authorization".permissions(id,code,module,description,status,created_at) VALUES($1,\'LICENSE_ISSUE\',\'LICENSING\',\'Test only\',\'ACTIVE\',now())',[permission]);
  await owner.query('INSERT INTO "authorization".role_permission_grants(id,role_id,permission_id,grant_version,status,valid_from,created_at) VALUES($1,$2,$3,1,\'ACTIVE\',now(),now())',[issueGrant,roleId,permission]);
  const sessions=new GlobalAdministrationSessions(runtime,{mode:"ISOLATED_VALIDATION",origin,rpId:"business.example.test",policyReference:"TEST_ONLY",rejectionVerifier:await createPlatformPasswordVerifier("rejection-test","owasp-19m-t2-p1"),
    challengeLifetimeMs:60000,sessionLifetimeMs:300000,maximumMfaAgeMs:60000,maximumReauthenticationAgeMs:300000,browserLifetimeMs:300000,idleTimeoutMs:300000,lockTimeoutMs:2000,statementTimeoutMs:10000});
  const start=(await sessions.begin({email:"quote-test@example.invalid",password,factorId:factor,correlationId:id()}))!,data=Buffer.from(JSON.stringify({type:"webauthn.get",challenge:start.challenge,origin,crossOrigin:false})),auth=Buffer.alloc(37);
  createHash("sha256").update("business.example.test").digest().copy(auth);auth[32]=5;auth.writeUInt32BE(1,33);
  const login=(await sessions.complete({email:"quote-test@example.invalid",password,challenge:start.challenge,response:{id:credentialId,rawId:credentialId,type:"public-key",clientExtensionResults:{},response:{
    clientDataJSON:data.toString("base64url"),authenticatorData:auth.toString("base64url"),signature:sign("sha256",Buffer.concat([auth,createHash("sha256").update(data).digest()]),pair.privateKey).toString("base64url")}}}))!;
  const sid=(await sessions.authorize({cookie:login.setCookie.split(";",1)[0]!,csrfToken:login.csrfToken,origin,method:"POST",fetchSite:"same-origin"},"LICENSE_ISSUE"))!;expect(sid).toBeTruthy();
  const paid=(await owner.query("SELECT id FROM payments.payments WHERE status='CONFIRMED' ORDER BY id LIMIT 1")).rows[0];expect(paid).toBeDefined();
  const limits={reauthenticationMs:300000,lockTimeoutMs:2000,statementTimeoutMs:10000};
  const license=await new SubscriptionLicenseContracts(runtime,[{policy_reference:"TEST_ONLY_NOT_APPROVED_FOR_PRODUCTION",tax_policy_reference:"TEST_TAX_RESULT",support_policy_reference:"TEST_SUPPORT_TERMS"}],limits).issue(sid,paid.id,id());
  await owner.query("INSERT INTO licensing.license_entitlements(id,license_id,capability_code,enabled,limit_type,source_plan_version,created_at) VALUES($1,$2,'CASH_REGISTER',true,'NOT_APPLICABLE',1,now())",[id(),license.licenseId]);
  const key=generateKeyPairSync("ed25519"),keyId="LICENSE_TEST_ONLY",branch=id(),register=id();
  await owner.query("INSERT INTO licensing.trusted_signing_keys(key_id,key_purpose,environment,public_key,public_key_checksum,algorithm_id,key_status,valid_from,valid_until) VALUES($1,'LICENSE','PREPRODUCTION',$2,$3,'Ed25519','ACTIVE',now()-interval '1 minute',now()+interval '1 day')",
    [keyId,Buffer.from(key.publicKey.export({type:"spki",format:"pem"})),createHash("sha256").update(key.publicKey.export({type:"spki",format:"der"})).digest()]);
  await owner.query("INSERT INTO organization.branches(id,tenant_id,company_id,name,timezone,status,created_at,updated_at) VALUES($1,$2,$3,'Test','America/Bogota','ACTIVE',now(),now())",[branch,buyer.tenant,buyer.company]);
  async function device(){const deviceId=id(),installation=id(),credential=id(),key=generateKeyPairSync("ed25519");
    await owner.query("INSERT INTO identity.device_registry(device_id,installation_id,tenant_id,company_id,device_key_id,device_public_key,device_public_key_algorithm,status,trust_key_id,trust_key_purpose,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'Ed25519','ACTIVE','TRUST_TEST','DEVICE_TRUST',now(),now())",
      [deviceId,installation,buyer.tenant,buyer.company,"TEST_"+deviceId,Buffer.from(key.publicKey.export({type:"spki",format:"pem"}))]);
    await owner.query("INSERT INTO identity.device_credentials(credential_id,device_id,installation_id,tenant_id,company_id,device_key_id,trust_key_id,key_purpose,status,generation,issued_at,expires_at,credential_checksum,issuer_signature,created_at) VALUES($1,$2,$3,$4,$5,$6,'TRUST_TEST','DEVICE_TRUST','ACTIVE',1,now()-interval '1 minute',now()+interval '1 day',$7,$8,now())",
      [credential,deviceId,installation,buyer.tenant,buyer.company,"TEST_"+deviceId,createHash("sha256").update(credential).digest("hex"),Buffer.alloc(64)]);return {deviceId,installation,credential,key};}
  const d=await device(),d2=await device(),d3=await device();
  const policy={profile:"CAMACHO_LICENSE_ACTIVATION_V1",policy_reference:"TEST_GRACE_3D_V1",subscription_grace_days:3,grace_basis:"ELAPSED_24_HOURS",perpetual_use:"NO_EXPIRY",support_and_external_services:"SEPARATE",
    accepted_contract_policy_references:["TEST_ONLY_NOT_APPROVED_FOR_PRODUCTION"],offline_capabilities:["CASH_REGISTER"]};
  expect(LicenseActivationPolicySchema.safeParse({...policy,subscription_grace_days:4}).success).toBe(false);
  const authority=new LicenseCapacityAuthority(runtime,policy,{keyId,privateKey:key.privateKey,environment:"PREPRODUCTION"},limits);
  const allocation=(credential=d.credential,registers=[register])=>({license_id:license.licenseId,credential_id:credential,allocations:registers.map(register_id=>({register_id,branch_id:branch})),idempotency_key:id(),correlation_id:id()});
  const request=allocation();
  await expect(authority.allocate(id(),request)).rejects.toThrow("LICENSE_ISSUE_REQUIRED");
  await expect(authority.allocate(sid,{...request,expires_at:new Date().toISOString()})).rejects.toThrow();
  await expect(authority.allocate(sid,{...request,allocations:[{register_id:register,branch_id:id()}]})).rejects.toThrow("BRANCH_SCOPE");
  const pending=await authority.allocate(sid,request);expect(pending.status).toBe("PENDING");
  expect(await authority.allocate(sid,{...request,correlation_id:id()})).toMatchObject({activationId:pending.activationId,idempotent:true});
  await expect(authority.allocate(sid,{...request,allocations:[{register_id:id(),branch_id:branch}]})).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  const races=await Promise.allSettled([authority.allocate(sid,allocation(d2.credential,[id(),id()])),authority.allocate(sid,allocation(d3.credential,[id(),id()]))]);
  expect(races.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect(races.filter(r=>r.status==='rejected').map(r=>(r as PromiseRejectedResult).reason.message)).toEqual(["LICENSE_PAID_REGISTER_CAPACITY_EXCEEDED"]);
  const proof=(activationId=pending.activationId,who=d,path=LICENSE_ACTIVATION_PATH,at=new Date())=>{const body=JSON.stringify({activationId}),requestId=id(),correlationId=id();return {body,requestId,correlationId,
    authorization:createDeviceRequestAuthorization({method:"POST",path,body,requestId,correlationId,credentialId:who.credential},who.key.privateKey,at)};};
  await expect(authority.activate(proof(pending.activationId,d,"/v1/commercial/token"))).rejects.toThrow("POSSESSION");
  await expect(authority.activate(proof(pending.activationId,d,LICENSE_ACTIVATION_PATH,new Date(Date.now()-180000)))).rejects.toThrow("POSSESSION");
  await expect(authority.activate(proof(pending.activationId,d2))).rejects.toThrow("CREDENTIAL_MISMATCH");
  const tampered=proof();tampered.body=JSON.stringify({activationId:id()});await expect(authority.activate(tampered)).rejects.toThrow("POSSESSION");
  await owner.query("CREATE FUNCTION public.reject_capacity_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.reason_code='LICENSE_CAPACITY_ACTIVATED' THEN RAISE EXCEPTION 'CAPACITY_AUDIT_FAILURE'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_capacity_event BEFORE INSERT ON identity.device_authentication_events FOR EACH ROW EXECUTE FUNCTION public.reject_capacity_event()");
  const burned=proof();try{await expect(authority.activate(burned)).rejects.toThrow("CAPACITY_AUDIT_FAILURE");
    expect((await owner.query("SELECT activation_status FROM licensing.license_activations WHERE id=$1",[pending.activationId])).rows[0].activation_status).toBe("PENDING");
  }finally{await owner.query("DROP TRIGGER reject_capacity_event ON identity.device_authentication_events; DROP FUNCTION public.reject_capacity_event()");}
  await expect(authority.activate(burned)).rejects.toThrow("POSSESSION");
  const tls=labTls(),api=createServer(tls,createLicenseCapacityHandler(authority,origin,{requests:40,buckets:10,windowMs:60000}));
  await new Promise<void>(yes=>api.listen(0,"127.0.0.1",yes));
  try{const fresh=proof(),headers={authorization:fresh.authorization,"x-request-id":fresh.requestId,"x-correlation-id":fresh.correlationId};
    expect((await postLabHttps(api,tls.cert,LICENSE_ACTIVATION_PATH,JSON.parse(fresh.body),{...headers,origin})).status).toBe(403);
    const response=await postLabHttps(api,tls.cert,LICENSE_ACTIVATION_PATH,JSON.parse(fresh.body),headers);expect(response.status).toBe(200);
    const result=response.body as any;expect(result.artifact.claims.cash_register_capacity).toMatchObject({included:1,paid_additional:2});
    expect(verify(null,Buffer.from(canonicalSessionTrustJson(result.artifact.claims)),key.publicKey,Buffer.from(result.artifact.signature,"base64url"))).toBe(true);
    const nominal=(await owner.query("SELECT expires_at FROM licensing.licenses WHERE id=$1",[license.licenseId])).rows[0].expires_at as Date;
    expect(Date.parse(result.artifact.claims.expires_at)-nominal.getTime()).toBe(3*86400000);
    expect((await postLabHttps(api,tls.cert,LICENSE_ACTIVATION_PATH,JSON.parse(fresh.body),headers)).status).toBe(403);
    expect(await new LicenseCapacityAuthority(runtime,policy,{keyId,privateKey:key.privateKey,environment:"PREPRODUCTION"},limits).activate(proof())).toMatchObject({idempotent:true,artifact:result.artifact});
    const dir=await mkdtemp(join(tmpdir(),"pos-central-capacity-"));
    try{await writeFile(join(dir,"provision.json"),JSON.stringify({profile:"CAMACHO_LICENSE_CAPACITY_PROVISION_V2",keys:[result.key],artifact:result.artifact}));
      const probe=execFileSync(process.execPath,["--import","tsx","tests/helpers/central-license-capacity-probe.ts",dir],{cwd:resolve("../pos-local-service"),encoding:"utf8",windowsHide:true});
      expect(JSON.parse(probe)).toMatchObject({accepted:true,expiredRejected:true,unallocatedRejected:true,restartAccepted:true});
    }finally{if(dirname(resolve(dir))!==resolve(tmpdir())||!basename(dir).startsWith("pos-central-capacity-"))throw Error("CLEANUP_REJECTED");await rm(dir,{recursive:true,force:true});}
    await owner.query("UPDATE identity.device_credentials SET status='REVOKED',revoked_at=now(),revoked_reason='TEST' WHERE credential_id=$1",[d.credential]);
    await expect(authority.activate(proof())).rejects.toThrow("POSSESSION");
  }finally{await closeLabHttps(api);}
  await expect(owner.query("DELETE FROM licensing.license_activations WHERE id=$1",[pending.activationId])).rejects.toThrow("history");
  await expect(owner.query("UPDATE licensing.license_activations SET request_payload='{}' WHERE id=$1",[pending.activationId])).rejects.toThrow("immutable");
}
