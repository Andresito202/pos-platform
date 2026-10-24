import {createHash,randomBytes} from "node:crypto";
import {NativeCommercialRequestSchema,NativeCommercialResponseSchema,validateNativeClientRegistration,UuidSchema,
  SignedSessionAssertionSchema,SignedAuthorizationSnapshotSchema,uuidV7,type NativeClientRegistration,type NativeCommercialRequest} from "@pos-platform/contracts";
import type {CommercialComponent} from "../commercial/commercial-component.js";
import {CommercialDeviceCredentialProvider} from "./commercial-device-credential.js";

export type NativeCentralPath="/v1/commercial/native-request-challenges"|"/v1/commercial/native-requests"|
  "/v1/commercial/token"|"/v1/business-session/assertions"|"/v1/business-session/authorization";
export interface NativeCommercialCentralTransport {
  post(path:NativeCentralPath,body:string,headers:Readonly<Record<string,string>>,signal:AbortSignal):Promise<unknown>;
}
type Attempt={id:string;challenge:string;state:string;credentialId:string;expires:number;phase:"PREPARING"|"CALLBACK"|"CONSUMING"|"VERIFIED";
  abort:AbortController;seen:Set<string>;artifacts?:{ssa:unknown;sas:unknown}};

/** Connection identity is supplied ONLY by the authenticated channel server.
 * Main supplies PKCE and callback data, never routes, bodies, credentials or grants.
 * No production mount until deployment policies and provisioning are approved.
 */
