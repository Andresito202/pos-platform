import {lstatSync,readFileSync} from "node:fs";
import {isAbsolute} from "node:path";
import * as z from "zod";
import {uuidV7,SessionRecoverResponseSchema,NativeCommercialResponseSchema,validateWindowsCommercialRegistration,type NativeClientRegistration} from "@pos-platform/contracts";
import type {ServiceChannel} from "./channel-bridge.js";
import {beginServiceBackedNativeLogin} from "./native-commercial-service-login.js";
import type {NativeBusinessCredentialVault} from "./native-business-login.js";

const Configuration=z.strictObject({profile:z.literal("CAMACHO_WINDOWS_DESKTOP_V2"),
  registration:z.strictObject({clientId:z.string(),redirectUri:z.string(),authorizationOrigin:z.string(),platform:z.literal("ELECTRON")}),
  rp_id:z.string(),webauthn_origin:z.string(),attempt_timeout_ms:z.number().int().positive().max(2147483647),
  browser_cache:z.strictObject({maximum_cache_bytes:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),interval_ms:z.number().int().min(1000).max(2147483647)}).optional()});
/** Installer-owned public metadata only. No credential, private key, grant or
 * caller-supplied authorization is accepted by this main-process entry. */
export function readDesktopCommercialConfiguration(path:string){
  if(!isAbsolute(path))throw Error("DESKTOP_COMMERCIAL_ABSOLUTE_FILE_REQUIRED");
  const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16384)throw Error("DESKTOP_COMMERCIAL_FILE_REJECTED");
  const value=Configuration.parse(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(readFileSync(path))));
  validateWindowsCommercialRegistration(value.registration,value.rp_id,value.webauthn_origin);
  return Object.freeze({...value,registration:Object.freeze({...value.registration})});
}
export interface DesktopAccountActions{login():Promise<string>;logout():Promise<string>;stop():void;}
/** Dedicated authenticated connections; reuse existing callback/state/PKCE and
 * Service custody. Tokens and assertions never enter main, preload or React. */
export class DesktopCommercialAccount implements DesktopAccountActions{
  private active:{channel?:ServiceChannel;cancel?:()=>void;stopped:boolean}|undefined;
  constructor(private readonly configuration:{registration:NativeClientRegistration;attempt_timeout_ms:number},
    private readonly connect:()=>Promise<ServiceChannel>,private readonly vault:NativeBusinessCredentialVault,
    private readonly openSystemBrowser:(url:string)=>Promise<void>){}
  stop(){if(this.active){this.active.stopped=true;this.active.cancel?.();void this.active.channel?.close().catch(()=>undefined);}this.vault.clear();}
  private async recoverAndClose(channel:ServiceChannel){
    const request_id=uuidV7(),correlation_id=uuidV7();
    const recovered=SessionRecoverResponseSchema.parse(await channel.request({protocol_version:"1.0.0",message_type:"session.recover",request_id,correlation_id,payload_schema_version:"1.0.0",payload:{}}));
    if(recovered.request_id!==request_id||recovered.correlation_id!==correlation_id)throw Error("NATIVE_RECOVERY_CORRELATION_REJECTED");
    if(recovered.status==="SUCCEEDED"&&recovered.result_code==="NONE"&&recovered.result?.outcome==="NONE")return "NO_ACTIVE_SESSION";
    if(recovered.status!=="SUCCEEDED"||recovered.result_code!=="ACTIVE"||recovered.result?.outcome!=="ACTIVE")throw Error("NATIVE_RECOVERY_REJECTED");
    const closeId=uuidV7(),closeCorrelation=uuidV7();
    const closed=NativeCommercialResponseSchema.parse(await channel.request({protocol_version:"1.0.0",message_type:"commercial.native.logout",request_id:closeId,correlation_id:closeCorrelation,payload_schema_version:"1.0.0",payload:{}}));
    if(closed.request_id!==closeId||closed.correlation_id!==closeCorrelation||closed.status!=="SUCCEEDED"||closed.result_code!==closed.result?.outcome||
      !["SIGNED_OUT","SIGNED_OUT_LOCAL"].includes(closed.result?.outcome??""))throw Error("NATIVE_LOGOUT_REJECTED");
    return closed.result!.outcome;
  }
  private async run(login:boolean){
    if(this.active)throw Error("NATIVE_ACCOUNT_OPERATION_IN_PROGRESS");
    const lease:{channel?:ServiceChannel;cancel?:()=>void;stopped:boolean}={stopped:false};this.active=lease;
    try{
      const channel=await this.connect();lease.channel=channel;if(lease.stopped)throw Error("NATIVE_ACCOUNT_CANCELLED");
      // Changing user closes the previous verified device session first. It
      // cannot leave a hidden former cashier authorized on another connection.
      const closed=await this.recoverAndClose(channel);if(!login)return closed;
      if(lease.stopped)throw Error("NATIVE_ACCOUNT_CANCELLED");
      const attempt=await beginServiceBackedNativeLogin({channel,registration:this.configuration.registration,vault:this.vault,
        timeoutMs:this.configuration.attempt_timeout_ms,openSystemBrowser:this.openSystemBrowser});
      lease.cancel=attempt.cancel;if(lease.stopped)attempt.cancel();return await attempt.result;
    }finally{await lease.channel?.close().catch(()=>undefined);this.vault.clear();if(this.active===lease)this.active=undefined;}
  }
  login(){return this.run(true);}
  logout(){return this.run(false);}
}
