import {randomUUID} from "node:crypto";
import {LocalChannelAuthenticator,loadProductionDesktopProvisioning} from "@pos-platform/local-channel";
import {connectLocalServiceChannel} from "../src/local-service-channel.js";
import {activateNativeBusinessAssertion} from "../src/native-business-login.js";
import {SignedSessionAssertionSchema} from "@pos-platform/contracts";
export {uuidV7} from "@pos-platform/contracts";
export {beginServiceBackedNativeLogin} from "../src/native-commercial-service-login.js";
export {NativeBusinessCredentialVault} from "../src/native-business-login.js";
export {DesktopCommercialAccount} from "../src/commercial-account.js";

/** Test driver reuses production DPAPI + channel + main delivery; no new IPC. */
export async function openNativeServiceChannel(){
  const p=loadProductionDesktopProvisioning(),authenticator=new LocalChannelAuthenticator(p.channelSecret);
  p.channelSecret.fill(0);
  const envelope=(message_type:string,payload:unknown)=>({protocol_version:"1.0.0",message_type,request_id:randomUUID(),correlation_id:randomUUID(),payload_schema_version:"1.0.0",payload});
  const channel=await connectLocalServiceChannel({endpoint:p.endpoint,authenticator,protocolRange:{min:"1.0.0",max:"1.0.0"},
    handshake:envelope("runtime.handshake",{desktop_version:"1.0.0",service_version:"1.0.0",protocol_min:"1.0.0",protocol_max:"1.0.0",
      installation_id:p.installationId,device_id:p.deviceId,schema_version:"5",service_state:"READY"})});
  return {channel,close:async()=>{await channel.close();authenticator.destroy();}};
}
export async function inspectNativeAuthorization(){
  const {channel,close}=await openNativeServiceChannel();
  const request=(type:string,payload:unknown)=>channel.request({protocol_version:"1.0.0",message_type:type,request_id:randomUUID(),correlation_id:randomUUID(),payload_schema_version:"1.0.0",payload});
  try{return {recovery:await request("session.recover",{}),capabilities:await request("authorization.capabilities.get",{}),
    forbidden:await request("catalog.item.list",{query:"",limit:1,offset:0})};}finally{await close();}
}
export async function exerciseNativeAssertion(assertion:unknown,afterActivation?:(()=>Promise<void>)){
  const {channel,close}=await openNativeServiceChannel();
  const envelope=(message_type:string,payload:unknown)=>({protocol_version:"1.0.0",message_type,request_id:randomUUID(),correlation_id:randomUUID(),payload_schema_version:"1.0.0",payload});
  let observed;
  try{
    const parsed=SignedSessionAssertionSchema.parse(assertion);
    const invalid=await activateNativeBusinessAssertion({...parsed,signature:(parsed.signature[0]==="A"?"B":"A")+parsed.signature.slice(1)},channel);
    const activated=await activateNativeBusinessAssertion(assertion,channel);
    const replay=await activateNativeBusinessAssertion(assertion,channel);
    const recovery=await channel.request(envelope("session.recover",{})) as {result_code:string};
    if(afterActivation)await afterActivation();
    const capabilities=await channel.request(envelope("authorization.capabilities.get",{})) as {status:string;result_code:string};
    const forbidden=afterActivation?await channel.request(envelope("catalog.item.list",{query:"",limit:1,offset:0})) as {status:string;result_code:string}:undefined;
    const audit=await channel.request(envelope("audit.event.list",{query:"",action_code:null,resource_type:null,actor_type:null,from:null,to:null,limit:1,offset:0})) as {status:string;result_code:string};
    observed={invalid,activated,replay,recovered:recovery.result_code,capabilities,audit,...(forbidden?{forbidden}: {})};
  }finally{await close();}
  let channelLossRejected=false;
  try{await activateNativeBusinessAssertion(assertion,channel);}catch{channelLossRejected=true;}
  return {...observed,channelLossRejected};
}
