import {createHash} from "node:crypto";
import type {IncomingMessage,ServerResponse} from "node:http";
import {TLSSocket} from "node:tls";
import {PublicLicenseCatalogSchema,canonicalSessionTrustJson} from "@pos-platform/contracts";
import {LicenseOfferDrafts} from "./license-offer-drafts.js";
import {FixedWindowRateLimiter} from "./fixed-window-rate-limiter.js";
import {inspectCommercialHeaders,sendCommercialJson} from "./isolated-commercial-https.js";
export const PUBLIC_LICENSE_CATALOG_PATH="/v1/licensing/offers";
export function createPublicLicenseCatalog(offers:LicenseOfferDrafts,origin:string,limits:{requests:number;buckets:number;windowMs:number}){
  const limiter=new FixedWindowRateLimiter(limits.requests,limits.buckets,limits.windowMs);
  return async(req:IncomingMessage,res:ServerResponse)=>{
    try{
      if(!(req.socket instanceof TLSSocket)||!req.socket.encrypted||req.headers.host!==new URL(origin).host||req.url!==PUBLIC_LICENSE_CATALOG_PATH||req.method!=="GET"||
        req.headers.origin!==undefined&&req.headers.origin!==origin||req.headers["content-length"]!==undefined&&req.headers["content-length"]!=="0"){
        sendCommercialJson(res,403,{code:"PUBLIC_CATALOG_REQUEST_REJECTED"});return;}
      inspectCommercialHeaders(req);
      if(!limiter.allow(req.socket.remoteAddress??"unknown")){sendCommercialJson(res,429,{code:"PUBLIC_CATALOG_RATE_LIMITED"});return;}
      const rows=await offers.published();
      // Whitelist the public DTO; no feature internals, accounts, quotes or audit.
      const catalog=PublicLicenseCatalogSchema.parse({profile:"CAMACHO_PUBLIC_LICENSE_CATALOG_V1",offers:rows.filter(p=>"profile" in p).map(p=>{
        const {features:_,policy_reference:policy,...offer}=p;return {...offer,policy_reference:policy,tax_status:"PENDING",purchase_enabled:false};
      })});
      const etag='"'+createHash("sha256").update(canonicalSessionTrustJson(catalog)).digest("hex")+'"';
      res.setHeader("etag",etag);res.setHeader("cache-control","no-cache, private");
      if(req.headers["if-none-match"]===etag){res.writeHead(304);res.end();return;}
      sendCommercialJson(res,200,catalog);
    }catch{sendCommercialJson(res,503,{code:"PUBLIC_CATALOG_UNAVAILABLE"});}
  };
}
