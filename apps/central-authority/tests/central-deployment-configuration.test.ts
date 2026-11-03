import {createPrivateKey,generateKeyPairSync} from "node:crypto";
import {createServer} from "node:https";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {it,expect} from "vitest";
import {parseCentralDeploymentConfiguration,resolveCentralDeploymentConfiguration,verifyCentralTlsIdentity,verifyEnrollmentIssuerKey,verifyCentralRuntimeDatabase,createCentralReadinessProbe} from "../src/central-deployment-configuration.js";
import {drainCentralServer} from "../src/central-server-shutdown.js";
import {labTls} from "./helpers/lab-https.js";

// Metadata fixtures only, never deployed, resolved or registered as real origins.
const candidate=()=>({CENTRAL_DEPLOYMENT_ENVIRONMENT:"LOCAL",CENTRAL_AUTHORITY_ORIGIN:"https://business.example.test",
  CENTRAL_AUTHORITY_PORT:"8443",CENTRAL_DATABASE_URL:"postgresql://pos_platform_app@127.0.0.1:55433/temporary",
  CENTRAL_TLS_KEY_FILE:join(tmpdir(),"fixture-tls-key"),CENTRAL_TLS_CERT_FILE:join(tmpdir(),"fixture-tls-cert"),D3_ISSUER_PRIVATE_KEY_FILE:join(tmpdir(),"fixture-issuer"),
  D3_ENROLLMENT_TRANSPORT_TOKEN_FILE:join(tmpdir(),"fixture-token"),D3_ENROLLMENT_MAX_BODY_BYTES:"16384",D3_CREDENTIAL_LIFETIME_MS:"60000",
  CENTRAL_SHUTDOWN_TIMEOUT_MS:"100",CENTRAL_REQUEST_TIMEOUT_MS:"5000",CENTRAL_HEADERS_TIMEOUT_MS:"3000"});
