import {createHash,randomBytes} from "node:crypto";
import {NativeCommercialRequestSchema,NativeCommercialResponseSchema,validateNativeClientRegistration,UuidSchema,
  SignedSessionAssertionSchema,SignedAuthorizationSnapshotSchema,CommercialAccessClaimsSchema,uuidV7,type NativeClientRegistration,type NativeCommercialRequest} from "@pos-platform/contracts";
import {EncryptedFileSecretStore} from "./encrypted-secret-store.js";
import type {CommercialComponent} from "../commercial/commercial-component.js";
import {CommercialDeviceCredentialProvider} from "./commercial-device-credential.js";

export type NativeCentralPath="/v1/commercial/native-request-challenges"|"/v1/commercial/native-requests"|
  "/v1/commercial/token"|"/v1/commercial/refresh"|"/v1/business-session/assertions"|"/v1/business-session/authorization";
export interface NativeCommercialCentralTransport {
  post(path:NativeCentralPath,body:string,headers:Readonly<Record<string,string>>,signal:AbortSignal):Promise<unknown>;
}
type Attempt={id:string;challenge:string;state:string;credentialId:string;expires:number;phase:"PREPARING"|"CALLBACK"|"CONSUMING"|"VERIFIED";
  abort:AbortController;seen:Set<string>;artifacts?:{ssa:unknown;sas:unknown};tokens?:{accessToken:string;refreshToken:string}};

/** Connection identity is supplied ONLY by the authenticated channel server.
 * Main supplies PKCE and callback data, never routes, bodies, credentials or grants.
 * No production mount until deployment policies and provisioning are approved.
 */
