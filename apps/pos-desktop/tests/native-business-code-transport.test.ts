import {execFileSync} from "node:child_process";
import {existsSync,mkdtempSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,basename,dirname,resolve} from "node:path";
import {randomBytes} from "node:crypto";
import {createServer,type Server, type RequestOptions} from "node:https";
import type {IncomingMessage} from "node:http";
import type {LookupFunction} from "node:net";
import {afterAll,beforeAll,describe,it,expect,vi} from "vitest";

const transport=vi.hoisted(()=>({ca:undefined as Buffer|undefined}));
// Only DNS and the CA for the reserved .test name are injected. The client,
// TCP, TLS validation and HTTP bytes are real. The server here is a response
// fixture, NOT Central Authority or evidence of a human authentication flow.
vi.mock("node:https",async importOriginal=>{
  const actual=await importOriginal<typeof import("node:https")>();
  const lookup:LookupFunction=(_host,options,callback)=>callback(null,options.all?[{address:"127.0.0.1",family:4}]:"127.0.0.1",4);
  return {...actual,request:(url:URL,options:RequestOptions,callback:(res:IncomingMessage)=>void)=>
    actual.request(url,{...options,ca:transport.ca,lookup},callback)};
});
import {exchangeNativeBusinessCode} from "../src/native-business-login.js";

describe("native token back-channel over real laboratory TLS",()=>{
  let server:Server,port:number;
  let status=200,reply:unknown,contentType="application/json",cache="no-store",hang=false,calls=0;
  let received:{headers:IncomingMessage["headers"];body:unknown;path:string|undefined;method:string|undefined}|undefined;
  const credentials={accessToken:Array.from({length:3},()=>randomBytes(24).toString("base64url")).join("."),refreshToken:randomBytes(48).toString("base64url")};
  const input={code:"c".repeat(64),verifier:"v".repeat(64),state:"s".repeat(43)};
  const registration=()=>({clientId:"desktop",redirectUri:"http://127.0.0.1:42133/callback",authorizationOrigin:`https://business.example.test:${port}`});
  beforeAll(async()=>{
    const directory=mkdtempSync(join(tmpdir(),"camacho-native-https-"));
    let key:Buffer,cert:Buffer;
    try{
      const executable=process.env.OPENSSL_EXECUTABLE??(existsSync("C:/Program Files/Git/usr/bin/openssl.exe")?"C:/Program Files/Git/usr/bin/openssl.exe":"openssl");
      execFileSync(executable,["req","-x509","-newkey","rsa:3072","-nodes","-days","1","-subj","/CN=business.example.test","-addext","subjectAltName=DNS:business.example.test","-keyout",join(directory,"key.pem"),"-out",join(directory,"cert.pem")],{stdio:"ignore"});
      key=readFileSync(join(directory,"key.pem"));cert=readFileSync(join(directory,"cert.pem"));
    }finally{
      if(dirname(resolve(directory))!==resolve(tmpdir())||!basename(directory).startsWith("camacho-native-https-"))throw Error("NATIVE_TLS_CLEANUP_PATH_REJECTED");
      rmSync(directory,{recursive:true,force:true});
    }
    transport.ca=cert;reply=credentials;
    server=createServer({key,cert,minVersion:"TLSv1.2"},(req,res)=>{
      const chunks:Buffer[]=[];req.on("data",c=>chunks.push(Buffer.from(c)));req.on("end",()=>{
        calls++;received={headers:req.headers,body:JSON.parse(Buffer.concat(chunks).toString()),path:req.url,method:req.method};
        if(hang)return;
        res.writeHead(status,{"content-type":contentType,"cache-control":cache,...(status===302?{location:"https://evil.example.test/token"}:{})});res.end(JSON.stringify(reply));
      });
    });
    await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));const address=server.address();if(!address||typeof address==="string")throw Error("LAB_ADDRESS_MISSING");port=address.port;
  });
  afterAll(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
  it("sends exact PKCE fields without cookie Origin or a secret client credential",async()=>{
    expect(await exchangeNativeBusinessCode(registration(),input,1000)).toEqual(credentials);
    expect(received?.headers.origin).toBeUndefined();expect(received?.headers.cookie).toBeUndefined();expect(received?.headers.authorization).toBeUndefined();
    expect(received).toMatchObject({path:"/v1/commercial/token",method:"POST",body:{grant_type:"authorization_code",code:input.code,
      code_verifier:input.verifier,state:input.state,client_id:"desktop",redirect_uri:registration().redirectUri}});
  });
  it("rejects redirects without following a new origin",async()=>{
    status=302;const before=calls;
    try{await expect(exchangeNativeBusinessCode(registration(),input,1000)).rejects.toThrow("NATIVE_EXCHANGE_REJECTED");expect(calls-before).toBe(1);}finally{status=200;}
  });
  it("rejects uncacheable-contract violations extra response fields and oversized responses",async()=>{
    try{
      cache="public";await expect(exchangeNativeBusinessCode(registration(),input,1000)).rejects.toThrow("NATIVE_EXCHANGE_REJECTED");cache="no-store";
      contentType="text/html";await expect(exchangeNativeBusinessCode(registration(),input,1000)).rejects.toThrow("NATIVE_EXCHANGE_REJECTED");contentType="application/json";
      for(const candidate of [{...credentials,userId:"untrusted"},{accessToken:"x".repeat(20_000),refreshToken:credentials.refreshToken}]){
        reply=candidate;await expect(exchangeNativeBusinessCode(registration(),input,1000)).rejects.toThrow("NATIVE_EXCHANGE_REJECTED");
      }
    }finally{cache="no-store";contentType="application/json";reply=credentials;}
  });
  it("rejects an untrusted TLS certificate and an exchange timeout",async()=>{
    const ca=transport.ca;transport.ca=Buffer.from("untrusted laboratory CA");
    try{await expect(exchangeNativeBusinessCode(registration(),input,1000)).rejects.toThrow("NATIVE_EXCHANGE_REJECTED");}finally{transport.ca=ca;}
    hang=true;try{await expect(exchangeNativeBusinessCode(registration(),input,40)).rejects.toThrow("NATIVE_EXCHANGE_REJECTED");}finally{hang=false;}
  });
  it("rejects malformed code or verifier before network activity",()=>{
    const before=calls;
    expect(()=>exchangeNativeBusinessCode(registration(),{...input,verifier:"short"},1000)).toThrow("NATIVE_EXCHANGE_INPUT_REJECTED");
    expect(calls).toBe(before);
  });
});
