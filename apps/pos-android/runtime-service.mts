import { AndroidServiceFoundation } from "../pos-local-service/src/android/android-service-foundation.js";

if(process.platform!=="android")throw new Error("ANDROID_HOST_REQUIRED");
const directory=process.env.CAMACHO_ANDROID_SERVICE_DIRECTORY;
if(!directory||(!directory.startsWith("/data/user/0/co.camachopos.android.runtimeprobe/files/")&&!directory.startsWith("/data/data/co.camachopos.android.runtimeprobe/files/")))throw new Error("ANDROID_PRIVATE_SERVICE_DIRECTORY_REQUIRED");
if(!directory.endsWith("/android-local-service"))throw new Error("ANDROID_SERVICE_DIRECTORY_REJECTED");
const service=new AndroidServiceFoundation(directory);
let stopping:Promise<void>|undefined;
function report() { process.stdout.write(JSON.stringify({...service.status(),process_id:process.pid})+"\n"); }
function stop(code:number) {
  stopping??=(async()=>{try{await service.stop();report();}finally{process.exitCode=code;process.stdin.destroy();}})();
  return stopping;
}
await service.start();report();
// This is an inherited OS pipe from the same-UID native parent, never a network/React protocol.
let control=Buffer.alloc(0);
process.stdin.on("data",(chunk:Buffer)=>{
  if(stopping)return;
  if(control.length+chunk.length>5){void stop(1);return;}
  control=Buffer.concat([control,chunk]);
  if(control.includes(10))void stop(control.toString("ascii")==="STOP\n"?0:1);
});
process.stdin.on("end",()=>{void stop(0);});
process.on("SIGTERM",()=>{void stop(0);});
process.on("SIGINT",()=>{void stop(0);});
process.stdin.resume();