export class NativeCommercialCoordinator {
  private readonly attempts=new Map<string,Attempt>();
  private readonly registration:NativeClientRegistration;
  constructor(private readonly signer:CommercialDeviceCredentialProvider,registration:NativeClientRegistration,
    private readonly transport:NativeCommercialCentralTransport,private readonly commercial:CommercialComponent,
    private readonly policy:Readonly<{mode:"ISOLATED_VALIDATION";attemptLifetimeMs:number;accessV2?:Readonly<{audience:string}>}>,private readonly now=()=>Date.now(),
    private readonly custody?:Readonly<{store:EncryptedFileSecretStore;maximumRetentionMs:number}>){
    if(!(signer instanceof CommercialDeviceCredentialProvider)||policy.mode!=="ISOLATED_VALIDATION"||
      !Number.isSafeInteger(policy.attemptLifetimeMs)||policy.attemptLifetimeMs<=0)throw Error("NATIVE_COORDINATOR_POLICY_REQUIRED");
    this.registration=validateNativeClientRegistration(registration);
    if(policy.accessV2&&(!policy.accessV2.audience||policy.accessV2.audience.length>128))throw Error("NATIVE_ACCESS_V2_POLICY_REQUIRED");
    if(custody&&(!policy.accessV2||!(custody.store instanceof EncryptedFileSecretStore)||custody.store.protection!=="OS_BOUND"||
      !Number.isSafeInteger(custody.maximumRetentionMs)||custody.maximumRetentionMs<=0))throw Error("NATIVE_TOKEN_CUSTODY_POLICY_REQUIRED");
    if(custody)this.custody=Object.freeze({...custody});
    this.policy=Object.freeze({...policy,...(policy.accessV2?{accessV2:Object.freeze({...policy.accessV2})}:{})});
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
        this.release(connectionId);this.commercial.bindings.release(connectionId);this.clearCredentials();
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
        this.retainAndActivate(current,connectionId);
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
      current.artifacts={ssa,sas};if(this.custody)current.tokens=tokens;current.phase="VERIFIED";return reply("VERIFIED",current.id);
    }catch{
      // Do not let a request for a different attempt cancel a valid owner lease.
      if(current&&this.attempts.get(connectionId)===current)this.release(connectionId);
      return reply("DENIED");
    }
  }
  private clearCredentials(){this.custody?.store.write("commercial-credentials-v2",Buffer.from('{"state":"CLOSED"}'));}
  private retainAndActivate(a:Attempt,connectionId:string,retainedUntil=this.now()+(this.custody?.maximumRetentionMs??0)){
    if(!a.artifacts)throw Error("NATIVE_ARTIFACTS_REQUIRED");
    const {ssa,sas}=this.commercial.verifyNativeAuthorization(a.artifacts.ssa,a.artifacts.sas);
    if(this.custody){
      if(!a.tokens||!this.policy.accessV2)throw Error("NATIVE_TOKEN_CUSTODY_REQUIRED");
      const claims=CommercialAccessClaimsSchema.parse(JSON.parse(Buffer.from(a.tokens.accessToken.split(".")[1]??"","base64url").toString()));
      if(claims.sid!==ssa.claims.session_id||claims.sub!==ssa.claims.user_id||claims.cid!==a.credentialId||claims.client_id!==this.registration.clientId||
        claims.iss!==this.registration.authorizationOrigin||claims.aud!==this.policy.accessV2.audience)throw Error("NATIVE_TOKEN_ARTIFACT_BINDING_REJECTED");
      const bytes=Buffer.from(JSON.stringify({state:"READY",...a.tokens,retainedUntil,credentialId:a.credentialId,ssa,sas}));
      try{this.custody.store.write("commercial-credentials-v2",bytes);}finally{bytes.fill(0);}
    }
    try{this.commercial.activateNativeAuthorization(ssa,sas,connectionId);}catch(error){this.clearCredentials();throw error;}
  }
  /** Service-owned renewal hook. No token/signing API is exposed over IPC.
   * A durable claim burns the old refresh before network I/O: uncertain delivery
   * or process loss requires fresh login rather than retrying a consumed token. */
  async renewAuthorization(connectionId:string,signal:AbortSignal):Promise<boolean>{
    if(!this.custody||!this.policy.accessV2||signal.aborted||this.attempts.has(connectionId))return false;
    const bound=this.commercial.bindings.resolve(connectionId);if(!bound)return false;
    let a:Attempt|undefined;
    try{
      if(!this.custody.store.has("commercial-credentials-v2"))return false;
      const bytes=this.custody.store.read("commercial-credentials-v2");let saved;
      try{saved=JSON.parse(bytes.toString("utf8"));}finally{bytes.fill(0);}
      if(saved.state!=="READY"||!Number.isSafeInteger(saved.retainedUntil)||saved.retainedUntil<=this.now()||
        saved.retainedUntil>this.now()+this.custody.maximumRetentionMs||saved.credentialId!==this.signer.requireVerifiedCredentialId()||
        !/^[A-Za-z0-9_-]{64}$/.test(saved.refreshToken))throw Error("NATIVE_STORED_CREDENTIALS_REJECTED");
      const checked=this.commercial.verifyNativeAuthorization(saved.ssa,saved.sas),s=checked.ssa.claims;
      const local=this.commercial.sessionStore.loadActiveByDevice(s.installation_id,s.device_id);
      const snapshot=this.commercial.authorizationStore.loadActive(checked.binding);
      if(local.kind!=="FOUND"||local.session.claims.session_id!==s.session_id||local.session.claims.sequence!==s.sequence||
        !snapshot||snapshot.claims.sequence!==checked.sas.claims.sequence||bound.ssaSessionId!==s.session_id||bound.userId!==s.user_id)throw Error("NATIVE_CUSTODY_COMMIT_REQUIRED");
      a={id:randomBytes(32).toString("base64url"),challenge:"",state:"",credentialId:saved.credentialId,expires:this.now()+this.policy.attemptLifetimeMs,
        phase:"CONSUMING",abort:new AbortController(),seen:new Set()};this.attempts.set(connectionId,a);
      this.clearCredentials();
      const body=JSON.stringify({grant_type:"refresh_token",client_id:this.registration.clientId,refresh_token:saved.refreshToken}),requestId=uuidV7(),correlationId=uuidV7();
      const authorization=await this.signer.refreshPossession({origin:this.registration.authorizationOrigin,audience:this.policy.accessV2.audience,
        clientId:this.registration.clientId,token:saved.refreshToken,body,requestId,correlationId});
      const result=await this.transport.post("/v1/commercial/refresh",body,{authorization,"x-request-id":requestId,"x-correlation-id":correlationId},AbortSignal.any([signal,a.abort.signal])) as {status:string;access:string;refreshToken:string};
      this.live(a,connectionId,signal);
      if(result.status!=="ROTATED"||typeof result.access!=="string"||result.access.length>8192||!/^\S+\.\S+\.\S+$/.test(result.access)||
        !/^[A-Za-z0-9_-]{64}$/.test(result.refreshToken))throw Error("NATIVE_REFRESH_REJECTED");
      a.tokens={accessToken:result.access,refreshToken:result.refreshToken};
      const r={request_id:uuidV7(),correlation_id:correlationId};
      const ssa=await this.post("/v1/business-session/assertions",{session_id:s.session_id},r,a,connectionId,signal,true,result.access);
      const sas=await this.post("/v1/business-session/authorization",{session_id:s.session_id},r,a,connectionId,signal,true,result.access);
      this.live(a,connectionId,signal);a.artifacts={ssa,sas};this.retainAndActivate(a,connectionId,saved.retainedUntil);return true;
    }catch{if(!a||this.attempts.get(connectionId)===a){this.clearCredentials();this.commercial.bindings.release(connectionId);}return false;}
    finally{if(a&&this.attempts.get(connectionId)===a)this.release(connectionId);}
  }
  private live(a:Attempt,id:string,signal:AbortSignal){
    if(signal.aborted||a.abort.signal.aborted||this.attempts.get(id)!==a||!Number.isFinite(a.expires)||this.now()>=a.expires)throw Error("NATIVE_ATTEMPT_INACTIVE");
  }
  private async post(path:NativeCentralPath,payload:unknown,r:Pick<NativeCommercialRequest,"request_id"|"correlation_id">,a:Attempt,id:string,signal:AbortSignal,signed=true,access?:string){
    this.live(a,id,signal);
    if(this.signer.requireVerifiedCredentialId()!==a.credentialId)throw Error("NATIVE_CREDENTIAL_CHANGED");
    const body=JSON.stringify(payload),headers:Record<string,string>={"x-request-id":r.request_id,"x-correlation-id":r.correlation_id};
    // Every Central operation needs its own ledger request id as well as nonce.
    headers["x-request-id"]=uuidV7();
    if(signed){
      const context={method:"POST" as const,path,body,requestId:headers["x-request-id"]!,correlationId:r.correlation_id};
      if(access&&this.policy.accessV2){
        const proof={...context,origin:this.registration.authorizationOrigin,audience:this.policy.accessV2.audience,clientId:this.registration.clientId,token:access};
        if(path==="/v1/business-session/assertions")headers.authorization=await this.signer.sessionAssertionPossession(proof);
        else if(path==="/v1/business-session/authorization")headers.authorization=await this.signer.authorizationSnapshotPossession(proof);
        else throw Error("NATIVE_ACCESS_V2_OPERATION_REJECTED");
      }else headers.authorization=await this.signer.authorization(context);
    }
    if(access)headers["x-isolated-business-access"]=access;
    const result=await this.transport.post(path,body,headers,AbortSignal.any([signal,a.abort.signal]));this.live(a,id,signal);return result;
  }
}