it("requires an explicit complete deployment profile with no policy defaults",()=>{
  expect(resolveCentralDeploymentConfiguration({})).toBeNull();
  expect(()=>resolveCentralDeploymentConfiguration({CENTRAL_AUTHORITY_ORIGIN:"https://business.example.test"})).toThrow("CENTRAL_DEPLOYMENT_ENVIRONMENT_REQUIRED");
  expect(parseCentralDeploymentConfiguration(candidate())).toMatchObject({environment:"LOCAL",port:8443,maxBodyBytes:16384});
  for(const key of Object.keys(candidate())){const input:NodeJS.ProcessEnv={...candidate()};delete input[key];expect(()=>parseCentralDeploymentConfiguration(input),key).toThrow();}
});
it.each(["http://business.example.test","https://business.example.test/path","https://u:p@business.example.test","https://business.example.test?x=1"])("rejects non-origin or insecure deployment %s",value=>{
  expect(()=>parseCentralDeploymentConfiguration({...candidate(),CENTRAL_AUTHORITY_ORIGIN:value})).toThrow();
});
it.each(["postgres","pos_schema_owner","pos_migrator"])("rejects the privileged/incorrect database role %s",role=>{
  expect(()=>parseCentralDeploymentConfiguration({...candidate(),CENTRAL_DATABASE_URL:`postgresql://${role}@127.0.0.1:55433/temporary`})).toThrow("CENTRAL_RUNTIME_ROLE_REQUIRED");
});
it("commercial profiles reject lab origins and unverified database TLS",()=>{
  expect(()=>parseCentralDeploymentConfiguration({...candidate(),CENTRAL_DEPLOYMENT_ENVIRONMENT:"PRODUCTION"})).toThrow("CENTRAL_COMMERCIAL_ORIGIN_REQUIRED");
  const publicMetadata={...candidate(),CENTRAL_DEPLOYMENT_ENVIRONMENT:"PREPRODUCTION",CENTRAL_AUTHORITY_ORIGIN:"https://auth.operator-domain.co"};
  expect(()=>parseCentralDeploymentConfiguration(publicMetadata)).toThrow("CENTRAL_DATABASE_TLS_VERIFICATION_REQUIRED");
  expect(parseCentralDeploymentConfiguration({...publicMetadata,CENTRAL_DATABASE_URL:"postgresql://pos_platform_app@database.operator-domain.co/preproduction?sslmode=verify-full"}).environment).toBe("PREPRODUCTION");
});
it("rejects ambiguous token sources, invalid integers and timeout order",()=>{
  expect(()=>parseCentralDeploymentConfiguration({...candidate(),NODE_TLS_REJECT_UNAUTHORIZED:"0"})).toThrow("CENTRAL_DATABASE_TLS_CONFIGURATION_AMBIGUOUS");
  expect(()=>parseCentralDeploymentConfiguration({...candidate(),CENTRAL_DATABASE_URL:candidate().CENTRAL_DATABASE_URL+"?sslmode=verify-full&sslmode=disable"})).toThrow("CENTRAL_DATABASE_TLS_CONFIGURATION_AMBIGUOUS");
  expect(()=>parseCentralDeploymentConfiguration({...candidate(),D3_ENROLLMENT_TRANSPORT_TOKEN:"not-used"})).toThrow();
  for(const value of ["0","NaN","-1","65536"])expect(()=>parseCentralDeploymentConfiguration({...candidate(),CENTRAL_AUTHORITY_PORT:value})).toThrow();
  expect(()=>parseCentralDeploymentConfiguration({...candidate(),CENTRAL_HEADERS_TIMEOUT_MS:"6000"})).toThrow("CENTRAL_TIMEOUT_ORDER_INVALID");
  expect(()=>parseCentralDeploymentConfiguration({...candidate(),CENTRAL_SHUTDOWN_TIMEOUT_MS:"2147483648"})).toThrow();
});
it("verifies actual TLS leaf/key/hostname/time without claiming client CA trust",()=>{
  const tls=labTls(),configuration=parseCentralDeploymentConfiguration(candidate()),key=createPrivateKey(tls.key);
  expect(verifyCentralTlsIdentity(configuration,tls.cert,key)).toMatch(/^[A-F0-9:]+$/);
  expect(()=>verifyCentralTlsIdentity({...configuration,origin:"https://other.example.test"},tls.cert,key)).toThrow();
  expect(()=>verifyCentralTlsIdentity(configuration,tls.cert,generateKeyPairSync("ed25519").privateKey)).toThrow();
  expect(()=>verifyCentralTlsIdentity(configuration,tls.cert,key,new Date("2000-01-01"))).toThrow();
  expect(()=>verifyCentralTlsIdentity(configuration,tls.cert,key,new Date("2100-01-01"))).toThrow();
  expect(()=>verifyEnrollmentIssuerKey(key)).toThrow("CENTRAL_ENROLLMENT_ISSUER_KEY_REJECTED");
  expect(()=>verifyEnrollmentIssuerKey(generateKeyPairSync("ed25519").privateKey)).not.toThrow();
});
it("database preflight requires a canonical unprivileged role and installed schema",async()=>{
  for(const row of [{eligible:false,schema_ready:true},{eligible:true,schema_ready:false}])
    await expect(verifyCentralRuntimeDatabase({query:async()=>({rows:[row]})} as never)).rejects.toThrow("CENTRAL_RUNTIME_DATABASE_REJECTED");
  await expect(verifyCentralRuntimeDatabase({query:async()=>({rows:[{eligible:true,schema_ready:true}]})} as never)).resolves.toBeUndefined();
});
it("drains a real listener before closing PostgreSQL and bounds a stalled pool",async()=>{
  const tls=labTls(),server=createServer(tls);await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));let ended=0;
  expect(await drainCentralServer(server,{end:async()=>{ended++;}},1000)).toBe("DRAINED");expect(ended).toBe(1);expect(server.listening).toBe(false);
  const stalled=createServer(tls);await new Promise<void>(r=>stalled.listen(0,"127.0.0.1",r));
  expect(await drainCentralServer(stalled,{end:()=>new Promise(()=>undefined)},20)).toBe("DEADLINE");expect(stalled.listening).toBe(false);
});
it("readiness times out and coalesces concurrent probes without queuing database requests",async()=>{
  let queries=0;const probe=createCentralReadinessProbe({query:()=>{queries++;return new Promise(()=>undefined);}} as never,10);
  expect(await Promise.all([probe(),probe(),probe()])).toEqual([false,false,false]);expect(queries).toBe(1);
  expect(await probe()).toBe(false);expect(queries).toBe(1);
});

it("supports a loopback-only Central listener without changing the existing bind default",()=>{
  expect(parseCentralDeploymentConfiguration(candidate()).bindAddress).toBeUndefined();
  expect(parseCentralDeploymentConfiguration({...candidate(),CENTRAL_BIND_ADDRESS:"127.0.0.1"}).bindAddress).toBe("127.0.0.1");
  expect(parseCentralDeploymentConfiguration({...candidate(),CENTRAL_BIND_ADDRESS:"0.0.0.0"}).bindAddress).toBe("0.0.0.0");
  for(const value of ["","localhost","::","192.168.1.2","127.0.0.1:8443"])expect(()=>parseCentralDeploymentConfiguration({...candidate(),CENTRAL_BIND_ADDRESS:value})).toThrow("CENTRAL_BIND_ADDRESS_REJECTED");
  expect(()=>resolveCentralDeploymentConfiguration({CENTRAL_BIND_ADDRESS:"127.0.0.1"})).toThrow("CENTRAL_DEPLOYMENT_ENVIRONMENT_REQUIRED");
});
