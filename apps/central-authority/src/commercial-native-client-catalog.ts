import {validateNativeClientRegistration,type NativeClientRegistration} from "./native-authorization-constraints.js";

/**
 * Server-owned native registration catalog. Clients may send a client_id selector
 * but cannot supply or replace its redirect or issuer registration.
 * Android registration names its HTTPS App Link and signer explicitly. Domain
 * association, the native receiver and production activation are separate.
 */
export class CommercialNativeClientCatalog {
  private readonly records:ReadonlyMap<string,NativeClientRegistration>;
  constructor(registrations:readonly NativeClientRegistration[]){
    if(!Array.isArray(registrations)||registrations.length===0)
      throw new Error("COMMERCIAL_NATIVE_REGISTRATIONS_REQUIRED");
    const map=new Map<string,NativeClientRegistration>();
    for(const candidate of registrations){
      const approved=validateNativeClientRegistration(candidate);
      if(map.has(approved.clientId))throw new Error("COMMERCIAL_NATIVE_CLIENT_DUPLICATE");
      map.set(approved.clientId,Object.freeze({...approved}));
    }
    this.records=map;
  }
  resolve(clientId:unknown):NativeClientRegistration|null {
    return typeof clientId==="string" ? this.records.get(clientId)??null : null;
  }
  requireExact(clientId:unknown,redirectUri:unknown):NativeClientRegistration|null{
    const record=this.resolve(clientId);
    return record&&record.redirectUri===redirectUri?record:null;
  }
}
