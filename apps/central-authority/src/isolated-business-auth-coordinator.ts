import type {PoolClient} from "@pos-platform/database-postgres";
import type {DeviceProofRequest} from "@pos-platform/database-postgres";
import {PlatformSecurityEventCode,uuidV7,SignedSessionAssertionOperationalKeySchema,type SignedSessionAssertionOperationalKey} from "@pos-platform/contracts";
import {PostgresPlatformSecurityEventRepository,BUSINESS_SSA_ELIGIBILITY_SQL,PostgresNativeBusinessDeviceProofVerifier,type VerifiedDeviceProofBinding} from "@pos-platform/database-postgres";
import {IsolatedNativeBusinessRequests} from "./isolated-native-business-requests.js";
import {inspectCommercialTokenRequest} from "./commercial-token-http-contract.js";
import type {KeyObject} from "node:crypto";
import {CentralSessionAssertionIssuer,type SessionAssertionIssuancePolicy} from "./central-session-assertion-issuer.js";
import {IsolatedBusinessAuditSessionGuard} from "./isolated-business-audit-session-guard.js";
import {BusinessAccessPreparation} from "./business-access-preparation.js";
import {createIsolatedCommercialBindingPrerequisite,createCommercialDeviceInspector} from "./isolated-commercial-binding-adapter.js";
import {CommercialBindingPrerequisite} from "./commercial-binding-prerequisite.js";
import {DurableBrowserSessionStore,type BrowserSessionRequest} from "./durable-browser-session-store.js";
import {IsolatedBusinessNativeCodeIssuer} from "./isolated-business-native-code-issuer.js";
import {IsolatedBusinessBoundCodeConsumer} from "./isolated-business-bound-code-consumer.js";
import {NativeAuthorizationCodeExchange} from "./native-authorization-code-exchange.js";
import type {NativeClientRegistration} from "./native-authorization-constraints.js";
import type {TrustedCommercialAudit} from "./commercial-binding-prerequisite.js";
import {validateNativeClientRegistration} from "./native-authorization-constraints.js";
import type {createPostgresPool} from "@pos-platform/database-postgres";
import {IsolatedBusinessCredentialPairIssuer} from "./isolated-business-credential-pair-issuer.js";
import type {ValidatedCommercialBinding} from "./commercial-binding-prerequisite.js";
import {IsolatedBusinessAccessTokenCodec,CommercialBusinessAccessAuthority} from "./isolated-business-access-token-codec.js";

/**
 * INTERNAL ISOLATED orchestration only. A client cannot supply a serialized
 * session reference or substitute user/device IDs for authenticated state.
 * No routes, refresh endpoints or production credential authority.
 */
