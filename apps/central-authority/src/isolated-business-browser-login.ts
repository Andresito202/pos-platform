import type {AuthenticationResponseJSON} from "@simplewebauthn/server";
import type {DeviceProofRequest} from "@pos-platform/database-postgres";
import {BusinessInitialMfaFlow} from "./business-initial-mfa-flow.js";
import {BusinessAccessPreparation,type BusinessAccessPreparationReference} from "./business-access-preparation.js";
import {IsolatedBusinessAuthCoordinator} from "./isolated-business-auth-coordinator.js";
import {CommercialNativeClientCatalog} from "./commercial-native-client-catalog.js";

/**
 * In-process laboratory browser-auth orchestration. These references cannot be
 * JSON-serialized, persisted in a cookie, or accepted from an HTTP request.
 * A future browser session adapter must separately establish same-origin,
 * HttpOnly/Secure cookie, CSRF and browser-session lifecycle guarantees.
 */
export class IsolatedBusinessBrowserLogin {
  constructor(
    private readonly mfa:BusinessInitialMfaFlow,
    private readonly preparation:BusinessAccessPreparation,
    private readonly coordinator:IsolatedBusinessAuthCoordinator,
    private readonly clients:CommercialNativeClientCatalog,
  ){
    if(!(mfa instanceof BusinessInitialMfaFlow)||
       !(preparation instanceof BusinessAccessPreparation)||
       !(coordinator instanceof IsolatedBusinessAuthCoordinator)||
       !(clients instanceof CommercialNativeClientCatalog))
      throw new Error("BUSINESS_BROWSER_TRUSTED_AUTHORITY_REQUIRED");
  }

  async begin(input:Parameters<BusinessInitialMfaFlow["begin"]>[0]){
    return this.mfa.begin(input);
  }

  async completeAndSelect(input:{
    email:string;password:string;challenge:string;
    response:AuthenticationResponseJSON;tenantId:string;membershipId:string;
  }):Promise<BusinessAccessPreparationReference|null>{
    const receipt=await this.mfa.complete({
      email:input.email,password:input.password,challenge:input.challenge,response:input.response,
    });
    if(!receipt)return null;
    return this.preparation.open({
      mfaReceipt:receipt,selection:{tenantId:input.tenantId,membershipId:input.membershipId},
    });
  }

  async authorize(
    protectedReference:unknown,proof:DeviceProofRequest,
    input:{clientId:string;redirectUri:string;codeChallenge:string;state:string},
  ):Promise<{redirectUri:string;code:string;state:string}|null>{
    const registration=this.clients.requireExact(input.clientId,input.redirectUri);
    if(!registration)return null;
    const code=await this.coordinator.authorize(protectedReference,proof,registration,{
      codeChallenge:input.codeChallenge,state:input.state,
    });
    if(!code)return null;
    // Return structured fields, not an untrusted Location URL. Future transport
    // must apply the approved redirect policy and prevent open redirects.
    return {redirectUri:registration.redirectUri,code,state:input.state};
  }
}
