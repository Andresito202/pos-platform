import {PostgresMerchantDestinationDeviceProofVerifier,type DeviceProofRequest,type Pool} from "@pos-platform/database-postgres";
import {CentralMerchantDestinationPublisher} from "./merchant-destination-snapshot-publisher.js";
import {PostgresMerchantDestinationAcknowledgements} from "./merchant-destination-acknowledgements.js";

export type MerchantDeviceRequest="snapshot"|"floor"|"ack";
const operations={snapshot:"SNAPSHOT",floor:"FLOOR",ack:"ACK"} as const;

/** Device-signed-only Central entry. No bearer, username or tenant parameter. */
export class MerchantDestinationDeviceRoutes {
  private readonly verifier:PostgresMerchantDestinationDeviceProofVerifier;
  private readonly acknowledgements:PostgresMerchantDestinationAcknowledgements;
  constructor(pool:Pool,private readonly publisher:CentralMerchantDestinationPublisher) {
    this.verifier=new PostgresMerchantDestinationDeviceProofVerifier(pool);
    this.acknowledgements=new PostgresMerchantDestinationAcknowledgements(pool);
  }
  async handle(route:MerchantDeviceRequest,input:DeviceProofRequest):Promise<unknown>{
    let payload:unknown;
    try{payload=JSON.parse(input.body);}catch{return null;}
    if(!payload||typeof payload!=="object"||Array.isArray(payload))return null;
    const o=payload as Record<string,unknown>;
    if(Object.keys(o).length!==(route==="ack"?1:0) ||
       (route==="ack" && (typeof o.sequence!=="number"||!Number.isSafeInteger(o.sequence)||o.sequence<1)))return null;
    const verified=await this.verifier.verifyOperationAndConsume(input,operations[route]);
    if(!verified)return null;
    const scope={tenantId:verified.tenantId,companyId:verified.companyId,installationId:verified.installationId};
    if(route==="snapshot")return {artifact:await this.publisher.issueForPreauthorizedInstallation(scope)};
    if(route==="floor")return this.acknowledgements.statusForPreauthorizedInstallation(scope);
    const sequence=await this.acknowledgements.acknowledgePreauthorizedInstallation(scope,Number(o.sequence));
    return {sequence};
  }
}
