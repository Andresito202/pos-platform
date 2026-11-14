import {PublicLicenseCatalogSchema} from "@pos-platform/contracts";
/** Public DTO only. Origin and deadline come from installer-owned registration. */
export async function fetchPublicLicenseCatalog(origin:string,timeoutMs:number,transport:typeof fetch=fetch){
  const url=new URL(origin);if(url.protocol!=="https:"||url.origin!==origin||!Number.isSafeInteger(timeoutMs)||timeoutMs<=0)throw Error("LICENSE_CATALOG_CONFIGURATION_REQUIRED");
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{const response=await transport(origin+"/v1/licensing/offers",{method:"GET",credentials:"omit",cache:"no-store",redirect:"error",signal:controller.signal});
    if(response.status!==200||!response.body)throw Error("LICENSE_CATALOG_UNAVAILABLE");
    const reader=response.body.getReader(),parts:Uint8Array[]=[];let size=0;
    try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>524288)throw Error("LICENSE_CATALOG_TOO_LARGE");parts.push(value);}}
    finally{await reader.cancel().catch(()=>undefined);}
    return PublicLicenseCatalogSchema.parse(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(parts))));
  }finally{clearTimeout(timer);}
}
