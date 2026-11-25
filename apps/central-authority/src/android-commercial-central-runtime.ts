import {openSync,closeSync,fstatSync,readFileSync,constants} from "node:fs";
import {isAbsolute,join} from "node:path";
import {createPrivateKey,createPublicKey,createHash} from "node:crypto";
import {TLSSocket} from "node:tls";
import type {IncomingMessage,ServerResponse} from "node:http";
import {BusinessAdministrationProvisionSchema,CommercialHttpV2,CommercialRefreshRequestSchema,UuidSchema,UuidV7Schema,uuidV7,
 SignedSessionAssertionOperationalKeySchema,SignedAuthorizationTrustSchema,type NativeClientRegistration} from "@pos-platform/contracts";
import type {Pool} from "@pos-platform/database-postgres";
import {NativeBusinessCodeAuthority} from "./native-business-code-authority.js";
import {NativeBusinessRequestRegistration,createNativeRequestHandler} from "./native-business-request-registration.js";
import {CommercialNativeCredentialAuthority} from "./commercial-native-credential-authority.js";
import {CommercialSessionArtifacts} from "./commercial-session-artifacts.js";
import {inspectCommercialHeaders,readCommercialJsonBody,sendCommercialJson} from "./commercial-https-request-boundary.js";
import {PostgresFixedWindowRateLimiter} from "./postgres-fixed-window-rate-limiter.js";
import * as z from "zod";
const managed=(path:string,max=65536)=>{
 if(!isAbsolute(path))throw Error("ANDROID_COMMERCIAL_MANAGED_PATH_REQUIRED");
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const s=fstatSync(fd);if(!s.isFile()||s.size<=0||s.size>max||(process.platform!=="win32"&&(s.mode&0o077)!==0))throw Error("ANDROID_COMMERCIAL_FILE_REJECTED");
 const bytes=readFileSync(fd);if(bytes.length!==s.size)throw Error("ANDROID_COMMERCIAL_FILE_CHANGED");return new TextDecoder("utf-8",{fatal:true}).decode(bytes);}
 finally{closeSync(fd);}
};
const ids=["011_session_assertion_sequences","012_device_request_proof_replays","013_business_browser_sessions","014_commercial_refresh_binding","015_authorization_snapshot_sequences","016_native_business_authorization","022_license_activations","029_cash_register_master","033_cash_register_license_bindings","036_business_login_abuse_budget"];
const positive=z.number().int().positive().max(2147483647);
const file=z.string().min(1).max(4096);
const pin=z.string().regex(/^[a-f0-9]{64}$/);
const policySchema=z.strictObject({profile:z.literal("CAMACHO_ANDROID_CENTRAL_V1"),origin:z.url(),environment:z.enum(["PREPRODUCTION","PRODUCTION"]),
 migration_checksums:z.record(z.string(),pin),audience:z.string().min(1).max(128),
 access_private:file,access_public:file,access_key_id:z.string().min(1).max(96),access_valid_from:z.iso.datetime(),access_valid_until:z.iso.datetime(),
 ssa_private:file,ssa_root:file,ssa_root_pin:pin,ssa_operational:file,sas_private:file,sas_root:file,sas_root_pin:pin,sas_recipient_directory:file,
 challenge_ms:positive,request_ms:positive,challenges_per_minute:positive,code_ms:positive,access_ms:positive,refresh_ms:positive,artifact_ms:positive,
 proof_skew_ms:positive,rotation_window_ms:positive,rotations_per_window:positive,requests_per_address:positive});
