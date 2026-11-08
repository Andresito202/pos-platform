import type {Server} from "node:https";

/** Stop accepting requests, drain HTTP, then release PostgreSQL. The caller owns
 * process exit on deadline; no credentials/SQL diagnostics are logged here. */
export async function drainCentralServer(server:Server,pool:{end():Promise<void>},timeoutMs:number):Promise<"DRAINED"|"DEADLINE">{
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<=0)throw Error("CENTRAL_SHUTDOWN_POLICY_REQUIRED");
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([
    new Promise<"DRAINED">((resolve,reject)=>{server.close(error=>{
      if(error){reject(Error("CENTRAL_SERVER_DRAIN_FAILED"));return;}
      void pool.end().then(()=>resolve("DRAINED"),()=>reject(Error("CENTRAL_DATABASE_DRAIN_FAILED")));
    });server.closeIdleConnections();}),
    new Promise<"DEADLINE">((resolve)=>{timer=setTimeout(()=>{server.closeAllConnections();resolve("DEADLINE");},timeoutMs);}),
  ]);}finally{if(timer)clearTimeout(timer);}
}
