import {lstatSync,readFileSync} from "node:fs";
import {isAbsolute} from "node:path";
import {X509Certificate} from "node:crypto";
import {TLSSocket} from "node:tls";
import type {IncomingMessage,ServerResponse} from "node:http";
import type {Pool} from "@pos-platform/database-postgres";
import {CamachoCommercialDomains,camachoBusinessLoginNavigation,CommercialPublicSiteProvisionSchema} from "@pos-platform/contracts";
import {createGlobalAdministrationAssets} from "./global-administration-assets.js";
import {createPublicLicenseCatalog} from "./public-license-catalog.js";
import {LicenseOfferDrafts} from "./license-offer-drafts.js";
const deny=(res:ServerResponse,code:string,status=503)=>{const body=JSON.stringify({code});res.writeHead(status,{"content-type":"application/json","cache-control":"no-store","referrer-policy":"no-referrer","content-length":Buffer.byteLength(body)});res.end(body);};
/** Opt-in virtual host on the existing listener, not another backend. Public
 * requests never reach GLOBAL/BUSINESS handlers or private contract readers. */
export async function prepareCommercialPublicSite(pool:Pool,path:string,centralOrigin:string,certificate:Buffer){
  if(!isAbsolute(path))throw Error("PUBLIC_SITE_MANAGED_FILE_REQUIRED");const file=lstatSync(path);
  if(!file.isFile()||file.isSymbolicLink()||file.size>16384)throw Error("PUBLIC_SITE_MANAGED_FILE_REJECTED");
  const p=CommercialPublicSiteProvisionSchema.parse(JSON.parse(readFileSync(path,"utf8")));
  if(centralOrigin!==p.central_origin||!new X509Certificate(certificate).checkHost(new URL(p.origin).hostname))throw Error("PUBLIC_SITE_TLS_OR_CENTRAL_MISMATCH");
  const ledger=await pool.query("SELECT encode(checksum,'hex') AS checksum FROM platform.target_migration_executions WHERE migration_id='023_license_offer_terms' AND status='APPLIED'");
  if(ledger.rows.length!==1||ledger.rows[0].checksum!==p.catalog_migration_checksum)throw Error("PUBLIC_SITE_REGISTERED_CATALOG_REQUIRED");
  const assets=createGlobalAdministrationAssets({directory:p.renderer_directory,origin:p.origin,maximumAssetBytes:p.maximum_asset_bytes,page:"pricing"});
  // No authorization policy is inferred here: published() is a public read only.
  const catalog=createPublicLicenseCatalog({published:()=>LicenseOfferDrafts.readPublished(pool)},p.origin,p.limits);
  return async(req:IncomingMessage,res:ServerResponse)=>{
    if(!(req.socket instanceof TLSSocket)||!req.socket.encrypted||req.headers.host!==new URL(p.origin).host||req.method!=="GET"||req.headers.authorization||req.headers.cookie){deny(res,"PUBLIC_SITE_REQUEST_REJECTED",403);return;}
    const target=req.url??"";
    if(target==="/login"||target.startsWith("/login?")){
      const url=new URL(target,p.origin),keys=[...url.searchParams.keys()];
      if(keys.length!==1||keys[0]!=="request"||url.searchParams.getAll("request").length!==1){deny(res,"WEB_LOGIN_REQUIRES_DEVICE_BOUND_NATIVE_REQUEST");return;}
      let destination:string;try{destination=camachoBusinessLoginNavigation(url.searchParams.get("request")!);}catch{deny(res,"PUBLIC_LOGIN_REDIRECT_REJECTED",400);return;}
      res.writeHead(303,{location:destination,"cache-control":"no-store","referrer-policy":"no-referrer","content-length":"0"});res.end();return;
    }
    if(target==="/app"||target.startsWith("/app/")){deny(res,"WEB_POS_RUNTIME_NOT_PROVISIONED");return;}
    if(target==="/v1/licensing/offers"){await catalog(req,res);return;}
    if(target==="/"||target==="/pricing/"||target.startsWith("/assets/")||target.startsWith("/pricing/assets/")){
      const original=req.url;req.url=target==="/"?"/pricing/":target.startsWith("/assets/")?"/pricing"+target:target;
      try{await assets(req,res);}finally{req.url=original;}return;
    }
    deny(res,"PUBLIC_SITE_NOT_FOUND",404);
  };
}