const paths=new Set(["/v1/commercial/token","/v1/business-session/assertions","/v1/business-session/authorization","/v1/commercial/native-authorize","/v1/commercial/login"]);
export async function prepareAndroidCommercialRuntime(input:{pool:Pool;provisionFile:string;businessProvision:string;origin:string;environment:"PREPRODUCTION"|"PRODUCTION";registration:NativeClientRegistration}){
 const {pool,registration,origin}=input;
 const p=policySchema.parse(JSON.parse(managed(input.provisionFile))),business=BusinessAdministrationProvisionSchema.parse(JSON.parse(managed(input.businessProvision)));
 if(p.origin!==origin||business.origin!==origin||p.environment!==input.environment||registration.authorizationOrigin!==origin||registration.platform!=="ANDROID"||Object.keys(p.migration_checksums).length!==ids.length||!ids.every(id=>p.migration_checksums[id]))throw Error("ANDROID_COMMERCIAL_POLICY_REJECTED");
 const role=(await pool.query("SELECT current_database() AS db,current_user='pos_platform_app' AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AS eligible FROM pg_roles WHERE rolname=current_user")).rows[0];
 if(role?.db!=="camacho_pos"||role.eligible!==true)throw Error("ANDROID_COMMERCIAL_DATABASE_REJECTED");
 for(const id of ids){const rows=(await pool.query("SELECT encode(checksum,'hex') AS checksum FROM platform.target_migration_executions WHERE migration_id=$1 AND status='APPLIED'",[id])).rows;if(rows.length!==1||rows[0].checksum!==p.migration_checksums[id])throw Error("ANDROID_COMMERCIAL_SCHEMA_REJECTED");}
 const root=(path:string,digest:string)=>{const key=createPublicKey(managed(path));if(key.asymmetricKeyType!=="ed25519"||createHash("sha256").update(key.export({type:"spki",format:"der"})).digest("hex")!==digest)throw Error("ANDROID_COMMERCIAL_ROOT_REJECTED");return key;};
 const ssaPrivate=createPrivateKey(managed(p.ssa_private)),sasPrivate=createPrivateKey(managed(p.sas_private)),accessPrivate=managed(p.access_private);
 const fingerprints=[ssaPrivate,sasPrivate,createPrivateKey(accessPrivate)].map(k=>createPublicKey(k).export({type:"spki",format:"der"}).toString("hex"));
 if(new Set(fingerprints).size!==3||!isAbsolute(p.sas_recipient_directory))throw Error("ANDROID_COMMERCIAL_KEY_SEPARATION_REQUIRED");
 const l=business.limits,reauth=Math.min(l.reauthentication_ms,l.mfa_age_ms),idle=Math.min(l.idle_ms,300000);
 const codes=new NativeBusinessCodeAuthority(pool,registration,{codeMs:p.code_ms,reauthMs:reauth,idleMs:idle});
 const credentials=new CommercialNativeCredentialAuthority(pool,registration,{privatePem:accessPrivate,publicPem:managed(p.access_public)},
 {origin,audience:p.audience,clientId:registration.clientId,lifetimeMs:p.refresh_ms,maximumReauthenticationAgeMs:reauth,maximumProofSkewMs:p.proof_skew_ms,rotationWindowMs:p.rotation_window_ms,maximumRotationsPerWindow:p.rotations_per_window},
 {issuer:origin,audience:p.audience,clientId:registration.clientId,keyId:p.access_key_id,accessLifetimeMs:p.access_ms,maximumProofSkewMs:p.proof_skew_ms,signingValidFrom:p.access_valid_from,signingValidUntil:p.access_valid_until},codes);
 const artifacts=new CommercialSessionArtifacts(pool,credentials,{issuer:origin,environment:p.environment,ssaPrivate,ssaRoot:root(p.ssa_root,p.ssa_root_pin),ssaOperational:SignedSessionAssertionOperationalKeySchema.parse(JSON.parse(managed(p.ssa_operational))),
 sasPrivate,sasRoot:root(p.sas_root,p.sas_root_pin),lifetimeMs:p.artifact_ms,resolveTrust:async scope=>SignedAuthorizationTrustSchema.parse(JSON.parse(managed(join(p.sas_recipient_directory,UuidSchema.parse(scope.deviceId)+".json"))))});
 const registrationHandler=createNativeRequestHandler(new NativeBusinessRequestRegistration(pool,registration,{challengeMs:p.challenge_ms,requestMs:p.request_ms,challengesPerMinute:p.challenges_per_minute}),origin);
 const limiter=new PostgresFixedWindowRateLimiter(pool,p.requests_per_address,60000);
 return async(req:IncomingMessage,res:ServerResponse)=>{
 const url=new URL(req.url??"/",origin);
 const native=url.pathname==="/v1/commercial/native-request-challenges"||url.pathname==="/v1/commercial/native-requests";
 if(!native&&!paths.has(url.pathname))return false;
 try{
 inspectCommercialHeaders(req);
 if(!(req.socket instanceof TLSSocket)||!req.socket.encrypted||req.headers.host!==new URL(origin).host){sendCommercialJson(res,403,{code:"NATIVE_ORIGIN_REJECTED"});return true;}
 if(!await limiter.allow("android-native:"+createHash("sha256").update(req.socket.remoteAddress??"unknown").digest("hex"))){sendCommercialJson(res,429,{code:"NATIVE_RATE_LIMITED"});return true;}
 if(url.pathname==="/v1/commercial/login"){
 const selector=url.searchParams.get("request");
 if(req.method!=="GET"||!selector||!/^[A-Za-z0-9_-]{43}$/.test(selector)||Array.from(url.searchParams.keys()).join(",")!=="request"){sendCommercialJson(res,400,{code:"NATIVE_LOGIN_REJECTED"});return true;}
 res.writeHead(303,{location:"/business/#native-request="+selector,"cache-control":"no-store","referrer-policy":"no-referrer","content-length":"0"});res.end();return true;
 }
 if(req.method!=="POST"||req.url!==url.pathname){sendCommercialJson(res,405,{code:"NATIVE_METHOD_REJECTED"});return true;}
 if(native)return registrationHandler(req,res);
 const {object,raw}=await readCommercialJsonBody(req,16384);
 if(url.pathname==="/v1/commercial/native-authorize"){
 if(Object.keys(object).length!==1||typeof object.request!=="string"){sendCommercialJson(res,400,{code:"NATIVE_REQUEST_INVALID"});return true;}
 const result=await codes.issue(object.request,{method:req.method,origin:typeof req.headers.origin==="string"?req.headers.origin:null,fetchSite:typeof req.headers["sec-fetch-site"]==="string"?req.headers["sec-fetch-site"]:null,cookie:req.headers.cookie??null,csrfToken:typeof req.headers["x-csrf-token"]==="string"?req.headers["x-csrf-token"]:null},uuidV7());
 sendCommercialJson(res,result?200:403,result??{code:"NATIVE_AUTHORIZATION_REJECTED"});return true;
 }
 const requestId=UuidSchema.safeParse(req.headers["x-request-id"]),correlationId=UuidV7Schema.safeParse(req.headers["x-correlation-id"]);
 if(!requestId.success||!correlationId.success||typeof req.headers.authorization!=="string"){sendCommercialJson(res,400,{code:"NATIVE_PROOF_REQUIRED"});return true;}
 const proof={requestId:requestId.data,correlationId:correlationId.data,authorization:req.headers.authorization,body:raw};
 let result:unknown;
 if(url.pathname==="/v1/commercial/token"){
 if(object.grant_type==="refresh_token"){const parsed=CommercialRefreshRequestSchema.safeParse(object);const rotated=parsed.success?await credentials.refresh(parsed.data.refresh_token,proof):null;result=rotated?.status==="ROTATED"?{accessToken:rotated.access,refreshToken:rotated.refreshToken}:null;}
 else result=await credentials.exchange(proof);
 }else{
 const token=req.headers[CommercialHttpV2.accessHeader];result=typeof token==="string"?await artifacts.issue(token,proof,url.pathname==="/v1/business-session/assertions"?"SESSION_ASSERTION":"AUTHORIZATION_SNAPSHOT"):null;
 }
 sendCommercialJson(res,result?200:403,result??{code:"NATIVE_OPERATION_REJECTED"});
 }catch(error){const status=(error as {status?:number})?.status;sendCommercialJson(res,status&&[400,413,415].includes(status)?status:503,{code:"NATIVE_OPERATION_UNAVAILABLE"});}
 return true;
 };
}
export function isAndroidCommercialRoute(url:string|undefined){return typeof url==="string"&&paths.has(url.split("?")[0]!);}
