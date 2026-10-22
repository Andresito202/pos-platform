import type {PoolClient} from "pg";
import type {DeviceProofRequest} from "@pos-platform/database-postgres";
import {PlatformSecurityEventCode,uuidV7} from "@pos-platform/contracts";
import {PostgresPlatformSecurityEventRepository} from "@pos-platform/database-postgres";
import {BusinessAccessPreparation} from "./business-access-preparation.js";
import {createIsolatedCommercialBindingPrerequisite} from "./isolated-commercial-binding-adapter.js";
import {IsolatedBusinessNativeCodeIssuer} from "./isolated-business-native-code-issuer.js";
import {IsolatedBusinessBoundCodeConsumer} from "./isolated-business-bound-code-consumer.js";
import {NativeAuthorizationCodeExchange} from "./native-authorization-code-exchange.js";
import type {NativeClientRegistration} from "./native-authorization-constraints.js";
import {IsolatedBusinessAccessTokenCodec} from "./isolated-business-access-token-codec.js";
import {IsolatedBusinessRefreshRotation} from "./isolated-business-refresh-rotation.js";
import type {createPostgresPool} from "@pos-platform/database-postgres";

/**
 * INTERNAL ISOLATED orchestration only. A client cannot supply a serialized
 * session reference or substitute user/device IDs for authenticated state.
 * No routes, refresh endpoints or production credential authority.
 */
export class IsolatedBusinessAuthCoordinator {
  private readonly issuer:IsolatedBusinessNativeCodeIssuer;
  private readonly consumer:IsolatedBusinessBoundCodeConsumer;
  private readonly audit:PostgresPlatformSecurityEventRepository;
  private readonly refresh:IsolatedBusinessRefreshRotation;
  constructor(
    private readonly preparation:BusinessAccessPreparation,
    private readonly pool:ReturnType<typeof createPostgresPool>,
    private readonly access:IsolatedBusinessAccessTokenCodec,
  ){
    if(!(preparation instanceof BusinessAccessPreparation))throw Error("BUSINESS_COORDINATOR_AUTHORITY_REQUIRED");
    this.issuer=new IsolatedBusinessNativeCodeIssuer(pool);
    this.consumer=new IsolatedBusinessBoundCodeConsumer(pool);
    this.audit=new PostgresPlatformSecurityEventRepository(pool);
    this.refresh=new IsolatedBusinessRefreshRotation(pool);
  }
  async authorize(
    protectedReference:unknown, proof:DeviceProofRequest,
    registration:NativeClientRegistration, request:{codeChallenge:string;state:string},
  ):Promise<string|null>{
    const prerequisite=createIsolatedCommercialBindingPrerequisite(this.preparation,this.pool,{
      authorityReference:"ISOLATED_CANONICAL_ISSUANCE_AUDIT",
      record:async()=>undefined, // The issuer performs durable canonical audit in its own transaction.
    });
    const binding=await prerequisite.establish(protectedReference,proof);
    if(!binding)return null;
    return this.issuer.issue({
      binding,clientId:registration.clientId,redirectUri:registration.redirectUri,
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
  }):Promise<{accessToken:string;refreshToken:string}|null>{
    // Exchange returns ONLY trusted IDs from a transactionally consumed code.
    // They must be re-resolved by the canonical session owner before issuance.
    const binding=await new NativeAuthorizationCodeExchange(registration,this.consumer).exchange(request);
    if(!binding)return null;
    const resolved=await this.pool.query<{
      user_id:string;tenant_membership_id:string;
    }>(`SELECT user_id::text,tenant_membership_id::text FROM identity.sessions
       WHERE id=$1 AND tenant_id=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp()`,
      [binding.sessionId,binding.tenantId]);
    const row=resolved.rows[0];if(!row)return null;
    const identity={
      sessionId:binding.sessionId,userId:row.user_id,tenantId:binding.tenantId,
      tenantMembershipId:row.tenant_membership_id,
    };
    const accessToken=await this.access.issue(identity,{
      deviceId:binding.deviceId,credentialId:binding.credentialId,
    },uuidV7());
    if(!accessToken)return null;
    const refreshToken=await this.refresh.issue(identity,uuidV7());
    if(!refreshToken)return null;
    // This remains a lab-only sequential issuance. Full atomicity of both
    // credentials and rollback on partial failure is NOT established.
    return {accessToken,refreshToken};
  }
}
