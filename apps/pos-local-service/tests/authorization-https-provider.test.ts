import {createServer,type Server} from "node:https";
import {generateKeyPairSync,randomUUID} from "node:crypto";
import {execFileSync} from "node:child_process";
import {existsSync,mkdtempSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve,dirname,basename} from "node:path";
import {afterEach,it,expect} from "vitest";
import {uuidV7} from "@pos-platform/contracts";
import {createDeviceRequestAuthorization} from "@pos-platform/device-trust";
import {HttpsAuthorizationSnapshotProvider,IsolatedHttpsSnapshotProvider} from "../src/authorization/isolated-https-snapshot-provider.js";
import {assertAuthorizationTrustSeparated} from "../src/security/authorization-trust-separation.js";

// ARCH-003 forbids importing another application's test fixtures. Keep only the
// ephemeral TLS setup here; no production trust or transport is reimplemented.
function labTls(){
  const directory=mkdtempSync(join(tmpdir(),"camacho-sas-tls-"));
  const executable=existsSync("C:/Program Files/Git/usr/bin/openssl.exe")?"C:/Program Files/Git/usr/bin/openssl.exe":"openssl";
  try{execFileSync(executable,["req","-x509","-newkey","rsa:3072","-nodes","-days","1","-subj","/CN=business.example.test",
    "-addext","subjectAltName=DNS:business.example.test","-keyout",join(directory,"key"),"-out",join(directory,"cert")],{stdio:"ignore"});
    return {key:readFileSync(join(directory,"key")),cert:readFileSync(join(directory,"cert"))};
  }finally{if(dirname(resolve(directory))!==resolve(tmpdir())||!basename(directory).startsWith("camacho-sas-tls-"))throw Error("TEST_TLS_CLEANUP_REJECTED");rmSync(directory,{recursive:true,force:true});}
}
const servers:Server[]=[];afterEach(async()=>{for(const server of servers.splice(0)){server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}});
function input(){
  const body=JSON.stringify({session_id:randomUUID()}),requestId=uuidV7(),correlationId=uuidV7(),pair=generateKeyPairSync("ed25519");
  return {body,requestId,correlationId,accessToken:"e30.e30.c2ln",timeoutMs:1000,
    authorization:createDeviceRequestAuthorization({method:"POST",path:"/v1/business-session/authorization",body,requestId,correlationId,credentialId:randomUUID()},pair.privateKey)};
}
async function fixture(status=200,cache="no-store"){
  const tls=labTls(),binding={userId:randomUUID(),installationId:randomUUID(),deviceId:randomUUID()};let requests=0;
  // Transport-only structural artifact. Acquisition/verifier tests separately
  // prove that this placeholder signature can NEVER authorize local operations.
  const artifact={claims:{snapshot_id:randomUUID(),user_id:binding.userId,installation_id:binding.installationId,device_id:binding.deviceId,
    sequence:1,issued_at:new Date().toISOString(),expires_at:new Date(Date.now()+30000).toISOString(),assignments:[],key_id:"SAS_TEST_TRANSPORT"},signature:"A".repeat(86)};
  const server=createServer(tls,(req,res)=>{requests++;expect(req.url).toBe("/v1/business-session/authorization");expect(req.headers.authorization).toMatch(/^DeviceProof /);
    res.writeHead(status,{"content-type":"application/json","cache-control":cache,...(status===302?{location:"https://untrusted.invalid/redirect"}:{})});res.end(JSON.stringify(artifact));});
  servers.push(server);await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));const address=server.address();if(!address||typeof address==="string")throw Error("TEST_PORT_REQUIRED");
  return {binding,tls,artifact,port:address.port,requests:()=>requests};
}
it("reuses strict HTTPS transport with an explicitly trusted laboratory CA",async()=>{
  const f=await fixture(),provider=new IsolatedHttpsSnapshotProvider({...input(),mode:"ISOLATED_VALIDATION",port:f.port,ca:f.tls.cert});
  expect(await provider.fetch(f.binding)).toEqual(f.artifact);expect(f.requests()).toBe(1);
});
it("rejects a CA that did not sign the actual server certificate",async()=>{
  const f=await fixture(),wrong=labTls();
  await expect(new IsolatedHttpsSnapshotProvider({...input(),mode:"ISOLATED_VALIDATION",port:f.port,ca:wrong.cert}).fetch(f.binding)).rejects.toThrow();
  expect(f.requests()).toBe(0);
});
it("keeps a validated transport configuration despite later caller mutation",async()=>{
  const f=await fixture(),configuration={...input(),mode:"ISOLATED_VALIDATION" as const,port:f.port,ca:Buffer.from(f.tls.cert)};
  const provider=new IsolatedHttpsSnapshotProvider(configuration);configuration.port=1;configuration.ca.fill(0);
  expect(await provider.fetch(f.binding)).toEqual(f.artifact);
});
it.each([[302,"no-store"],[200,"public, max-age=60"],[401,"no-store"]])("rejects redirects/cache/auth response %s",async(status,cache)=>{
  const f=await fixture(status as number,cache as string);
  await expect(new IsolatedHttpsSnapshotProvider({...input(),mode:"ISOLATED_VALIDATION",port:f.port,ca:f.tls.cert}).fetch(f.binding)).rejects.toThrow("SAS_PROVIDER_REJECTED");
  expect(f.requests()).toBe(1);
});
it("system-trust configuration rejects laboratory origins and CA/port overrides",()=>{
  const {authorization,accessToken:_unused,...request}=input();
  expect(()=>new HttpsAuthorizationSnapshotProvider({...request,authenticate:async()=>({authorization}),mode:"SYSTEM_TRUST",origin:"https://business.example.test"})).toThrow();
  const metadata={...request,authenticate:async()=>({authorization}),mode:"SYSTEM_TRUST" as const,origin:"https://auth.operator-domain.co"};
  expect(()=>new HttpsAuthorizationSnapshotProvider(metadata)).not.toThrow(); // no network or deployment
  expect(()=>new HttpsAuthorizationSnapshotProvider({...metadata,ca:Buffer.from("override")} as never)).toThrow("SAS_SYSTEM_TLS_OVERRIDE_REJECTED");
  expect(()=>new HttpsAuthorizationSnapshotProvider({...metadata,port:443} as never)).toThrow("SAS_SYSTEM_TLS_OVERRIDE_REJECTED");
});
it("requires actual proof-shaped credentials, UUIDv7 correlation and a closed request body",()=>{
  const common={...input(),mode:"ISOLATED_VALIDATION" as const,port:443,ca:Buffer.from("test-only")};
  for(const change of [{authorization:"Bearer anything"},{accessToken:randomUUID()},{requestId:randomUUID()},{body:JSON.stringify({session_id:randomUUID(),tenant_id:randomUUID()})}])
    expect(()=>new HttpsAuthorizationSnapshotProvider({...common,...change})).toThrow("SAS_AUTHENTICATED_REQUEST_REQUIRED");
});
it("system TLS cannot fall back to the laboratory access protocol",async()=>{
  const {authorization,accessToken,...request}=input(),binding={userId:randomUUID(),installationId:randomUUID(),deviceId:randomUUID()};
  expect(()=>new HttpsAuthorizationSnapshotProvider({...request,mode:"SYSTEM_TRUST",origin:"https://auth.operator-domain.co"} as never)).toThrow("SAS_APPROVED_NATIVE_AUTHENTICATOR_REQUIRED");
  const provider=new HttpsAuthorizationSnapshotProvider({...request,mode:"SYSTEM_TRUST",origin:"https://auth.operator-domain.co",
    authenticate:async()=>({authorization,"x-isolated-business-access":accessToken})});
  await expect(provider.fetch(binding)).rejects.toThrow("SAS_NATIVE_AUTHENTICATION_REJECTED"); // rejected before any DNS/network access
});
it("does not expose native authentication diagnostics through provider errors",async()=>{
  const {authorization:_authorization,accessToken:_access,...request}=input();
  const provider=new HttpsAuthorizationSnapshotProvider({...request,mode:"SYSTEM_TRUST",origin:"https://auth.operator-domain.co",
    authenticate:async()=>{throw Error("private-native-diagnostic");}});
  await expect(provider.fetch({userId:randomUUID(),installationId:randomUUID(),deviceId:randomUUID()})).rejects.toThrow("SAS_NATIVE_AUTHENTICATOR_UNAVAILABLE");
});
it("rejects SSA material aliased as SAS, private keys and reused key IDs",()=>{
  const ssa=generateKeyPairSync("ed25519"),sas=generateKeyPairSync("ed25519"),session=new Map([["SSA_KEY",{key:ssa.publicKey,status:"ACTIVE" as const}]]);
  for(const [id,key] of [["SAS_KEY",ssa.publicKey],["SSA_KEY",sas.publicKey],["SAS_KEY",sas.privateKey]] as const)
    expect(()=>assertAuthorizationTrustSeparated(new Map([[id,{key,status:"ACTIVE"}]]),session)).toThrow("AUTHORIZATION_TRUST_PURPOSE_SEPARATION_REQUIRED");
  expect(()=>assertAuthorizationTrustSeparated(new Map([["SAS_KEY",{key:sas.publicKey,status:"VERIFY_ONLY"}]]),session)).not.toThrow();
});
