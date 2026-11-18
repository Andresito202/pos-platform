import {it,expect} from "vitest";
import {fetchPublicLicenseCatalog} from "../src/security/license-offer-catalog.js";
it("public price HTTP: fixed HTTPS, bounded DTO, no credentials, redirects or fallback",async()=>{
  const expected={profile:"CAMACHO_PUBLIC_LICENSE_CATALOG_V1",offers:[]};let call:{url:string;init:RequestInit}|undefined;
  const transport=(async(url,init)=>{call={url:String(url),init:init!};return new Response(JSON.stringify(expected));}) as typeof fetch;
  expect(await fetchPublicLicenseCatalog("https://central.example.test",1000,transport)).toEqual(expected);
  expect(call).toMatchObject({url:"https://central.example.test/v1/licensing/offers",init:{credentials:"omit",redirect:"error",cache:"no-store"}});
  await expect(fetchPublicLicenseCatalog("http://central.example.test",1000,transport)).rejects.toThrow();
  await expect(fetchPublicLicenseCatalog("https://central.example.test",1000,async()=>new Response('{"account":"private"}'))).rejects.toThrow();
  await expect(fetchPublicLicenseCatalog("https://central.example.test",1000,async()=>new Response("x".repeat(524289)))).rejects.toThrow("TOO_LARGE");
});