export class NativeCommercialCoordinator {
  private readonly attempts=new Map<string,Attempt>();
  private readonly registration:NativeClientRegistration;
  constructor(private readonly signer:CommercialDeviceCredentialProvider,registration:NativeClientRegistration,
    private readonly transport:NativeCommercialCentralTransport,private readonly commercial:CommercialComponent,
    private readonly policy:Readonly<{mode:"ISOLATED_VALIDATION";attemptLifetimeMs:number}>,private readonly now=()=>Date.now()){
    if(!(signer instanceof CommercialDeviceCredentialProvider)||policy.mode!=="ISOLATED_VALIDATION"||
      !Number.isSafeInteger(policy.attemptLifetimeMs)||policy.attemptLifetimeMs<=0)throw Error("NATIVE_COORDINATOR_POLICY_REQUIRED");
    this.registration=validateNativeClientRegistration(registration);
    if(this.registration.platform==="ANDROID")throw Error("NATIVE_WINDOWS_REGISTRATION_REQUIRED");
  }
  release(connectionId:string){const a=this.attempts.get(connectionId);this.attempts.delete(connectionId);a?.abort.abort();}
  stop(){for(const id of this.attempts.keys())this.release(id);}
  async handle(raw:unknown,connectionId:string,signal:AbortSignal){
    const r=NativeCommercialRequestSchema.parse(raw);
    const reply=(outcome:"PREPARED"|"VERIFIED"|"ACTIVATED"|"CANCELLED"|"DENIED",id:string|null=null,url:string|null=null)=>NativeCommercialResponseSchema.parse({
      protocol_version:r.protocol_version,request_id:r.request_id,correlation_id:r.correlation_id,operation_id:null,
      status:outcome==="DENIED"?"REJECTED":"SUCCEEDED",result_code:outcome,result_schema_version:"1.0.0",server_time:new Date(this.now()).toISOString(),
      error:outcome==="DENIED"?{code:"NATIVE_COMMERCIAL_DENIED",category:"AUTHORIZATION",retryable:false,user_message_key:"native.commercial.denied",
        field_errors:[],current_version:null,required_action:null,diagnostic_id:uuidV7()}:null,result:{outcome,attempt_id:id,authorization_url:url}});
    let current:Attempt|undefined;
    try{
      if(!connectionId||signal.aborted)throw Error("NATIVE_CHANNEL_REQUIRED");
      if(r.message_type==="commercial.native.begin"){
        const prior=this.attempts.get(connectionId);if(prior&&prior.expires>this.now())throw Error("NATIVE_ATTEMPT_EXISTS");
        this.release(connectionId);this.commercial.bindings.release(connectionId);
        current={id:randomBytes(32).toString("base64url"),challenge:r.payload.code_challenge,state:r.payload.state,
          credentialId:this.signer.requireVerifiedCredentialId(),expires:this.now()+this.policy.attemptLifetimeMs,
          phase:"PREPARING",abort:new AbortController(),seen:new Set([r.request_id])};
        this.attempts.set(connectionId,current);
        const parameters={client_id:this.registration.clientId,redirect_uri:this.registration.redirectUri,
          code_challenge:current.challenge,code_challenge_method:"S256",state:current.state};
        const challenge=await this.post("/v1/commercial/native-request-challenges",parameters,r,current,connectionId,signal,false) as {challenge_id:string;challenge:string;expires_at:string};
        UuidSchema.parse(challenge.challenge_id);
        if(!/^[A-Za-z0-9_-]{43}$/.test(challenge.challenge)||!(Date.parse(challenge.expires_at)>this.now()))throw Error("NATIVE_CHALLENGE_INVALID");
        const bound=await this.post("/v1/commercial/native-requests",{purpose:"BUSINESS_NATIVE_AUTHORIZATION_V1",...parameters,
          challenge_id:challenge.challenge_id,challenge:challenge.challenge},r,current,connectionId,signal) as {authorization_url:string;expires_at:string};
        const url=new URL(bound.authorization_url);
        if(url.origin!==this.registration.authorizationOrigin||url.pathname!=="/v1/commercial/login"||url.username||url.password||url.hash||
          [...url.searchParams].length!==1||!/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get("request")??""))throw Error("NATIVE_DESTINATION_REJECTED");
        current.expires=Math.min(current.expires,Date.parse(bound.expires_at));this.live(current,connectionId,signal);
        current.phase="CALLBACK";return reply("PREPARED",current.id,url.href);
      }
      current=this.attempts.get(connectionId);
      if(!current||r.payload.attempt_id!==current.id){current=undefined;throw Error("NATIVE_ATTEMPT_MISMATCH");}
      this.live(current,connectionId,signal);
      if(current.seen.has(r.request_id))throw Error("NATIVE_OPERATION_REPLAY");current.seen.add(r.request_id);
      if(r.message_type==="commercial.native.cancel"){this.release(connectionId);return reply("CANCELLED");}
      if(r.message_type==="commercial.native.commit"){
        if(current.phase!=="VERIFIED"||!current.artifacts)throw Error("NATIVE_COMMIT_NOT_READY");
        if(this.signer.requireVerifiedCredentialId()!==current.credentialId)throw Error("NATIVE_CREDENTIAL_CHANGED");
        this.commercial.activateNativeAuthorization(current.artifacts.ssa,current.artifacts.sas,connectionId);
        this.release(connectionId);return reply("ACTIVATED");
      }
      if(current.phase!=="CALLBACK"||r.payload.state!==current.state||
        createHash("sha256").update(r.payload.code_verifier).digest("base64url")!==current.challenge)throw Error("NATIVE_PKCE_REJECTED");
      current.phase="CONSUMING";
      // Credentials live only for this call. No refresh transport/retention policy
      // is inferred; neither tokens nor SSA/SAS cross back to main or renderer.
      const tokens=await this.post("/v1/commercial/token",{grant_type:"authorization_code",code:r.payload.code,code_verifier:r.payload.code_verifier,
        state:current.state,client_id:this.registration.clientId,redirect_uri:this.registration.redirectUri},r,current,connectionId,signal) as {accessToken:string;refreshToken:string};
      if(!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(tokens.accessToken)||tokens.accessToken.length>8192||!/^[A-Za-z0-9_-]{64}$/.test(tokens.refreshToken))throw Error("NATIVE_CREDENTIALS_REJECTED");
      // sid is only a request selector from the exact Central response. Central
      // verifies access/possession; only signed SSA/SAS can authorize local state.
      const sid=UuidSchema.parse((JSON.parse(Buffer.from(tokens.accessToken.split(".")[1]!,"base64url").toString()) as {sid:unknown}).sid);
      const ssa=SignedSessionAssertionSchema.parse(await this.post("/v1/business-session/assertions",{session_id:sid},r,current,connectionId,signal,true,tokens.accessToken));
      if(ssa.claims.session_id!==sid)throw Error("NATIVE_SESSION_MISMATCH");
      const sas=SignedAuthorizationSnapshotSchema.parse(await this.post("/v1/business-session/authorization",{session_id:sid},r,current,connectionId,signal,true,tokens.accessToken));
      this.live(current,connectionId,signal);
      if(this.signer.requireVerifiedCredentialId()!==current.credentialId)throw Error("NATIVE_CREDENTIAL_CHANGED");
      this.commercial.verifyNativeAuthorization(ssa,sas);
      current.artifacts={ssa,sas};current.phase="VERIFIED";return reply("VERIFIED",current.id);
    }catch{
      // Do not let a request for a different attempt cancel a valid owner lease.
      if(current&&this.attempts.get(connectionId)===current)this.release(connectionId);
      return reply("DENIED");
    }
  }
  private live(a:Attempt,id:string,signal:AbortSignal){
    if(signal.aborted||a.abort.signal.aborted||this.attempts.get(id)!==a||!Number.isFinite(a.expires)||this.now()>=a.expires)throw Error("NATIVE_ATTEMPT_INACTIVE");
  }
  private async post(path:NativeCentralPath,payload:unknown,r:NativeCommercialRequest,a:Attempt,id:string,signal:AbortSignal,signed=true,access?:string){
    this.live(a,id,signal);
    if(this.signer.requireVerifiedCredentialId()!==a.credentialId)throw Error("NATIVE_CREDENTIAL_CHANGED");
    const body=JSON.stringify(payload),headers:Record<string,string>={"x-request-id":r.request_id,"x-correlation-id":r.correlation_id};
    // Every Central operation needs its own ledger request id as well as nonce.
    headers["x-request-id"]=uuidV7();
    if(signed)headers.authorization=await this.signer.authorization({method:"POST",path,body,requestId:headers["x-request-id"]!,correlationId:r.correlation_id});
    if(access)headers["x-isolated-business-access"]=access;
    const result=await this.transport.post(path,body,headers,AbortSignal.any([signal,a.abort.signal]));this.live(a,id,signal);return result;
  }
}
