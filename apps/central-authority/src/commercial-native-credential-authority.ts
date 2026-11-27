import {type DeviceProofRequest,PostgresCommercialRefreshFamilies,type Pool,type PoolClient} from "@pos-platform/database-postgres";
import {CommercialBusinessAccessAuthority,type CommercialAccessPolicy} from "./commercial-business-access-authority.js";
import {NativeBusinessCodeAuthority} from "./native-business-code-authority.js";
import type {CommercialAccessClaims,NativeClientRegistration} from "@pos-platform/contracts";
import type {CommercialRefreshPolicy} from "@pos-platform/database-postgres";

export class CommercialNativeCredentialAuthority {
  private readonly families:PostgresCommercialRefreshFamilies;
  private readonly access:CommercialBusinessAccessAuthority;
  constructor(pool:Pool,registration:NativeClientRegistration,keys:{privatePem:string;publicPem:string},
    refreshPolicy:CommercialRefreshPolicy,accessPolicy:CommercialAccessPolicy,private readonly codes:NativeBusinessCodeAuthority){
    if(registration.platform!=="ANDROID"||registration.clientId!==accessPolicy.clientId||registration.authorizationOrigin!==accessPolicy.issuer)
      throw Error("NATIVE_ACCESS_REGISTRATION_MISMATCH");
    this.families=new PostgresCommercialRefreshFamilies(pool,refreshPolicy);
    this.access=new CommercialBusinessAccessAuthority(pool,keys,accessPolicy,this.families);
  }
  async exchange(proof:DeviceProofRequest){
    return this.codes.redeem(proof,async(c,b,correlationId)=>{
      const family=await this.families.issueInTransaction(c,b,correlationId);
      const accessToken=await this.access.issueInTransaction(c,family.familyId,correlationId);
      return {accessToken,refreshToken:family.refreshToken};
    });
  }
  currentInTransaction(c:PoolClient,claims:CommercialAccessClaims){return this.access.currentInTransaction(c,claims);}
  refresh(raw:string,proof:DeviceProofRequest){return this.access.refresh(raw,proof);}
  revoke(proof:DeviceProofRequest){return this.families.revoke(proof);}
  verifyAndConsume(token:string,proof:DeviceProofRequest,operation:"SESSION_ASSERTION"|"AUTHORIZATION_SNAPSHOT"){
    return this.access.verifyAndConsume(token,proof,operation);
  }
}
