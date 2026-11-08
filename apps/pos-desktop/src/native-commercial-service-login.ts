import {uuidV7,NativeCommercialResponseSchema,validateNativeClientRegistration,type NativeClientRegistration} from "@pos-platform/contracts";
import type {ServiceChannel} from "./channel-bridge.js";
import {beginNativeBusinessLogin,type NativeBusinessCredentialVault} from "./native-business-login.js";

/** Main-only consumer on a dedicated authenticated/negotiated connection.
 * Closing it cancels the server-owned attempt; no renderer IPC is registered.
 * Existing callback/state/PKCE ceremony is reused, without returning credentials.
 */
export async function beginServiceBackedNativeLogin(input:{channel:ServiceChannel;registration:NativeClientRegistration;
  vault:NativeBusinessCredentialVault;timeoutMs:number;openSystemBrowser:(url:string)=>Promise<void>}){
  let registration:NativeClientRegistration;
  try{registration=validateNativeClientRegistration(input.registration);}catch(error){await input.channel.close().catch(()=>undefined);throw error;}
  let attempt:string|undefined;
  const invoke=async(type:string,payload:unknown)=>{
    const request_id=uuidV7(),correlation_id=uuidV7();
    const response=NativeCommercialResponseSchema.parse(await input.channel.request({protocol_version:"1.0.0",message_type:type,
      request_id,correlation_id,payload_schema_version:"1.0.0",payload}));
    if(response.request_id!==request_id||response.correlation_id!==correlation_id||response.status!=="SUCCEEDED"||!response.result||response.result_code!==response.result.outcome)throw Error("NATIVE_SERVICE_DENIED");
    return response.result;
  };
  let login:Awaited<ReturnType<typeof beginNativeBusinessLogin>>;
  try{login=await beginNativeBusinessLogin({...input,registration,
    exchange:async()=>{throw Error("NATIVE_LEGACY_EXCHANGE_DISABLED");},
    prepareAuthorization:async p=>{
      if(p.client_id!==registration.clientId||p.redirect_uri!==registration.redirectUri||p.code_challenge_method!=="S256")throw Error("NATIVE_CLIENT_MISMATCH");
      const result=await invoke("commercial.native.begin",{code_challenge:p.code_challenge,state:p.state});
      if(result.outcome!=="PREPARED"||!result.attempt_id||!result.authorization_url)throw Error("NATIVE_SERVICE_NOT_PREPARED");
      attempt=result.attempt_id;return result.authorization_url;
    },
    complete:async(p,signal)=>{
      if(!attempt||signal.aborted)throw Error("NATIVE_ATTEMPT_CANCELLED");
      const ready=await invoke("commercial.native.complete",{attempt_id:attempt,code:p.code,code_verifier:p.verifier,state:p.state});
      if(ready.outcome!=="VERIFIED"||ready.attempt_id!==attempt||signal.aborted)throw Error("NATIVE_ATTEMPT_CANCELLED");
      const committed=await invoke("commercial.native.commit",{attempt_id:attempt});
      if(committed.outcome!=="ACTIVATED")throw Error("NATIVE_SERVICE_NOT_ACTIVATED");
    },
  });}catch(error){await input.channel.close().catch(()=>undefined);throw error;}
  // Also covers timeout, preparation failure and cancellation while a network
  // operation is in flight. Transport close invokes coordinator.release.
  void login.result.then(()=>input.channel.close().catch(()=>undefined));
  return Object.freeze({result:login.result,cancel:()=>{login.cancel();void input.channel.close().catch(()=>undefined);}});
}
