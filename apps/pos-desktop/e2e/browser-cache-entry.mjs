// Dedicated ephemeral Chromium cache test; no POS identity, DB or deployment.
import {app,session} from "electron";
import {createServer} from "node:http";
import {resolve} from "node:path";
if(!process.env.CAMACHO_CACHE_TEST_DIRECTORY)throw Error("DEDICATED_CACHE_TEST_PROFILE_REQUIRED");
app.setPath("userData",resolve(process.env.CAMACHO_CACHE_TEST_DIRECTORY));
void app.whenReady().then(async()=>{
  let server;
  try{
    const {BrowserCacheMaintenance}=await import("../dist/browser-cache-maintenance.js");
    const bytes=Buffer.alloc(2*1024*1024,65);server=createServer((_req,res)=>{res.writeHead(200,{"content-type":"application/octet-stream","cache-control":"public, max-age=3600","content-length":bytes.length});res.end(bytes);});
    await new Promise(r=>server.listen(0,"127.0.0.1",r));const origin=`http://127.0.0.1:${server.address().port}`;
    await session.defaultSession.cookies.set({url:origin,name:"cache-fixture-marker",value:"preserve-test-state",httpOnly:true});
    const response=await session.defaultSession.fetch(origin+"/asset");await response.arrayBuffer();
    for(let i=0;i<30&&await session.defaultSession.getCacheSize()<bytes.length;i++)await new Promise(r=>setTimeout(r,100));
    const maintenance=new BrowserCacheMaintenance(session.defaultSession,{maximum_cache_bytes:1,interval_ms:60000});
    const observed=await maintenance.run(true),cookies=await session.defaultSession.cookies.get({url:origin,name:"cache-fixture-marker"});
    globalThis.browserCacheObservation={...observed,cookiePreserved:cookies.length===1,scope:"TEMPORARY_CHROMIUM_HTTP_CACHE",platform:process.platform};
  }catch(e){globalThis.browserCacheObservation={error:e.message};}
  finally{if(server)await new Promise(r=>server.close(r));}
});
