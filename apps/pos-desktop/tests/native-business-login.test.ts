import {createServer} from "node:http";
import {randomBytes,createCipheriv,createDecipheriv,createHash} from "node:crypto";
import {describe,it,expect} from "vitest";
import {NativeBusinessCredentialVault,beginNativeBusinessLogin} from "../src/native-business-login.js";

// Test-only protection adapter; Windows DPAPI is verified separately in Electron.
function vault(){
  const key=randomBytes(32);
  return new NativeBusinessCredentialVault({isEncryptionAvailable:()=>true,
    encryptString:value=>{const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key,iv);const data=Buffer.concat([cipher.update(value),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]);},
    decryptString:value=>{const decipher=createDecipheriv("aes-256-gcm",key,value.subarray(0,12));decipher.setAuthTag(value.subarray(12,28));return Buffer.concat([decipher.update(value.subarray(28)),decipher.final()]).toString();},
  });
}
async function registration(){
  const socket=createServer();await new Promise<void>(resolve=>socket.listen(0,"127.0.0.1",resolve));
  const address=socket.address();if(!address||typeof address==="string")throw Error("FIXTURE_PORT_MISSING");
  await new Promise<void>((resolve,reject)=>socket.close(error=>error?reject(error):resolve()));
  return {clientId:"desktop",authorizationOrigin:"https://business.example.test",redirectUri:`http://127.0.0.1:${address.port}/callback`};
}
const credentials=()=>({accessToken:Array.from({length:3},()=>randomBytes(24).toString("base64url")).join("."),refreshToken:randomBytes(48).toString("base64url")});
describe("privileged native BUSINESS callback transport",()=>{
  it("receives an exact loopback return once and exchanges with the original S256 verifier",async()=>{
    const r=await registration(),store=vault();let opened:URL|undefined,calls=0;
    const pending=await beginNativeBusinessLogin({registration:r,timeoutMs:2000,vault:store,
      openSystemBrowser:async url=>{opened=new URL(url);},
      exchange:async(client,input)=>{calls++;expect(client).toEqual(r);expect(input.state).toBe(opened!.searchParams.get("state"));
        expect(createHash("sha256").update(input.verifier).digest("base64url")).toBe(opened!.searchParams.get("code_challenge"));return credentials();},
    });
    try{
      expect(opened!.origin).toBe(r.authorizationOrigin);expect(opened!.searchParams.get("code_challenge_method")).toBe("S256");
      expect(opened!.searchParams.has("code_verifier")).toBe(false);
      const callback=r.redirectUri+"?code="+"c".repeat(64)+"&state="+opened!.searchParams.get("state");
      const response=await fetch(callback);expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await pending.result).toBe("CREDENTIALS_STORED");expect(calls).toBe(1);
      expect(await store.use(async tokens=>tokens.refreshToken.length)).toBe(64);
      await expect(fetch(callback)).rejects.toThrow();
      store.clear();expect(await store.use(async()=>true)).toBeNull();
    }finally{pending.cancel();store.clear();}
  });
  it("rejects wrong duplicate state extra parameters and paths without redeeming a code",async()=>{
    const r=await registration(),store=vault();let opened:URL|undefined,calls=0;
    const pending=await beginNativeBusinessLogin({registration:r,timeoutMs:2000,vault:store,openSystemBrowser:async url=>{opened=new URL(url);},exchange:async()=>{calls++;return credentials();}});
    try{
      const state=opened!.searchParams.get("state")!;
      for(const path of ["/callback?code="+"c".repeat(64)+"&state="+"x".repeat(43),
        "/callback?code="+"c".repeat(64)+"&state="+state+"&state="+state,
        "/callback?code="+"c".repeat(64)+"&state="+state+"&tenant=x",
        "/evil?code="+"c".repeat(64)+"&state="+state])expect((await fetch(new URL(path,r.redirectUri))).status).toBe(400);
      expect(calls).toBe(0);pending.cancel();expect(await pending.result).toBe("CANCELLED");
    }finally{pending.cancel();}
  });
  it("clears prior user credentials and rejects a late exchange after logout or user change",async()=>{
    const r=await registration(),store=vault();store.replace(credentials());let opened:URL|undefined,release!:(value:ReturnType<typeof credentials>)=>void;
    const pending=await beginNativeBusinessLogin({registration:r,timeoutMs:2000,vault:store,openSystemBrowser:async url=>{opened=new URL(url);},exchange:()=>new Promise(resolve=>{release=resolve;})});
    expect(await store.use(async()=>true)).toBeNull();
    const response=await fetch(r.redirectUri+"?code="+"c".repeat(64)+"&state="+opened!.searchParams.get("state"));expect(response.status).toBe(200);
    pending.cancel();release(credentials());expect(await pending.result).toBe("CANCELLED");
    await new Promise(resolve=>setImmediate(resolve));expect(await store.use(async()=>true)).toBeNull();
  });
  it("times out safely and requires new authentication after process-state loss",async()=>{
    const store=vault(),r=await registration();
    const pending=await beginNativeBusinessLogin({registration:r,timeoutMs:40,vault:store,openSystemBrowser:async()=>{},exchange:async()=>credentials()});
    expect(await pending.result).toBe("CANCELLED");expect(await store.use(async()=>true)).toBeNull();
    expect(await vault().use(async()=>true)).toBeNull();
    expect(()=>new NativeBusinessCredentialVault({isEncryptionAvailable:()=>false,encryptString:()=>Buffer.alloc(0),decryptString:()=>""})).toThrow("OS_CUSTODY_UNAVAILABLE");
  });
  it("cannot overwrite a new user's credentials when an older exchange completes late",async()=>{
    const r=await registration(),store=vault();let firstUrl:URL|undefined,secondUrl:URL|undefined,release!:(value:ReturnType<typeof credentials>)=>void;
    const first=await beginNativeBusinessLogin({registration:r,timeoutMs:2000,vault:store,openSystemBrowser:async url=>{firstUrl=new URL(url);},exchange:()=>new Promise(resolve=>{release=resolve;})});
    await fetch(r.redirectUri+"?code="+"c".repeat(64)+"&state="+firstUrl!.searchParams.get("state"));
    const next=credentials();
    const second=await beginNativeBusinessLogin({registration:r,timeoutMs:2000,vault:store,openSystemBrowser:async url=>{secondUrl=new URL(url);},exchange:async()=>next});
    try{
      await fetch(r.redirectUri+"?code="+"d".repeat(64)+"&state="+secondUrl!.searchParams.get("state"));
      expect(await second.result).toBe("CREDENTIALS_STORED");release(credentials());expect(await first.result).toBe("CANCELLED");
      expect(await store.use(async tokens=>tokens.refreshToken===next.refreshToken)).toBe(true);
    }finally{first.cancel();second.cancel();store.clear();}
  });
  it("fails closed when callback port is occupied or browser launch fails",async()=>{
    const r=await registration(),occupied=createServer();await new Promise<void>(resolve=>occupied.listen(Number(new URL(r.redirectUri).port),"127.0.0.1",resolve));
    try{const pending=await beginNativeBusinessLogin({registration:r,timeoutMs:1000,vault:vault(),openSystemBrowser:async()=>{throw Error("must not open");},exchange:async()=>credentials()});expect(await pending.result).toBe("FAILED");}
    finally{await new Promise<void>(resolve=>occupied.close(()=>resolve()));}
    const pending=await beginNativeBusinessLogin({registration:r,timeoutMs:1000,vault:vault(),openSystemBrowser:async()=>{throw Error("browser unavailable");},exchange:async()=>credentials()});expect(await pending.result).toBe("FAILED");
  });
});
