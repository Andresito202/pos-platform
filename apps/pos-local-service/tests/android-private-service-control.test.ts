import { mkdtempSync,rmSync,realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename,dirname,join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { expect,it } from "vitest";
import { AndroidPrivateServiceControl } from "../src/android/android-private-service-control.js";

it("private control rejects replay, malformed/unbounded input and any authority-changing operation",()=>{
  for(const command of ["LICENSE_INFORMATION 1\nLICENSE_INFORMATION 1\n","LICENSE_INFORMATION 2\n","SIGN /path\n","PROVISION {}\n","LICENSE_INFORMATION 01\n","x".repeat(81),"LICENSE_INFORMATION 1\u0000\n"]){
    const stopped:number[]=[],replies:unknown[]=[];
    const c=new AndroidPrivateServiceControl(()=>({status:"UNVERIFIED",signedValidUntil:null,lastAcceptedLocalCheck:null,evaluatedAt:null}),r=>replies.push(r),code=>stopped.push(code));
    for(const byte of Buffer.from(command))c.accept(Buffer.from([byte]));
    expect(stopped).toEqual([1]);c.end();expect(stopped).toEqual([1]);expect(replies.length).toBeLessThanOrEqual(1);
  }
});

it("simulated native parent crosses real inherited OS pipes to the SQLite service; disconnect and restart never grant trust",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"camacho-android-pipe-"));
  const run=(input:string)=>new Promise<{code:number|null;frames:any[]}>( (resolve,reject)=>{
    const child=spawn(process.execPath,["--import","tsx",fileURLToPath(new URL("./fixtures/android-service-control-child.ts",import.meta.url)),dir],{cwd:fileURLToPath(new URL("..",import.meta.url)),stdio:["pipe","pipe","pipe"]});
    let output="",error="";
    const timeout=setTimeout(()=>{child.kill();reject(Error("SIMULATED_PIPE_TIMEOUT"));},15000);
    child.stdout.on("data",chunk=>{output+=chunk;if(output.length>8192)child.kill();});child.stderr.on("data",chunk=>{error+=chunk;});
    child.on("error",reject);child.on("close",code=>{clearTimeout(timeout);if(error&&!output)reject(Error(error));else resolve({code,frames:output.trim()?output.trim().split("\n").map(s=>JSON.parse(s)):[]});});
    child.stdin.end(input);
  });
  try {
    const first=await run("LICENSE_INFORMATION 1\nLICENSE_INFORMATION 2\nSTOP\n");
    expect(first.code).toBe(0);expect(first.frames.map(f=>f.request)).toEqual([1,2]);
    expect(first.frames.every(f=>f.information.status==="UNVERIFIED")).toBe(true);
    const replay=await run("LICENSE_INFORMATION 1\nLICENSE_INFORMATION 1\n");expect(replay.code).toBe(1);expect(replay.frames).toHaveLength(1);
    const disconnected=await run("LICENSE_INFORMATION 1\n");expect(disconnected.code).toBe(0);expect(disconnected.frames[0].information.status).toBe("UNVERIFIED");
  }finally{const target=realpathSync(dir);if(dirname(target)!==realpathSync(tmpdir())||!basename(target).startsWith("camacho-android-pipe-"))throw Error("CLEANUP_REJECTED");rmSync(target,{recursive:true,force:true});}
},45000);
