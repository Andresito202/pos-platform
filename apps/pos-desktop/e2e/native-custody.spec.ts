import {test,expect} from "@playwright/test";
import {_electron} from "playwright";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve,basename,dirname} from "node:path";
import {createRequire} from "node:module";

test("Electron OS custody encrypts restores and destroys a test credential without the POS",async()=>{
  const directory=mkdtempSync(join(tmpdir(),"camacho-electron-custody-"));
  const env:Record<string,string>={};for(const [key,value] of Object.entries(process.env))if(value!==undefined&&key!=="ELECTRON_RUN_AS_NODE")env[key]=value;
  env.CAMACHO_CUSTODY_TEST_DIRECTORY=directory;
  const executablePath=createRequire(import.meta.url)("electron") as string;
  const application=await _electron.launch({args:[resolve("e2e/native-custody-entry.mjs")],executablePath,env});
  try{
    const storageBackend=await application.evaluate(({safeStorage})=>safeStorage.getSelectedStorageBackend());
    const unavailable=process.platform==="linux"&&["basic_text","unknown"].includes(storageBackend);
    // An insecure Linux backend must fail closed; a secure backend must round-trip.
    const expected=unavailable
      ? {platform:process.platform,restored:false,cleared:false,phase:"OS_CUSTODY_UNAVAILABLE"}
      : {platform:process.platform,restored:true,cleared:true,phase:"COMPLETE"};
    await expect.poll(()=>application.evaluate(()=>
      (globalThis as unknown as {nativeCustodyResult?:unknown}).nativeCustodyResult),{timeout:15_000}).toEqual(expected);
  }finally{
    await application.close();
    if(dirname(resolve(directory))!==resolve(tmpdir())||!basename(directory).startsWith("camacho-electron-custody-"))throw Error("CUSTODY_CLEANUP_PATH_REJECTED");
    rmSync(directory,{recursive:true,force:true});
  }
});