export class IsolatedBusinessAuthCoordinator {
  private readonly issuer:IsolatedBusinessNativeCodeIssuer;
  private readonly consumer:IsolatedBusinessBoundCodeConsumer;
  private readonly audit:PostgresPlatformSecurityEventRepository;
  /** Internal post-exchange consumer. No new HTTP protocol or claims producer. */
  prepareSessionAssertion(accessToken:string,proof:DeviceProofRequest,codec:IsolatedBusinessAccessTokenCodec|CommercialBusinessAccessAuthority){
    return this.preparation.prepareSequenceFromAccess(accessToken,proof,codec);
  }
  /** Actual canonical SSA issuance, restricted to temporary integration DBs.
   * Host-owned laboratory material only; never accepted from an HTTP body.
   * No grants, policy assignments or authorization snapshot are produced. */
  async issueSessionAssertion(accessToken:string,proof:DeviceProofRequest,codec:IsolatedBusinessAccessTokenCodec|CommercialBusinessAccessAuthority,material:{
    mode:"ISOLATED_VALIDATION";environment:"isolated-validation";operationalPrivateKey:KeyObject;rootTrustAnchor:KeyObject;
    signedOperationalKey:SignedSessionAssertionOperationalKey;
    policy:SessionAssertionIssuancePolicy & {maximumReauthenticationAgeMs:number};
  }){
    if(material?.mode!=="ISOLATED_VALIDATION"||material.environment!=="isolated-validation"||
      ![material.policy?.maximumReauthenticationAgeMs,material.policy?.maximumClaimAgeMs,material.policy?.maximumOfflineLifetimeMs]
        .every(value=>Number.isSafeInteger(value)&&value!>0)||material.operationalPrivateKey?.type!=="private"||material.rootTrustAnchor?.type!=="public")
      throw Error("BUSINESS_SSA_ISOLATED_SIGNING_POLICY_REQUIRED");
    if(!(codec instanceof IsolatedBusinessAccessTokenCodec)&&!(codec instanceof CommercialBusinessAccessAuthority))throw Error("BUSINESS_ACCESS_VERIFIER_REQUIRED");
    const artifact=SignedSessionAssertionOperationalKeySchema.parse(material.signedOperationalKey);
    const prepared=await this.prepareSessionAssertion(accessToken,proof,codec);if(!prepared)return null;
    const access=codec instanceof CommercialBusinessAccessAuthority?prepared.access:await codec.verify(accessToken);if(!access)return null;
    const reservation=prepared.reservation,scope=reservation.eligibleScope;
    return new IsolatedBusinessAuditSessionGuard(this.pool).whileActive({sessionId:scope.sessionId,userId:scope.userId,
      tenantId:scope.tenantId,tenantMembershipId:scope.tenantMembershipId},async client=>{
      if(codec instanceof CommercialBusinessAccessAuthority&&(!prepared.access||!await codec.currentInTransaction(client,prepared.access)))return null;
      // Same owner predicate, on this transaction client: locks remain held
      // through canonical signing, audit and commit, serializing with logout.
      const eligibilitySql=BUSINESS_SSA_ELIGIBILITY_SQL+" FOR SHARE OF s,u,tm,t,d,company,dc";
      const eligible=await client.query(eligibilitySql,[scope.sessionId,scope.deviceId,scope.installationId,material.policy.maximumReauthenticationAgeMs]);
      const current=eligible.rows[0];
      const credential=await client.query(`SELECT expires_at FROM identity.device_credentials
        WHERE credential_id=$1 AND device_id=$2 AND installation_id=$3 AND tenant_id=$4
          AND status='ACTIVE' AND key_purpose='DEVICE_TRUST' AND expires_at>clock_timestamp() FOR SHARE`,
        [access.cid,scope.deviceId,scope.installationId,scope.tenantId]);
      if(!current||!credential.rows[0]||current.user_id!==scope.userId||current.tenant_membership_id!==scope.tenantMembershipId||
        access.sid!==scope.sessionId||access.did!==scope.deviceId||access.tid!==scope.tenantId)return null;
      const issuedAt=new Date();
      const offlineUntil=Math.min(issuedAt.getTime()+material.policy.maximumOfflineLifetimeMs,
        Date.parse(scope.sessionExpiresAt),Date.parse(scope.deviceCredentialExpiresAt),
        current.session_expires_at.getTime(),credential.rows[0].expires_at.getTime(),access.exp*1000,
        artifact.claims.valid_until===null?Infinity:Date.parse(artifact.claims.valid_until));
      if(!Number.isFinite(offlineUntil)||offlineUntil<=issuedAt.getTime())return null;
      const claims={session_id:scope.sessionId,user_id:scope.userId,tenant_membership_id:scope.tenantMembershipId,
        installation_id:scope.installationId,device_id:scope.deviceId,sequence:reservation.sequence,
        key_id:artifact.claims.key_id,issued_at:issuedAt.toISOString(),offline_valid_until:new Date(offlineUntil).toISOString()};
      const issuer=new CentralSessionAssertionIssuer(material.operationalPrivateKey,material.rootTrustAnchor,
        async candidate=>candidate===accessToken?{claims,reservation,signedOperationalKey:artifact}:null,
        material.environment,material.policy);
      const assertion=await issuer.issue(accessToken);if(!assertion)return null;
      await this.audit.append({user_id:scope.userId,session_id:scope.sessionId,tenant_id:scope.tenantId,
        event_code:PlatformSecurityEventCode.SESSION_ISSUED,result:"SUCCEEDED",reason_code:"ISOLATED_SSA_ISSUED",
        correlation_id:proof.correlationId,occurred_at:issuedAt.toISOString()},client);
      const final=await client.query(eligibilitySql,[scope.sessionId,scope.deviceId,scope.installationId,material.policy.maximumReauthenticationAgeMs]);
      const finalCredential=await client.query("SELECT 1 FROM identity.device_credentials WHERE credential_id=$1 AND status='ACTIVE' AND expires_at>clock_timestamp()",[access.cid]);
      if(!final.rows[0]||!finalCredential.rowCount||Date.now()>=offlineUntil)throw Error("BUSINESS_SSA_STATE_CHANGED_BEFORE_COMMIT");
      return assertion;
    });
  }
  constructor(
    private readonly preparation:BusinessAccessPreparation,
    private readonly pool:ReturnType<typeof createPostgresPool>,
    private readonly bindingAudit:TrustedCommercialAudit,
  ){
    if(!(preparation instanceof BusinessAccessPreparation))throw Error("BUSINESS_COORDINATOR_AUTHORITY_REQUIRED");
    this.issuer=new IsolatedBusinessNativeCodeIssuer(pool);
    this.consumer=new IsolatedBusinessBoundCodeConsumer(pool);
    this.audit=new PostgresPlatformSecurityEventRepository(pool);
    if(!bindingAudit?.authorityReference?.trim()||typeof bindingAudit.record!=="function")
      throw Error("BUSINESS_COORDINATOR_DURABLE_BINDING_AUDIT_REQUIRED");
  }
  async authorize(
    protectedReference:unknown, proof:DeviceProofRequest,
    registration:NativeClientRegistration, request:{codeChallenge:string;state:string},
  ):Promise<string|null>{
    validateNativeClientRegistration(registration);
    const prerequisite=createIsolatedCommercialBindingPrerequisite(this.preparation,this.pool,this.bindingAudit);
    const binding=await prerequisite.establish(protectedReference,proof);
    if(!binding)return null;
    return this.issueBinding(binding,registration,request);
  }
  /** Lab composition over durable cookie custody; the local marker is never sent over HTTP. */
  async authorizeBrowser(store:DurableBrowserSessionStore,browser:BrowserSessionRequest,proof:DeviceProofRequest,
    registration:NativeClientRegistration,request:{codeChallenge:string;state:string}):Promise<string|null>{
    validateNativeClientRegistration(registration);
    if(!(store instanceof DurableBrowserSessionStore))throw Error("BUSINESS_DURABLE_BROWSER_OWNER_REQUIRED");
    const marker=Object.freeze({});
    const prerequisite=new CommercialBindingPrerequisite({
      authorityReference:"POSTGRES_AUTHENTICATED_BROWSER_SESSION",
      inspect:async candidate=>candidate===marker?store.inspect(browser):null,
    },createCommercialDeviceInspector(this.pool),this.bindingAudit);
    const binding=await prerequisite.establish(marker,proof);
    return binding?this.issueBinding(binding,registration,request):null;
  }
  async authorizeNativeBrowser(store:DurableBrowserSessionStore,browser:BrowserSessionRequest,native:IsolatedNativeBusinessRequests,token:string,confirmed:boolean,
    registration:NativeClientRegistration){
    if(!(store instanceof DurableBrowserSessionStore)||!(native instanceof IsolatedNativeBusinessRequests)||confirmed!==true)return null;
    validateNativeClientRegistration(registration);
    const identity=await store.inspect(browser),request=await native.inspect(token);
    if(!identity||!request||identity.tenantId!==request.tenant_id||request.client_id!==registration.clientId||request.redirect_uri!==registration.redirectUri)return null;
    const binding={identity,device:{deviceId:request.device_id,installationId:request.installation_id,tenantId:request.tenant_id,
      companyId:request.company_id,credentialId:request.credential_id}};
    const code=await this.issueBinding(binding,registration,{codeChallenge:request.code_challenge,state:request.state},
      {lifetimeMs:native.policy.codeLifetimeMs,consume:client=>native.consume(client,token,identity,binding.device)});
    return code?{code,state:request.state,redirectUri:registration.redirectUri}:null;
  }
  private issueBinding(binding:ValidatedCommercialBinding,registration:NativeClientRegistration,request:{codeChallenge:string;state:string},
    native?:{lifetimeMs:number;consume:(client:PoolClient)=>Promise<void>}):Promise<string|null>{
    return this.issuer.issue({
      binding,clientId:registration.clientId,redirectUri:registration.redirectUri,
      registration,
      codeChallenge:request.codeChallenge,state:request.state,
      ...(native?{lifetimeMs:native.lifetimeMs}:{}),
      recordAudit:async (client:PoolClient)=>{
        if(native)await native.consume(client);
        await this.audit.append({
          user_id:binding.identity.userId,session_id:binding.identity.sessionId,
          tenant_id:binding.identity.tenantId,
          event_code:PlatformSecurityEventCode.AUTHORIZATION_CODE_ISSUED,
          result:"SUCCEEDED",reason_code:"ISOLATED_COORDINATED_ISSUANCE",
          correlation_id:uuidV7(),occurred_at:new Date(Date.now()-1000).toISOString(),
        },client);
      },
    });
  }
  async exchange(registration:NativeClientRegistration,request:{
    code:string;verifier:string;state:string;
  }):Promise<{sessionId:string;deviceId:string;tenantId:string;credentialId:string}|null>{
    validateNativeClientRegistration(registration);
    // The canonical consumer revalidates and burns the code in PostgreSQL.
    // No public credential is returned. Atomic access+refresh is still unapproved.
    return new NativeAuthorizationCodeExchange(registration,this.consumer).exchange(request);
  }
  /**
   * Single-transaction lab-only PKCE redemption and credential-pair issue.
   * A failed pair insertion/audit rolls the code consumption back as well.
   * No identifiers supplied by the callback are trusted over the wire.
   */
  async exchangeCredentials(registration:NativeClientRegistration,request:{
    code:string;verifier:string;state:string;
  },pairIssuer:IsolatedBusinessCredentialPairIssuer):Promise<{
    accessToken:string;refreshToken:string;
  }|null>{
    return this.exchangePair(registration,request,pairIssuer);
  }
  async exchangeNativeCredentials(registration:NativeClientRegistration,request:{code:string;verifier:string;state:string},
    pairIssuer:IsolatedBusinessCredentialPairIssuer,proof:DeviceProofRequest,maximumReauthenticationAgeMs:number){
    if(!Number.isSafeInteger(maximumReauthenticationAgeMs)||maximumReauthenticationAgeMs<=0)throw Error("NATIVE_EXCHANGE_REAUTHENTICATION_POLICY_REQUIRED");
    const parsed=inspectCommercialTokenRequest({method:"POST",contentType:"application/json",body:proof.body,registration});
    if(parsed.status!==200||parsed.request.code!==request.code||parsed.request.code_verifier!==request.verifier||parsed.request.state!==request.state)return null;
    const device=await new PostgresNativeBusinessDeviceProofVerifier(this.pool).verifyTokenAndConsume(proof);
    return device?this.exchangePair(registration,request,pairIssuer,{...device,maximumReauthenticationAgeMs}):null;
  }
  private async exchangePair(registration:NativeClientRegistration,request:{code:string;verifier:string;state:string},
    pairIssuer:IsolatedBusinessCredentialPairIssuer,device?:VerifiedDeviceProofBinding & {maximumReauthenticationAgeMs:number}):Promise<{accessToken:string;refreshToken:string}|null>{
    validateNativeClientRegistration(registration);
    if(!(pairIssuer instanceof IsolatedBusinessCredentialPairIssuer))
      throw Error("BUSINESS_COORDINATOR_TRUSTED_PAIR_ISSUER_REQUIRED");
    const consumer={
      durabilityPolicyReference:this.consumer.durabilityPolicyReference,
      consume:(code:string,verify:Parameters<IsolatedBusinessBoundCodeConsumer["consume"]>[1])=>
        this.consumer.consumeWith(code,verify,async(client,row)=>{
          if(device&&(device.credentialId!==row.credentialId||device.deviceId!==row.deviceId||device.installationId!==row.installationId||device.tenantId!==row.tenantId))return null;
          const binding:ValidatedCommercialBinding={
            identity:{sessionId:row.sessionId,userId:row.userId,tenantId:row.tenantId,
              tenantMembershipId:row.tenantMembershipId},
            device:{deviceId:row.deviceId,credentialId:row.credentialId,
              tenantId:row.tenantId,installationId:row.installationId,companyId:row.companyId},
          };
          return pairIssuer.issueInTransaction(client,binding,uuidV7(),undefined,registration.clientId);
        },device),
    };
    return new NativeAuthorizationCodeExchange(registration,consumer).exchange(request);
  }

}
