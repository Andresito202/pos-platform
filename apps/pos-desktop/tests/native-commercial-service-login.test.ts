import {createServer} from "node:http";
import {randomBytes} from "node:crypto";
import {it,expect} from "vitest";
import {beginServiceBackedNativeLogin} from "../src/native-commercial-service-login.js";
import {NativeBusinessCredentialVault} from "../src/native-business-login.js";
import {ChannelBridge} from "../src/channel-bridge.js";

async function setup(options:{hold?:boolean;wrongCorrelation?:boolean;wrongAttempt?:boolean}={}){
  const server=createServer();await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));const address=server.address();
  if(!address||typeof address==="string")throw Error("PORT_REQUIRED");await new Promise<void>(r=>server.close(()=>r()));
  const registration={clientId:"desktop",authorizationOrigin:"https://business.example.test",redirectUri:`http://127.0.0.1:${address.port}/callback`};
  const id=randomBytes(32).toString("base64url"),selector=randomBytes(32).toString("base64url"),calls:string[]=[];
  let closed=false,state="",release:()=>void=()=>undefined;
  const channel={close:async()=>{closed=true;},request:async(input:unknown)=>{
    const r=input as {message_type:string;request_id:string;correlation_id:string;payload:{state:string}};calls.push(r.message_type);
    if(r.message_type==="commercial.native.begin")state=r.payload.state;
    if(options.hold&&r.message_type==="commercial.native.complete")await new Promise<void>(resolve=>{release=resolve;});
    const outcome=r.message_type==="commercial.native.begin"?"PREPARED":r.message_type==="commercial.native.complete"?"VERIFIED":"ACTIVATED";
    return {protocol_version:"1.0.0",request_id:options.wrongCorrelation?"018f0000-0000-7000-8000-000000000001":r.request_id,correlation_id:r.correlation_id,
      operation_id:null,status:"SUCCEEDED",result_code:outcome,result_schema_version:"1.0.0",error:null,server_time:new Date().toISOString(),
      result:{outcome,attempt_id:options.wrongAttempt&&outcome==="VERIFIED"?randomBytes(32).toString("base64url"):id,authorization_url:outcome==="PREPARED"?registration.authorizationOrigin+"/v1/commercial/login?request="+selector:null}};
  }};
  const vault=new NativeBusinessCredentialVault({isEncryptionAvailable:()=>true,
    encryptString:()=>{throw Error("TOKENS_MUST_NOT_REACH_MAIN");},decryptString:()=>{throw Error("TOKENS_MUST_NOT_REACH_MAIN");}});
  const attempt=await beginServiceBackedNativeLogin({channel,registration,vault,timeoutMs:2000,
    openSystemBrowser:async()=>{void fetch(registration.redirectUri+"?code=authorized-code-fixture&state="+state);}});
  return {attempt,calls,vault,channel,release:()=>release(),closed:()=>closed};
}
it("main reuses the actual loopback/PKCE flow and receives activation only, never credentials",async()=>{
  const f=await setup();expect(await f.attempt.result).toBe("SESSION_ACTIVATED");
  expect(f.calls).toEqual(["commercial.native.begin","commercial.native.complete","commercial.native.commit"]);
  expect(await f.vault.use(async()=>true)).toBeNull();expect(f.closed()).toBe(true);
});
it("cancelling during redemption closes the dedicated channel and cannot issue commit",async()=>{
  const f=await setup({hold:true});for(let i=0;i<100&&!f.calls.includes("commercial.native.complete");i++)await new Promise(r=>setTimeout(r,10));
  expect(f.calls).toContain("commercial.native.complete");f.attempt.cancel();f.release();
  expect(await f.attempt.result).toBe("CANCELLED");await new Promise(r=>setTimeout(r,10));
  expect(f.closed()).toBe(true);expect(f.calls).not.toContain("commercial.native.commit");
});
it("a mismatched service correlation closes the attempt without opening a browser",async()=>{
  const f=await setup({wrongCorrelation:true});expect(await f.attempt.result).toBe("FAILED");expect(f.calls).toEqual(["commercial.native.begin"]);
});
it("a response for another attempt cannot commit local activation",async()=>{
  const f=await setup({wrongAttempt:true});expect(await f.attempt.result).toBe("FAILED");expect(f.calls).not.toContain("commercial.native.commit");
});
it.each(["begin","complete","commit","cancel"])("renderer cannot invoke privileged native %s",async operation=>{
  let reached=false;const bridge=new ChannelBridge({request:async()=>{reached=true;},close:async()=>undefined});
  await expect(bridge.handleInvoke("pos:commercial.native."+operation,{message_type:"commercial.native."+operation})).rejects.toThrow("IPC channel not allowed");
  await expect(bridge.handleInvoke("pos:session.recover",{message_type:"commercial.native."+operation})).rejects.toThrow("does not match");expect(reached).toBe(false);
});
