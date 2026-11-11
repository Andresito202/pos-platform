import {execFileSync} from "node:child_process";
import {existsSync,mkdtempSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,basename,dirname,resolve} from "node:path";
import {request} from "node:https";
import type {Server} from "node:https";

export function labOpenSslExecutable(){return process.env.OPENSSL_EXECUTABLE??(existsSync("C:/Program Files/Git/usr/bin/openssl.exe")?"C:/Program Files/Git/usr/bin/openssl.exe":"openssl");}

/** Ephemeral TLS identity only for reserved .test name. Never installed in OS trust. */
export function labTls(){
  const directory=mkdtempSync(join(tmpdir(),"camacho-auth-tls-"));
  const executable=labOpenSslExecutable();
  try{
    execFileSync(executable,["req","-x509","-newkey","rsa:3072","-nodes","-days","1","-subj","/CN=business.example.test",
      "-addext","subjectAltName=DNS:business.example.test","-keyout",join(directory,"key.pem"),"-out",join(directory,"cert.pem")],{stdio:"ignore"});
    return {key:readFileSync(join(directory,"key.pem")),cert:readFileSync(join(directory,"cert.pem"))};
  }finally{
    if(dirname(resolve(directory))!==resolve(tmpdir())||!basename(directory).startsWith("camacho-auth-tls-"))throw Error("LAB_TLS_CLEANUP_PATH_REJECTED");
    rmSync(directory,{recursive:true,force:true});
  }
}
export function postLabHttps(server:Server,ca:Buffer,path:string,payload:unknown,headers:Record<string,string|string[]>={},raw?:string|Buffer){
  const address=server.address();if(!address||typeof address==="string")throw Error("LAB_SERVER_NOT_LISTENING");
  const body=raw??JSON.stringify(payload);
  return new Promise<{status:number;headers:import("node:http").IncomingHttpHeaders;body:Record<string,unknown>}>((resolve,reject)=>{
    const req=request({host:"127.0.0.1",port:address.port,servername:"business.example.test",ca,method:"POST",path,agent:false,
      headers:{host:"business.example.test","content-type":"application/json","content-length":Buffer.byteLength(body),...headers}},res=>{
      const chunks:Buffer[]=[];res.on("data",c=>chunks.push(Buffer.from(c)));res.on("end",()=>{
        try{resolve({status:res.statusCode!,headers:res.headers,body:JSON.parse(Buffer.concat(chunks).toString()) as Record<string,unknown>});}catch(error){reject(error);}
      });
    });req.on("error",reject);req.end(body);
  });
}
export async function closeLabHttps(server:Server){
  server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
}

export function getLabHttps(server:Server,ca:Buffer,path:string,headers:Record<string,string>={}){
  const address=server.address();if(!address||typeof address==="string")throw Error("LAB_SERVER_NOT_LISTENING");
  return new Promise<{status:number;headers:import("node:http").IncomingHttpHeaders;body:string}>((resolve,reject)=>{
    const req=request({host:"127.0.0.1",port:address.port,servername:"business.example.test",ca,method:"GET",path,agent:false,
      headers:{host:"business.example.test",...headers}},res=>{
      const chunks:Buffer[]=[];res.on("data",chunk=>chunks.push(Buffer.from(chunk)));
      res.on("end",()=>resolve({status:res.statusCode!,headers:res.headers,body:Buffer.concat(chunks).toString("utf8")}));
      res.on("error",reject);
    });req.on("error",reject);req.end();
  });
}
