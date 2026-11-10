import {LicenseAllocationRequestSchema,LicenseActivationPageSchema,LicenseActivationPageRequestSchema,UuidSchema,LicenseOfferDraftSchema,type LicenseOfferDraft} from "@pos-platform/contracts";
export class PlatformRequestError extends Error { constructor(message:string,readonly status:number){super(message);this.name="PlatformRequestError";} }
export type PublishedOffer=LicenseOfferDraft&{version:number;status:"DRAFT"|"ACTIVE";published_at?:string|null};
const decode=(value:string)=>Uint8Array.from(atob(value.replace(/-/g,"+").replace(/_/g,"/")),c=>c.charCodeAt(0));
const encode=(value:ArrayBuffer)=>btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");

/** GLOBAL same-origin HTTPS only. Cookies remain HttpOnly; no bearer/session
 * identifier, password, key or CSRF token is persisted in browser storage. */
export class PlatformClient{
  private csrf:string|null=null;
  constructor(private readonly location:Pick<Location,"protocol"|"origin">=window.location,private readonly transport:typeof fetch=(input,init)=>fetch(input,init)){
    if(location.protocol!=="https:")throw Error("La administración requiere el origen HTTPS de Central.");
  }
  private async post(path:string,body:unknown,signal?:AbortSignal,csrf=this.csrf):Promise<Record<string,unknown>>{
    const response=await this.transport(this.location.origin+"/v1/platform/"+path,{method:"POST",credentials:"same-origin",cache:"no-store",redirect:"error",
      ...(signal?{signal}:{}),headers:{"content-type":"application/json",...(csrf?{"x-csrf-token":csrf}:{})},body:JSON.stringify(body)});
    if(!response.ok){
      if(response.status===409){const problem=await response.json() as {code?:unknown};if(problem.code==='LICENSE_OFFER_VERSION_CONFLICT')throw Error("Otro administrador cambió la versión. Recupera el catálogo antes de reintentar.");}
      throw new PlatformRequestError(response.status===429?"Demasiados intentos; espera antes de continuar.":response.status===401||response.status===403?
        "Central rechazó la sesión o los permisos.":response.status===409?"La operación requiere políticas comerciales aprobadas.":"Central no pudo completar la operación.",response.status);
    }
    return await response.json() as Record<string,unknown>;
  }
  async login(email:string,password:string,signal:AbortSignal){
    this.csrf=null;
    const start=await this.post("login/begin",{email,password},signal);
    if(typeof start.challenge!=="string"||typeof start.credentialId!=="string"||typeof start.csrfToken!=="string")throw Error("Respuesta de autenticación inválida.");
    const credential=await navigator.credentials.get({publicKey:{challenge:decode(start.challenge),
      rpId:new URL(this.location.origin).hostname,allowCredentials:[{type:"public-key",id:decode(start.credentialId)}],userVerification:"required"},signal});
    if(!(credential instanceof PublicKeyCredential)||!(credential.response instanceof AuthenticatorAssertionResponse))throw Error("Segundo factor no verificado.");
    const assertion=credential.response;
    const result=await this.post("login/complete",{email,password,challenge:start.challenge,response:{id:credential.id,rawId:encode(credential.rawId),
      type:"public-key",clientExtensionResults:credential.getClientExtensionResults(),response:{clientDataJSON:encode(assertion.clientDataJSON),
        authenticatorData:encode(assertion.authenticatorData),signature:encode(assertion.signature),userHandle:assertion.userHandle?encode(assertion.userHandle):null}}},signal,start.csrfToken);
    if(result.authenticated!==true||result.scope!=="GLOBAL"||typeof result.csrfToken!=="string")throw Error("Central no confirmó la sesión GLOBAL.");
    this.csrf=result.csrfToken;
    try{await this.post("session",{},signal);}catch(error){await this.logout().catch(()=>undefined);throw error;}
  }
  async offers():Promise<PublishedOffer[]>{
    const result=await this.post("license-offers/catalog",{});
    if(!Array.isArray(result.offers))throw Error("Catálogo de planes inválido.");
    return result.offers.map((raw:unknown)=>{
      if(!raw||typeof raw!=="object"||!("version" in raw)||!Number.isSafeInteger(raw.version)||Number(raw.version)<1||!("status" in raw)||!["DRAFT","ACTIVE"].includes(String(raw.status)))throw Error("Versión de plan inválida.");
      const {version,status,features:_,published_at,...offer}=raw as Record<string,unknown>;
      if(published_at!==undefined&&published_at!==null&&(typeof published_at!=="string"||!Number.isFinite(Date.parse(published_at))))throw Error("Fecha de publicación inválida.");
      return {...LicenseOfferDraftSchema.parse(offer),version:Number(version),status:status as "DRAFT"|"ACTIVE",...(published_at!==undefined?{published_at:published_at as string|null}:{})};
    });
  }
  save(offer:LicenseOfferDraft,expectedVersion:number,correlationId:string){return this.post("license-offers/save",{offer,expectedVersion,correlationId});}
  initializePreproduction(){return this.post("license-offers/initialize-preproduction",{});}
  publish(planId:string,expectedVersion:number,correlationId:string){return this.post("license-offers/publish",{planId,expectedVersion,correlationId});}
  async issueLicense(paymentId:string,correlationId:string){
    const result=await this.post("licenses/issue",{paymentId:UuidSchema.parse(paymentId),correlationId:UuidSchema.parse(correlationId)});
    if(!UuidSchema.safeParse(result.licenseId).success||typeof result.contractStatus!=="string"||!result.contractStatus||
      result.activationStatus!=="NOT_ACTIVATED"||typeof result.idempotent!=="boolean")throw Error("Central no confirmó la emisión. Reintenta con el mismo pago.");
    return {licenseId:String(result.licenseId),contractStatus:result.contractStatus,idempotent:result.idempotent};
  }
  async allocateLicense(request:unknown){
    const body=LicenseAllocationRequestSchema.parse(request);
    const result=await this.post("licenses/allocate",body);
    if(!UuidSchema.safeParse(result.activationId).success||!["PENDING","ACTIVE","REVOKED"].includes(String(result.status))||
      typeof result.idempotent!=="boolean")throw Error("Central no confirmó la asignación. Conserva la misma solicitud para reintentar.");
    return {activationId:String(result.activationId),status:result.status as "PENDING"|"ACTIVE"|"REVOKED",idempotent:result.idempotent};
  }
  async activations(after:string|null=null){
    return LicenseActivationPageSchema.parse(await this.post("licenses/activations",LicenseActivationPageRequestSchema.parse({after})));
  }
  async revokeActivation(activationId:string,correlationId:string){
    const result=await this.post("licenses/revoke-activation",{activationId:UuidSchema.parse(activationId),correlationId:UuidSchema.parse(correlationId)});
    if(result.status!=="REVOKED"||typeof result.idempotent!=="boolean")throw Error("Central no confirmó la revocación. Actualiza el estado antes de reintentar.");
    return {status:"REVOKED" as const,idempotent:result.idempotent};
  }
  async logout(){try{await this.post("logout",{});}finally{this.csrf=null;}}
}
