import {PublicLicenseCatalogSchema,type PublicLicenseOffer} from "@pos-platform/contracts";
/** Read-only HTTPS DTO. No GLOBAL cookies, account/session data or fallback prices. */
export class PublicLicenseClient{
  private cached:PublicLicenseOffer[]|null=null;private etag:string|null=null;
  constructor(private readonly origin=window.location.origin,private readonly transport:typeof fetch=(input,init)=>fetch(input,init)){
    if(new URL(origin).protocol!=="https:")throw Error("Los precios requieren Central HTTPS.");
  }
  async offers(signal?:AbortSignal){
    try{
    const response=await this.transport(this.origin+"/v1/licensing/offers",{method:"GET",credentials:"omit",cache:"no-store",redirect:"error",
      headers:this.etag?{"if-none-match":this.etag}:{},...(signal?{signal}:{})});
    if(response.status===304&&this.cached)return this.cached;
    if(response.status!==200){this.cached=null;this.etag=null;throw Error("Central no tiene precios disponibles en este momento.");}
    const result=PublicLicenseCatalogSchema.parse(await response.json());this.cached=result.offers;this.etag=response.headers.get("etag");return result.offers;
    }catch(error){this.cached=null;this.etag=null;throw error;}
  }
}
