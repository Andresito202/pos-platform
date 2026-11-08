import {spawn} from "node:child_process";
import {createServer} from "node:net";
import {createRequire} from "node:module";
import {randomUUID} from "node:crypto";
import {mkdtemp,rm,copyFile,mkdir,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve,dirname,basename} from "node:path";
import {fileURLToPath} from "node:url";

export async function exercisePlatformAdministrationBrowser(input:{origin:string;fingerprint:string;email:string;password:string;credentialId:string;privateKey:string;counter:number;planCode:string}){
  const desktop=fileURLToPath(new URL("../../../pos-desktop/",import.meta.url));
  const dir=await mkdtemp(join(tmpdir(),"camacho-platform-ui-")),pipe="\\\\.\\pipe\\camacho-platform-test-"+randomUUID();
  const server=createServer(socket=>socket.end(JSON.stringify(input)));
  let child:ReturnType<typeof spawn>|undefined;
  try{
    await new Promise<void>((yes,no)=>{server.once("error",no);server.listen(pipe,yes);});
    const env:NodeJS.ProcessEnv={...process.env,CAMACHO_PLATFORM_TEST_DIRECTORY:dir,CAMACHO_PLATFORM_TEST_PIPE:pipe};delete env.ELECTRON_RUN_AS_NODE;
    child=spawn(createRequire(join(desktop,"package.json"))("electron") as string,[join(desktop,"e2e/platform-administration-entry.mjs")],
      {cwd:desktop,env,windowsHide:true,stdio:["ignore","pipe","pipe"]});
    const observed=await new Promise<Record<string,unknown>>((yes,no)=>{
      let output="",error="";const timeout=setTimeout(()=>no(Error("PLATFORM_UI_TIMEOUT: "+error)),45000);
      child!.stdout!.on("data",b=>{output+=String(b);const result=output.split("\n").find(line=>line.includes('"platformUi":true'));
        if(result){clearTimeout(timeout);yes(JSON.parse(result));}});
      child!.stderr!.on("data",b=>{error=(error+String(b)).slice(-3000);});
      child!.once("error",e=>{clearTimeout(timeout);no(e);});child!.once("exit",()=>{clearTimeout(timeout);if(!output.includes('"platformUi":true'))no(Error("PLATFORM_UI_FAILED: "+error));});
    });
    const target=process.env.POS_E2E_AUDIT_DIRECTORY;
    if(target){await mkdir(target,{recursive:true});await copyFile(join(dir,"platform-published.png"),join(target,"platform-published.png"));
      await writeFile(join(target,"platform-observations.json"),JSON.stringify(observed,null,2));}
    return observed;
  }finally{
    server.close();if(child?.exitCode===null){child.kill();await new Promise<void>(yes=>{child!.once("exit",()=>yes());setTimeout(yes,3000);});}
    if(dirname(resolve(dir))!==resolve(tmpdir())||!basename(dir).startsWith("camacho-platform-ui-"))throw Error("PLATFORM_UI_CLEANUP_REJECTED");
    await rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
}
