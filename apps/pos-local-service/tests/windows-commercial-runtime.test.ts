import {createHash,generateKeyPairSync,sign} from "node:crypto";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach,it,expect,vi} from "vitest";
import {NativeCommercialHttps} from "../src/security/native-commercial-https.js";
import {readWindowsCommercialConfiguration} from "../src/security/windows-commercial-runtime.js";
import {canonicalSessionTrustJson} from "@pos-platform/contracts";
const registration={clientId:"WINDOWS_FIXTURE",platform:"ELECTRON" as const,redirectUri:"http://127.0.0.1:42133/callback",authorizationOrigin:"https://auth.fixture-commercial.co"};
afterEach(()=>vi.unstubAllGlobals());
it("deployment transport fixes HTTPS target headers redirects and total cancellation deadline",async()=>{
  const fetcher=vi.fn().mockResolvedValue(new Response('{"status":"TEST_RESPONSE"}',{headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}}));vi.stubGlobal("fetch",fetcher);
  expect(await new NativeCommercialHttps(registration,1000).post("/v1/commercial/token","{}",{},new AbortController().signal)).toEqual({status:"TEST_RESPONSE"});
  const [url,options]=fetcher.mock.calls[0]!;expect(url.href).toBe(registration.authorizationOrigin+"/v1/commercial/token");
  expect(options).toMatchObject({redirect:"error",cache:"no-store",method:"POST"});expect(options.signal).toBeInstanceOf(AbortSignal);
});
it.each(["route","host header","oversized","redirect","compression"])("deployment transport rejects %s",async target=>{
  const fetcher=vi.fn().mockResolvedValue(new Response('{}',{status:target==="redirect"?302:200,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store",...(target==="compression"?{"content-encoding":"gzip"}:{})}}));vi.stubGlobal("fetch",fetcher);
  await expect(new NativeCommercialHttps(registration,1000).post(target==="route"?"/other" as never:"/v1/commercial/token",target==="oversized"?"x".repeat(16385):"{}",target==="host header"?{host:"other"}:{},new AbortController().signal)).rejects.toThrow();
});
it("deployment provisioning requires recipient origin real profile explicit times and matching root pin",()=>{
  const dir=mkdtempSync(join(tmpdir(),"camacho-deployment-config-")),file=join(dir,"config.json"),root=generateKeyPairSync("ed25519"),op=generateKeyPairSync("ed25519");
  const claims={key_id:"DEV_FIXTURE",key_purpose:"DEVICE_TRUST",public_key_pem:op.publicKey.export({type:"spki",format:"pem"}).toString(),status:"ACTIVE",valid_from:new Date(Date.now()-1000).toISOString(),version:1};
  const value={profile:"CAMACHO_WINDOWS_COMMERCIAL_V2",environment:"PREPRODUCTION",registration,rp_id:"auth.fixture-commercial.co",webauthn_origin:registration.authorizationOrigin,audience:"FIXTURE_ACCESS",request_timeout_ms:1000,attempt_lifetime_ms:2000,maximum_retention_ms:3000,
    renewal_interval_ms:1000,renewal_before_expiry_ms:2000,
    device_trust_root_public_key_pem:root.publicKey.export({type:"spki",format:"pem"}).toString(),device_trust_root_spki_sha256:createHash("sha256").update(root.publicKey.export({type:"spki",format:"der"})).digest("hex"),
    device_trust_operational_keys:[{claims,signature:sign(null,Buffer.from(canonicalSessionTrustJson(claims)),root.privateKey).toString("base64url")}]};
  const write=(v:unknown)=>writeFileSync(file,JSON.stringify(v));
  try{
    write(value);expect(readWindowsCommercialConfiguration(file,registration.authorizationOrigin).environment).toBe("PREPRODUCTION");
    expect(()=>readWindowsCommercialConfiguration(file,"https://other.fixture-commercial.co")).toThrow("COMMERCIAL_CENTRAL_ORIGIN_MISMATCH");
    write({...value,request_timeout_ms:undefined});expect(()=>readWindowsCommercialConfiguration(file,registration.authorizationOrigin)).toThrow();
    write({...value,device_trust_root_spki_sha256:"0".repeat(64)});expect(()=>readWindowsCommercialConfiguration(file,registration.authorizationOrigin)).toThrow("COMMERCIAL_PROVISIONED_ROOT_REJECTED");
    expect(()=>new NativeCommercialHttps({...registration,authorizationOrigin:"https://business.example.test"},1000)).toThrow();
  }finally{rmSync(dir,{recursive:true,force:true});}
});
