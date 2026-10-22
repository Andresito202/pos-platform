import type {PoolClient} from "@pos-platform/database-postgres";
import type {DeviceProofRequest} from "@pos-platform/database-postgres";
import {PlatformSecurityEventCode,uuidV7} from "@pos-platform/contracts";
import {PostgresPlatformSecurityEventRepository} from "@pos-platform/database-postgres";
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

/**
 * INTERNAL ISOLATED orchestration only. A client cannot supply a serialized
 * session reference or substitute user/device IDs for authenticated state.
 * No routes, refresh endpoints or production credential authority.
 */
export class IsolatedBusinessAuthCoordinator {
  private readonly issuer:IsolatedBusinessNativeCodeIssuer;
  private readonly consumer:IsolatedBusinessBoundCodeConsumer;
  private readonly audit:PostgresPlatformSecurityEventRepository;
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
  private issueBinding(binding:ValidatedCommercialBinding,registration:NativeClientRegistration,request:{codeChallenge:string;state:string}):Promise<string|null>{
    return this.issuer.issue({
      binding,clientId:registration.clientId,redirectUri:registration.redirectUri,
      registration,
      codeChallenge:request.codeChallenge,state:request.state,
      recordAudit:async (client:PoolClient)=>{
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
    validateNativeClientRegistration(registration);
    if(!(pairIssuer instanceof IsolatedBusinessCredentialPairIssuer))
      throw Error("BUSINESS_COORDINATOR_TRUSTED_PAIR_ISSUER_REQUIRED");
    const consumer={
      durabilityPolicyReference:this.consumer.durabilityPolicyReference,
      consume:(code:string,verify:Parameters<IsolatedBusinessBoundCodeConsumer["consume"]>[1])=>
        this.consumer.consumeWith(code,verify,async(client,row)=>{
          const binding:ValidatedCommercialBinding={
            identity:{sessionId:row.sessionId,userId:row.userId,tenantId:row.tenantId,
              tenantMembershipId:row.tenantMembershipId},
            device:{deviceId:row.deviceId,credentialId:row.credentialId,
              tenantId:row.tenantId,installationId:row.installationId,companyId:row.companyId},
          };
          return pairIssuer.issueInTransaction(client,binding,uuidV7());
        }),
    };
    return new NativeAuthorizationCodeExchange(registration,consumer).exchange(request);
  }

}
