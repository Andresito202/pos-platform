import type {AuthenticationResponseJSON} from "@simplewebauthn/server";
import type {DeviceProofRequest} from "@pos-platform/database-postgres";
import {uuidV7} from "@pos-platform/contracts";
import {IsolatedBrowserSessionVault} from "./isolated-browser-session-vault.js";
import {IsolatedBusinessBrowserLogin} from "./isolated-business-browser-login.js";
import {BusinessAccessPreparation} from "./business-access-preparation.js";

type ProtectedRequest={cookie:string|null;origin:string|null;csrfToken:string|null;
  fetchSite:string|null;method:string};

/**
 * Isolated in-process adapter, NOT mounted on public HTTPS endpoints.
 * Browser sees only opaque cookie and CSRF material, never the protected
 * BUSINESS preparation reference. DeviceProof remains mandatory for PKCE.
 */
export class IsolatedBusinessBrowserSessionBridge {
  constructor(
    private readonly login:IsolatedBusinessBrowserLogin,
    private readonly vault:IsolatedBrowserSessionVault,
    private readonly preparation:BusinessAccessPreparation,
  ){
    if(!(login instanceof IsolatedBusinessBrowserLogin)||
      !(vault instanceof IsolatedBrowserSessionVault)||
      !(preparation instanceof BusinessAccessPreparation))
      throw Error("BUSINESS_BROWSER_BRIDGE_TRUSTED_OWNERS_REQUIRED");
  }
  begin(input:Parameters<IsolatedBusinessBrowserLogin["begin"]>[0]){
    return this.login.begin(input);
  }
  async completeAndEstablish(input:{
    email:string;password:string;challenge:string;response:AuthenticationResponseJSON;
    tenantId:string;membershipId:string;origin:string;
  }):Promise<{setCookie:string;csrfToken:string}|null>{
    // Never consume MFA material if a malicious origin is attempting to establish
    // a browser session. The vault independently validates the origin again.
    if(!this.vault.acceptsOrigin(input.origin))return null;
    const reference=await this.login.completeAndSelect(input);
    if(!reference)return null;
    const session=this.vault.establish(reference,input.origin);
    if(!session)await this.preparation.close(reference,uuidV7());
    return session;
  }
  authorize(request:ProtectedRequest,proof:DeviceProofRequest,input:{
    clientId:string;redirectUri:string;codeChallenge:string;state:string;
  }){
    const reference=this.vault.inspect(request);
    if(!reference)return Promise.resolve(null);
    return this.login.authorize(reference,proof,input);
  }
  rotate(request:ProtectedRequest){
    return this.vault.rotate(request);
  }
  async logout(request:ProtectedRequest){
    const closed=this.vault.logout(request);
    if(!closed)return null;
    // Durable session logout is required in addition to removing the cookie.
    const state=await this.preparation.close(closed.reference,uuidV7());
    return {clearCookie:closed.clearCookie,sessionState:state};
  }
}
