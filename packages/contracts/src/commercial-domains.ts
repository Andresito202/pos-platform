import * as z from "zod";
/** Owner-selected deployment destinations. Names alone prove neither DNS, TLS,
 * enrollment nor authority to activate a production runtime. */
export const CamachoCommercialDomains=Object.freeze({
  publicOrigin:"https://camachoposcolombia.com",
  centralOrigin:"https://central.camachoposcolombia.com",
  webLoginPath:"/login",webAppPath:"/app",
  businessLoginPath:"/v1/commercial/login",
  androidCallbackPath:"/android/callback",androidAssociationPath:"/.well-known/assetlinks.json",
  factusPayWebhookPath:"/v1/webhooks/factus-pay/collections",
});
/** Exact navigation only, not an OAuth redirect registration or authentication.
 * No return URL, cookie, access token or user identity crosses this boundary. */
export function camachoBusinessLoginNavigation(request?:string):string{
  if(request!==undefined&&!/^[A-Za-z0-9_-]{43}$/.test(request))throw Error("NATIVE_REQUEST_SELECTOR_REJECTED");
  return CamachoCommercialDomains.centralOrigin+CamachoCommercialDomains.businessLoginPath+(request?"?request="+request:"");
}

export const CommercialPublicSiteProvisionSchema=z.strictObject({profile:z.literal("CAMACHO_PUBLIC_SITE_PREPARATION_V1"),
  origin:z.literal(CamachoCommercialDomains.publicOrigin),central_origin:z.literal(CamachoCommercialDomains.centralOrigin),
  renderer_directory:z.string().min(1).max(4096),maximum_asset_bytes:z.number().int().positive().max(5000000),
  catalog_migration_checksum:z.string().regex(/^[a-f0-9]{64}$/),
  limits:z.strictObject({requests:z.number().int().positive(),buckets:z.number().int().positive(),windowMs:z.number().int().positive()})});
