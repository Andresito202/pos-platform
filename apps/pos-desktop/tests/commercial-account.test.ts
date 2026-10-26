import {it,expect,afterEach} from "vitest";
import {createServer} from "node:net";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,dirname,resolve,basename} from "node:path";
import {randomBytes} from "node:crypto";
import {DesktopCommercialAccount,readDesktopCommercialConfiguration} from "../src/commercial-account.js";
import {NativeBusinessCredentialVault} from "../src/native-business-login.js";

const cleanup:(()=>Promise<unknown>)[]=[];afterEach(async()=>{for(const f of cleanup.splice(0).reverse())await f();});
async function fixture(active=false,offline=false){
  const probe=createServer();await new Promise<void>(r=>probe.listen(0,"127.0.0.1",r));const port=(probe.address() as {port:number}).port;await new Promise<void>(r=>probe.close(()=>r()));
  const registration={clientId:"WINDOWS_ACCOUNT_TEST",redirectUri:`http://127.0.0.1:${port}/callback`,authorizationOrigin:"https://auth.fixture-commercial.co",platform:"ELECTRON" as const};
  const calls:string[]=[],attempt=randomBytes(32).toString("base64url"),vault=new NativeBusinessCredentialVault({isEncryptionAvailable:()=>true,encryptString:()=>{throw Error("NO_TOKENS_IN_MAIN");},decryptString:()=>{throw Error("NO_TOKENS_IN_MAIN");}});
  let state="",closed=0,opened=0,wrong=false;
  const channel={close:async()=>{closed++;},request:async(value:unknown)=>{
    const r=value as {message_type:string;request_id:string;correlation_id:string;payload:{state?:string}};calls.push(r.message_type);
    const recover=r.message_type==="session.recover";
    if(r.message_type==="commercial.native.begin")state=r.payload.state!;
    const outcome=recover?(active?"ACTIVE":"NONE"):r.message_type.endsWith("logout")?(offline?"SIGNED_OUT_LOCAL":"SIGNED_OUT"):r.message_type.endsWith("begin")?"PREPARED":r.message_type.endsWith("complete")?"VERIFIED":"ACTIVATED";
    if(r.message_type.endsWith("logout"))active=false;
    const result=recover?{outcome,session_id:null,offline_valid_until:null,decision:null}:{outcome,attempt_id:attempt,authorization_url:outcome==="PREPARED"?registration.authorizationOrigin+"/v1/commercial/login?request="+randomBytes(32).toString("base64url"):null};
    return {protocol_version:"1.0.0",request_id:wrong?"018f0000-0000-7000-8000-000000000001":r.request_id,correlation_id:r.correlation_id,operation_id:null,status:"SUCCEEDED",result_code:outcome,result_schema_version:"1.0.0",server_time:new Date().toISOString(),error:null,result};
  }};
  const account=new DesktopCommercialAccount({registration,attempt_timeout_ms:3000},async()=>channel,vault,async()=>{opened++;void fetch(registration.redirectUri+"?code=authorized-account-code&state="+state);});
  cleanup.push(async()=>account.stop());return {account,calls,vault,wrong:()=>{wrong=true;},closed:()=>closed,opened:()=>opened,registration};
}
it("account entry reuses the callback and consumes activation only, then closes its channel",async()=>{
  const f=await fixture();expect(await f.account.login()).toBe("SESSION_ACTIVATED");
  expect(f.calls).toEqual(["session.recover","commercial.native.begin","commercial.native.complete","commercial.native.commit"]);
  expect(f.closed()).toBeGreaterThan(0);expect(await f.vault.use(async()=>true)).toBeNull();
});
it.each([false,true])("change user closes the recovered session first, remote failure=%s",async offline=>{
  const f=await fixture(true,offline);expect(await f.account.login()).toBe("SESSION_ACTIVATED");
  expect(f.calls.slice(0,3)).toEqual(["session.recover","commercial.native.logout","commercial.native.begin"]);
});
it("native logout preserves local-only status instead of claiming central revocation",async()=>{
  const f=await fixture(true,true);expect(await f.account.logout()).toBe("SIGNED_OUT_LOCAL");expect(f.opened()).toBe(0);
});
it("recovery correlation failure prevents login and browser navigation",async()=>{
  const f=await fixture();f.wrong();await expect(f.account.login()).rejects.toThrow("CORRELATION");expect(f.opened()).toBe(0);expect(f.closed()).toBe(1);
});
it("public desktop deployment metadata rejects relative paths, missing timeout and unapproved origin",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"camacho-desktop-config-"));cleanup.push(async()=>{if(dirname(resolve(dir))!==resolve(tmpdir())||!basename(dir).startsWith("camacho-desktop-config-"))throw Error("CLEANUP_REJECTED");await rm(dir,{recursive:true,force:true});});
  const f=await fixture(),path=join(dir,"public.json"),valid={profile:"CAMACHO_WINDOWS_DESKTOP_V2",registration:f.registration,rp_id:"auth.fixture-commercial.co",webauthn_origin:f.registration.authorizationOrigin,attempt_timeout_ms:60000};
  await writeFile(path,JSON.stringify(valid));expect(readDesktopCommercialConfiguration(path).registration).toEqual(f.registration);
  expect(()=>readDesktopCommercialConfiguration("relative.json")).toThrow("ABSOLUTE");
  const broken:{attempt_timeout_ms?:number}={...valid};delete broken.attempt_timeout_ms;await writeFile(path,JSON.stringify(broken));expect(()=>readDesktopCommercialConfiguration(path)).toThrow();
  await writeFile(path,JSON.stringify({...valid,rp_id:"localhost",webauthn_origin:"https://localhost",registration:{...f.registration,authorizationOrigin:"https://localhost"}}));expect(()=>readDesktopCommercialConfiguration(path)).toThrow();
});
