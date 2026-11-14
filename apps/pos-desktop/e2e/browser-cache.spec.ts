import {test,expect} from "@playwright/test";
import {_electron} from "playwright";
import {mkdtempSync,rmSync,writeFileSync,mkdirSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve,dirname,basename} from "node:path";
import {createRequire} from "node:module";
test("real Electron clears measured HTTP cache and retains independent session state",async()=>{
  const directory=mkdtempSync(join(tmpdir(),"camacho-browser-cache-")),env:Record<string,string>={};
  for(const [key,value] of Object.entries(process.env))if(value!==undefined&&key!=="ELECTRON_RUN_AS_NODE")env[key]=value;
  env.CAMACHO_CACHE_TEST_DIRECTORY=directory;
  const application=await _electron.launch({args:[resolve("e2e/browser-cache-entry.mjs")],executablePath:createRequire(import.meta.url)("electron") as string,env});
  try{
    let observed:{cleared:boolean;before_bytes:number;after_bytes:number;elapsed_ms:number;cookiePreserved:boolean}|undefined;
    await expect.poll(async()=>{observed=await application.evaluate(()=> (globalThis as unknown as {browserCacheObservation:typeof observed}).browserCacheObservation);return observed;},{timeout:15000}).toBeTruthy();
    expect(observed).toMatchObject({cleared:true,cookiePreserved:true});expect(observed!.before_bytes).toBeGreaterThanOrEqual(2*1024*1024);expect(observed!.after_bytes).toBeLessThan(observed!.before_bytes);
    const path=resolve("../../artifacts/windows-p0/2026-10-26/browser-cache-physical.json");mkdirSync(dirname(path),{recursive:true});writeFileSync(path,JSON.stringify(observed,null,2));
  }finally{await application.close();if(dirname(resolve(directory))!==resolve(tmpdir())||!basename(directory).startsWith("camacho-browser-cache-"))throw Error("CACHE_CLEANUP_PATH_REJECTED");rmSync(directory,{recursive:true,force:true});}
});
