import {createReadStream,lstatSync} from "node:fs";
import {isAbsolute,join} from "node:path";
import {pipeline} from "node:stream/promises";
import type {IncomingMessage,ServerResponse} from "node:http";
import {TLSSocket} from "node:tls";

/** Installer-managed renderer build only; no arbitrary paths, listings,
 * sourcemaps, Node/preload entry or configuration/credential files. */
export function createGlobalAdministrationAssets(input:{directory:string;origin:string;maximumAssetBytes:number}){
  if(!isAbsolute(input.directory)||!Number.isSafeInteger(input.maximumAssetBytes)||input.maximumAssetBytes<=0)throw Error("GLOBAL_ASSETS_EXPLICIT_POLICY_REQUIRED");
  const root=lstatSync(input.directory),assets=lstatSync(join(input.directory,"assets")),html=lstatSync(join(input.directory,"platform.html"));
  if(!root.isDirectory()||root.isSymbolicLink()||!assets.isDirectory()||assets.isSymbolicLink()||!html.isFile()||html.isSymbolicLink()||html.size>input.maximumAssetBytes)
    throw Error("GLOBAL_ASSETS_MANAGED_BUILD_REQUIRED");
  const mime:Record<string,string>={js:"text/javascript; charset=utf-8",css:"text/css; charset=utf-8",png:"image/png",svg:"image/svg+xml",woff:"font/woff",woff2:"font/woff2",ttf:"font/ttf"};
  return async(req:IncomingMessage,res:ServerResponse)=>{
    if(!(req.socket instanceof TLSSocket)||!req.socket.encrypted||req.headers.host!==new URL(input.origin).host||req.method!=="GET"){
      res.writeHead(403,{"content-length":"0","cache-control":"no-store"});res.end();return;}
    if(req.url==="/platform"){res.writeHead(303,{location:"/platform/","content-length":"0","cache-control":"no-store"});res.end();return;}
    let file:string,type:string;
    if(req.url==="/platform/"){file=join(input.directory,"platform.html");type="text/html; charset=utf-8";}
    else{
      const match=/^\/platform\/assets\/([A-Za-z0-9_-][A-Za-z0-9_.-]*\.(js|css|png|svg|woff2?|ttf))$/.exec(req.url??"");
      if(!match||match[1]!.includes("..")){res.writeHead(404,{"content-length":"0","cache-control":"no-store"});res.end();return;}
      file=join(input.directory,"assets",match[1]!);type=mime[match[2]!]!;
    }
    try{
      const stat=lstatSync(file);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size>input.maximumAssetBytes)throw Error();
      res.writeHead(200,{"content-type":type,"content-length":stat.size,"cache-control":"no-store","x-content-type-options":"nosniff",
        "referrer-policy":"no-referrer","x-frame-options":"DENY","cross-origin-resource-policy":"same-origin","cross-origin-opener-policy":"same-origin",
        "content-security-policy":"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"});
      await pipeline(createReadStream(file),res);
    }catch{
      if(res.headersSent)res.destroy();else{res.writeHead(404,{"content-length":"0","cache-control":"no-store"});res.end();}
    }
  };
}
