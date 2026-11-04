/**
 * Lab-only first human WebAuthn ceremony. No BUSINESS, SSA or MFA SATISFIED
 * is manufactured. The actual elevated Windows operator issues one bootstrap
 * capability; the canonical enrollment owner verifies real attestation + UV.
 */
import {createServer} from "node:https";
import {TLSSocket} from "node:tls";
import {randomBytes,createHash,timingSafeEqual,X509Certificate} from "node:crypto";
import {readFileSync,writeFileSync,existsSync,lstatSync} from "node:fs";
import {join,resolve} from "node:path";
import {execFileSync} from "node:child_process";
import {pathToFileURL} from "node:url";
import {createPostgresPool,PostgresPasswordCredentialVerificationRepository,PostgresPlatformWebAuthnChallengeRepository,PostgresPlatformWebAuthnEnrollmentTransaction} from "../../packages/database-postgres/src/index.js";
import {uuidV7} from "../../packages/contracts/src/index.js";
import {createPlatformPasswordVerifier,verifyPlatformPasswordVerifier,verifyStoredPlatformPassword} from "../../apps/central-authority/src/platform-password-verifier.js";
import {enrollPlatformWebAuthnWithVerifiedRegistration} from "../../apps/central-authority/src/platform-webauthn-enrollment-commit.js";
import {FixedWindowRateLimiter} from "../../apps/central-authority/src/fixed-window-rate-limiter.js";

const origin="https://auth.camacho-pos.local:8443",rpId="auth.camacho-pos.local";
const digest=(s:string)=>createHash("sha256").update(s).digest();
function same(a:string,b:string){return a.length===b.length&&timingSafeEqual(digest(a),digest(b));}
function ownedFile(file:string){const s=lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.size>1_048_576)throw Error("LAB_FILE_REJECTED");return readFileSync(file);}
export function renderLabEnrollmentPage(nonce:string,resume:boolean){return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Camacho POS — Registro MFA del laboratorio</title>
<style nonce="${nonce}">body{font:16px "Segoe UI",sans-serif;background:#f3f6f8;color:#142b3a;max-width:560px;margin:5vh auto;padding:24px}main{background:white;border:1px solid #d6dfe6;padding:28px;border-top:4px solid #087052}label{display:block;margin:18px 0}input,button{display:block;box-sizing:border-box;width:100%;min-height:44px;padding:10px;margin-top:6px;font:inherit}button{background:#087052;color:white;border:0;cursor:pointer}#status{white-space:pre-wrap}</style>
<main><p>LABORATORIO AISLADO · Sin acceso productivo</p><h1>${resume?"Reanuda el registro de tu autenticador":"Configura tu autenticador"}</h1>
<p>${resume?"El intento anterior quedó pendiente. Confirma la misma contraseña que usaste al crear esta cuenta de Camacho POS; aquí no se consulta Microsoft.":"Registra tu llave o passkey. Se exigirá verificación de usuario."}</p>
<form id="enroll">${resume?"":"<label>Nombre<input name=\"name\" required maxlength=\"128\" autocomplete=\"name\"></label>"}
<label>Correo<input name="email" type="email" required maxlength="320" autocomplete="username"></label>
<label>${resume?"Contraseña original usada al crear la cuenta de Camacho POS":"Contraseña de la cuenta de Camacho POS"}<input name="password" type="password" required minlength="12" maxlength="256" autocomplete="${resume?"current-password":"new-password"}"></label>
<button>${resume?"Reanudar registro":"Registrar autenticador"}</button></form><p id="status" role="status" aria-live="polite"></p></main>
<script nonce="${nonce}">(()=>{"use strict";
const form=document.getElementById("enroll"),status=document.getElementById("status");
let ticket=location.hash.slice(1);history.replaceState(null,"","/");
const decode=s=>Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/")),c=>c.charCodeAt(0));
const encode=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=+$/,"");
async function post(path,body){const r=await fetch(path,{method:"POST",credentials:"same-origin",cache:"no-store",redirect:"error",headers:{"content-type":"application/json"},body:JSON.stringify(body)});if(!r.ok){const result=await r.json().catch(()=>({}));const messages={LAB_OPERATOR_CAPABILITY_REQUIRED:"El enlace de registro venció o ya se usó. Hace falta un enlace nuevo.",LAB_CREDENTIALS_REJECTED:"No se verificaron las credenciales del laboratorio. Revisa el correo y la contraseña; la autorización aún puede reintentarse.",LAB_ENROLLMENT_PROOF_REQUIRED:"El desafío de autenticación venció. Hace falta iniciar una reanudación nueva.",LAB_REAL_WEBAUTHN_REGISTRATION_REJECTED:"El autenticador no completó la verificación requerida. No quedó registrado."};throw Error(messages[result.code]||"No se completó el registro ("+(result.code||"respuesta rechazada")+"). No se ha iniciado una sesión comercial.");}return r.json();}
form.addEventListener("submit",async event=>{event.preventDefault();const button=form.querySelector("button");button.disabled=true;
let password=form.elements.password.value;form.elements.password.value="";
try{if(!isSecureContext||!window.PublicKeyCredential)throw Error("WebAuthn no está disponible en este navegador.");
status.textContent="Preparando el registro seguro…";
const input={ticket,email:form.elements.email.value,password};${resume?"":"input.name=form.elements.name.value;"}const options=await post("/begin",input);password="";ticket="";
status.textContent="Sigue el selector de autenticador del PC. Si ofrece Android u otro dispositivo, escanea el QR con tu Motorola. Se exigirá verificación de usuario.";
const credential=await navigator.credentials.create({publicKey:{challenge:decode(options.challenge),rp:{id:options.rpId,name:"Camacho POS — Laboratorio"},user:{id:new TextEncoder().encode(options.userId),name:form.elements.email.value,displayName:options.userName},pubKeyCredParams:[{type:"public-key",alg:-7}],authenticatorSelection:{userVerification:"required",residentKey:"preferred"},timeout:300000,attestation:"none"}});
if(!credential||credential.type!=="public-key")throw Error("No se recibió una credencial WebAuthn.");
const response=credential.response;
await post("/complete",{challenge:options.challenge,csrf:options.csrf,response:{id:credential.id,rawId:encode(credential.rawId),type:"public-key",clientExtensionResults:credential.getClientExtensionResults(),response:{clientDataJSON:encode(response.clientDataJSON),attestationObject:encode(response.attestationObject),transports:response.getTransports?response.getTransports():[]}}});
form.hidden=true;status.textContent="Autenticador registrado y verificado. Puedes volver a Camacho POS; todavía no se ha iniciado una sesión comercial.";
}catch(error){password="";if(!ticket){status.textContent=String(error.message)+" Si la ceremonia no se completó, cierra esta página y solicita un enlace de reanudación nuevo.";button.disabled=true;}else{status.textContent=String(error.message);button.disabled=false;}}
});
})();</script></html>`;}

export async function startLabEnrollment(labRoot:string){
 if(process.platform!=="win32"||!/^C:\\CamachoPosScmLab\\[a-f0-9]{32}$/.test(labRoot)||resolve(labRoot)!==labRoot)throw Error("ISOLATED_WINDOWS_LAB_REQUIRED");
 const operator=execFileSync("powershell.exe",["-NoProfile","-NonInteractive","-Command",
  "$i=[Security.Principal.WindowsIdentity]::GetCurrent();$p=[Security.Principal.WindowsPrincipal]::new($i);if(-not $i.IsAuthenticated -or $i.IsSystem -or [Diagnostics.Process]::GetCurrentProcess().SessionId -le 0 -or -not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){exit 1};Write-Output LAB_OPERATOR_VERIFIED"],
  {encoding:"utf8",windowsHide:true,timeout:15000}).trim();
 if(operator!=="LAB_OPERATOR_VERIFIED")throw Error("LAB_OPERATOR_REQUIRED");
 const directory=join(labRoot,"central-lab"),state=JSON.parse(ownedFile(join(directory,"database-state.json")).toString("utf8"));
 if(state.profile!=="CAMACHO_WINDOWS_LOGIN_LAB_ONLY"||state.database!=="camacho_windows_login_lab"||state.host!=="127.0.0.1"||state.port!==55433)throw Error("LAB_STATE_REJECTED");
 const completed=join(directory,"human-enrollment.json"),pending=join(directory,"pending-human-enrollment.json");
 if(existsSync(completed))throw Error("HUMAN_ENROLLMENT_ALREADY_COMPLETED");
 const pendingReceipt=existsSync(pending)?JSON.parse(ownedFile(pending).toString("utf8")):undefined;
 if(pendingReceipt&&(pendingReceipt.profile!=="CAMACHO_LAB_ENROLLMENT_PENDING"||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(pendingReceipt.userId)||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(pendingReceipt.sessionId)||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(pendingReceipt.roleAssignment)||
    pendingReceipt.mfa!=="PENDING"||pendingReceipt.businessSessionIssued!==false))throw Error("PENDING_HUMAN_ENROLLMENT_RECEIPT_REJECTED");
 const tls=join(directory,"tls"),ca=ownedFile(join(tls,"lab-root.crt")),cert=ownedFile(join(tls,"central.crt"));
 const parsed=new X509Certificate(cert);
 if(!parsed.checkHost(rpId)||Date.parse(parsed.validTo)<=Date.now()||!new X509Certificate(ca).subject.includes("NOT PRODUCTION"))throw Error("LAB_TLS_SCOPE_REJECTED");
 process.env.PGPASSFILE=join(directory,"pgpass-tls.conf");
 const connection=(role:string)=>{const u=new URL("postgresql://"+role+"@postgres.camacho-pos.local:55433/"+state.database);u.searchParams.set("sslmode","verify-full");u.searchParams.set("sslrootcert",join(tls,"lab-root.crt"));return u.href;};
 const adminUrl=new URL(connection("postgres"));adminUrl.password=ownedFile(join(directory,"postgres-password.txt")).toString("utf8").trim();
 const admin=createPostgresPool(adminUrl.href,1,"windows-lab-enrollment-operator"),app=createPostgresPool(connection("pos_platform_app"),2,"windows-lab-enrollment");
 const checked=await admin.query("SELECT (SELECT count(*)::int FROM identity.users) AS users,(SELECT count(*)::int FROM identity.mfa_factors) AS factors,(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls");
 if(checked.rows[0]?.tls!==true||(!pendingReceipt&&checked.rows[0]?.users!==0)||
    (pendingReceipt&&(checked.rows[0]?.users!==1||checked.rows[0]?.factors!==0))){await admin.end();await app.end();throw Error("LAB_ENROLLMENT_DATABASE_STATE_REJECTED");}
 const rejectionVerifier=await createPlatformPasswordVerifier(randomBytes(32).toString("base64url"),"owasp-19m-t2-p1");
 const ticket=randomBytes(32).toString("base64url"),ticketHash=digest(ticket),ticketUntil=Date.now()+60*60_000;
 const limiter=new FixedWindowRateLimiter(30,1);
 let used=false,busy=false;
 let enrollment:{userId:string;sessionId:string;roleAssignment:string;proofHash:Buffer;csrf:string;challenge:string;expires:number}|undefined;
 const transaction=new PostgresPlatformWebAuthnEnrollmentTransaction(app,async proof=>{
  const e=enrollment;return e&&e.expires>Date.now()&&timingSafeEqual(e.proofHash,digest(proof))?{userId:e.userId,sessionId:e.sessionId}:null;
 },15*60_000);
 const server=createServer({key:ownedFile(join(tls,"central.key")),cert,minVersion:"TLSv1.2"},(request,response)=>{
  const send=(status:number,body:unknown,headers:Record<string,string>={})=>{response.writeHead(status,{"content-type":"application/json","cache-control":"no-store","x-content-type-options":"nosniff",...headers});response.end(JSON.stringify(body));};
  void(async()=>{
   if(!(request.socket instanceof TLSSocket)||!request.socket.encrypted||request.socket.remoteAddress!=="127.0.0.1"||request.headers.host!==new URL(origin).host||!limiter.allow("loopback")){send(403,{code:"LAB_REQUEST_REJECTED"});return;}
    if(request.method==="GET"&&request.url==="/health"){send(200,{profile:"CAMACHO_WINDOWS_LOGIN_LAB_ONLY",state:enrollment?"HUMAN_REGISTRATION_PENDING":pendingReceipt?"RESUMABLE_HUMAN_REGISTRATION":"READY_FOR_HUMAN_REGISTRATION",businessSessionIssued:false});return;}
   if(request.method==="GET"&&request.url==="/"){
    const nonce=randomBytes(24).toString("base64url");
    response.writeHead(200,{"content-type":"text/html; charset=utf-8","cache-control":"no-store","referrer-policy":"no-referrer","x-content-type-options":"nosniff","content-security-policy":"default-src 'none'; style-src 'nonce-"+nonce+"'; script-src 'nonce-"+nonce+"'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});response.end(renderLabEnrollmentPage(nonce,Boolean(pendingReceipt)));return;
   }
   if(request.method!=="POST"||!["/begin","/complete"].includes(request.url??"")||request.headers.origin!==origin||request.headers["content-type"]!=="application/json"||request.headers["sec-fetch-site"]!=="same-origin"||request.headers.forwarded||request.headers["x-forwarded-for"]){send(403,{code:"LAB_ORIGIN_REJECTED"});return;}
   if(busy){send(429,{code:"LAB_BUSY"});return;}busy=true;
   try{
    const chunks:Buffer[]=[];let length=0;for await(const c of request){const b=Buffer.from(c);length+=b.length;if(length>65536)throw Error("LAB_BODY_TOO_LARGE");chunks.push(b);}
    const body=JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if(request.url==="/begin"){
     if(used||Date.now()>ticketUntil||typeof body.ticket!=="string"||!timingSafeEqual(ticketHash,digest(body.ticket))){send(401,{code:"LAB_OPERATOR_CAPABILITY_REQUIRED"});return;}
     const expectedKeys=pendingReceipt?"email,password,ticket":"email,name,password,ticket";
     if(Object.keys(body).sort().join(",")!==expectedKeys||(!pendingReceipt&&(typeof body.name!=="string"||!body.name.trim()||body.name.length>128))||typeof body.email!=="string"||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email)||body.email.length>320||typeof body.password!=="string"||body.password.length<12||body.password.length>256){send(400,{code:"LAB_CREDENTIAL_INPUT_REJECTED"});return;}
     let userId:string,sessionId=uuidV7(),roleAssignment=uuidV7(),userName:string;
     const proof=randomBytes(32).toString("base64url"),csrf=randomBytes(32).toString("base64url");
     if(pendingReceipt){
      const match=await verifyStoredPlatformPassword(new PostgresPasswordCredentialVerificationRepository(app),{email:body.email,password:body.password},{rejectionVerifier});
      body.password="";
      if(!match||match.userId!==pendingReceipt.userId){send(401,{code:"LAB_CREDENTIALS_REJECTED"});return;}
      userId=pendingReceipt.userId;
      const identity=await admin.query<{full_name:string}>("SELECT full_name FROM identity.users WHERE id=$1 AND email_normalized=$2 AND status='ACTIVE'",[userId,body.email.trim().toLowerCase()]);
      if(identity.rows.length!==1){send(401,{code:"LAB_CREDENTIALS_REJECTED"});return;}
      userName=identity.rows[0].full_name;
       const priorRole=await admin.query<{role_id:string}>(`SELECT r.id::text AS role_id FROM "authorization".roles r WHERE r.code='LAB_ENROLLMENT_OPERATOR' AND r.scope_type='PLATFORM' AND r.status='ACTIVE' AND EXISTS(SELECT 1 FROM "authorization".platform_role_assignments pra WHERE pra.role_id=r.id AND pra.user_id=$1)`,[userId]);
      if(priorRole.rows.length!==1)throw Error("PENDING_LAB_ROLE_REJECTED");
      const roleId=priorRole.rows[0].role_id,client=await admin.connect();
      try{
       await client.query("BEGIN");
       await client.query("SELECT set_config('app.audit_id',$1,true),set_config('app.correlation_id',$2,true)",[uuidV7(),uuidV7()]);
       await client.query("UPDATE identity.sessions SET revoked_at=clock_timestamp(),revoked_by_actor_type='SYSTEM',revocation_reason='LAB_ENROLLMENT_RETRY',version=version+1 WHERE user_id=$1 AND mfa_status='PENDING' AND tenant_id IS NULL AND revoked_at IS NULL",[userId]);
       await client.query(`UPDATE "authorization".platform_role_assignments pra SET status='REVOKED',revoked_at=clock_timestamp(),revoked_by_actor_type='SYSTEM',revocation_reason='LAB_ENROLLMENT_RETRY',version=pra.version+1 FROM "authorization".roles r WHERE pra.role_id=r.id AND pra.user_id=$1 AND pra.status='ACTIVE' AND r.code='LAB_ENROLLMENT_OPERATOR'`,[userId]);
       await client.query("SELECT set_config('app.audit_id',$1,true)",[uuidV7()]);
       await client.query(`INSERT INTO "authorization".platform_role_assignments(id,user_id,role_id,status,valid_from,valid_until,created_at,created_by_actor_type) VALUES($1,$2,$3,'ACTIVE',clock_timestamp(),clock_timestamp()+interval '15 minutes',clock_timestamp(),'SYSTEM')`,[roleAssignment,userId,roleId]);
       await client.query("INSERT INTO identity.sessions(id,user_id,authenticated_at,expires_at,last_reauthenticated_at,mfa_status,created_at) VALUES($1,$2,clock_timestamp(),clock_timestamp()+interval '10 minutes',clock_timestamp(),'PENDING',clock_timestamp())",[sessionId,userId]);
       await client.query("COMMIT");
      }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
     }else{
      const verifier=await createPlatformPasswordVerifier(body.password,"owasp-19m-t2-p1");
      if(!await verifyPlatformPasswordVerifier(body.password,verifier))throw Error("LAB_PASSWORD_VERIFICATION_FAILED");body.password="";
      userId=uuidV7();userName=body.name.trim();const roleId=uuidV7();
      const client=await admin.connect();
      try{
       await client.query("BEGIN");
       await client.query("SELECT set_config('app.audit_id',$1,true),set_config('app.correlation_id',$2,true)",[uuidV7(),uuidV7()]);
       if((await client.query("SELECT count(*)::int AS n FROM identity.users")).rows[0].n!==0)throw Error("LAB_IDENTITY_ALREADY_EXISTS");
       await client.query("INSERT INTO identity.users(id,email,email_normalized,full_name,status,created_at,updated_at) VALUES($1,$2,$3,$4,'ACTIVE',clock_timestamp(),clock_timestamp())",[userId,body.email.trim(),body.email.trim().toLowerCase(),userName]);
       await client.query("INSERT INTO identity.user_credentials(id,user_id,credential_type,verifier,status,created_at) VALUES($1,$2,'PASSWORD',$3,'ACTIVE',clock_timestamp())",[uuidV7(),userId,verifier]);
       await client.query("INSERT INTO \"authorization\".roles(id,code,name,scope_type,version,status,created_at) VALUES($1,'LAB_ENROLLMENT_OPERATOR','Operador inicial del laboratorio','PLATFORM',1,'ACTIVE',clock_timestamp())",[roleId]);
       await client.query("INSERT INTO \"authorization\".platform_role_assignments(id,user_id,role_id,status,valid_from,valid_until,created_at,created_by_actor_type) VALUES($1,$2,$3,'ACTIVE',clock_timestamp(),clock_timestamp()+interval '15 minutes',clock_timestamp(),'SYSTEM')",[roleAssignment,userId,roleId]);
       await client.query("INSERT INTO identity.sessions(id,user_id,authenticated_at,expires_at,last_reauthenticated_at,mfa_status,created_at) VALUES($1,$2,clock_timestamp(),clock_timestamp()+interval '10 minutes',clock_timestamp(),'PENDING',clock_timestamp())",[sessionId,userId]);
       await client.query("COMMIT");
      }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
     }
     used=true;
     const receiptPath=pendingReceipt?join(directory,"pending-human-enrollment-resume-"+sessionId+".json"):pending;
     writeFileSync(receiptPath,JSON.stringify({profile:"CAMACHO_LAB_ENROLLMENT_PENDING",userId,sessionId,roleAssignment,createdAt:new Date().toISOString(),mfa:"PENDING",businessSessionIssued:false,...(pendingReceipt?{resumedFrom:"pending-human-enrollment.json"}:{})},null,2),{flag:"wx"});
     const challenge=await new PostgresPlatformWebAuthnChallengeRepository(app).issue({userId,sessionId,factorId:null,purpose:"ENROLL",rpId,expectedOrigin:origin,expiresAt:new Date(Date.now()+5*60_000).toISOString(),correlationId:uuidV7()});
     enrollment={userId,sessionId,roleAssignment,proofHash:digest(proof),csrf,challenge:challenge.challenge,expires:Date.now()+10*60_000};
     send(200,{challenge:challenge.challenge,csrf,userId,userName,rpId},{"set-cookie":"__Host-CamachoLabEnroll="+proof+"; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=600"});return;
    }
    const e=enrollment,proof=request.headers.cookie?.split(";").map(v=>v.trim()).find(v=>v.startsWith("__Host-CamachoLabEnroll="))?.split("=")[1];
    if(!e||e.expires<Date.now()||!proof||typeof body.csrf!=="string"||!same(body.csrf,e.csrf)||body.challenge!==e.challenge){send(401,{code:"LAB_ENROLLMENT_PROOF_REQUIRED"});return;}
    const result=await enrollPlatformWebAuthnWithVerifiedRegistration(transaction,{authorizationProof:proof,challenge:e.challenge,rpId,expectedOrigin:origin},body.response as Parameters<typeof enrollPlatformWebAuthnWithVerifiedRegistration>[2]);
    if(!result){send(401,{code:"LAB_REAL_WEBAUTHN_REGISTRATION_REJECTED"});return;}
    const cleanup=await admin.connect();
    try{
     await cleanup.query("BEGIN");await cleanup.query("SELECT set_config('app.audit_id',$1,true),set_config('app.correlation_id',$2,true)",[uuidV7(),uuidV7()]);
     await cleanup.query("UPDATE identity.sessions SET revoked_at=clock_timestamp(),revoked_by_actor_type='SYSTEM',revocation_reason='LAB_ENROLLMENT_FINISHED',version=version+1 WHERE id=$1 AND revoked_at IS NULL",[e.sessionId]);
     await cleanup.query("UPDATE \"authorization\".platform_role_assignments SET status='REVOKED',revoked_at=clock_timestamp(),revoked_by_actor_type='SYSTEM',revocation_reason='LAB_ENROLLMENT_FINISHED',version=version+1 WHERE id=$1 AND status='ACTIVE'",[e.roleAssignment]);
     await cleanup.query("COMMIT");
    }catch(error){await cleanup.query("ROLLBACK");throw error;}finally{cleanup.release();}
    writeFileSync(completed,JSON.stringify({profile:"CAMACHO_LAB_REAL_HUMAN_WEBAUTHN",...result,origin,rpId,userVerification:"required",bootstrapSessionRevoked:true,bootstrapRoleRevoked:true,businessSessionIssued:false,completedAt:new Date().toISOString()},null,2),{flag:"wx"});
    enrollment=undefined;send(200,{registered:true,businessSessionIssued:false},{"set-cookie":"__Host-CamachoLabEnroll=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0"});console.log("LAB_REAL_HUMAN_ENROLLMENT=PASS");
    setTimeout(()=>{server.close(()=>{void Promise.all([admin.end(),app.end()]);});},1000);
   }finally{busy=false;}
  })().catch(error=>{
   writeFileSync(join(directory,"enrollment-error-"+Date.now()+".json"),JSON.stringify({error:String(error.message),time:new Date().toISOString()}),{flag:"wx"});
   if(!response.headersSent)send(500,{code:"LAB_ENROLLMENT_FAILED_NO_BUSINESS_SESSION"});else response.destroy();console.error("LAB_ENROLLMENT_REQUEST_FAILED");
  });
 });
 server.requestTimeout=15_000;server.headersTimeout=10_000;server.maxConnections=8;
 await new Promise<void>((done,fail)=>{server.once("error",fail);server.listen(8443,"127.0.0.1",done);});
 const capabilityFile=join(directory,"enrollment-open-url-"+randomBytes(16).toString("hex")+".txt");
 writeFileSync(capabilityFile,origin+"/#"+ticket+"\n",{flag:"wx"});console.log("LAB_ENROLLMENT_CAPABILITY_FILE="+capabilityFile);console.log("LAB_ENROLLMENT_HTTPS=READY");
 return {server,close:async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await Promise.all([admin.end(),app.end()]);}};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 if(!process.argv.includes("--run"))console.log("LAB_ENROLLMENT_NO_ACTION: explicit --run and --lab-root required");
 else{const index=process.argv.indexOf("--lab-root");if(index<0||!process.argv[index+1])throw Error("LAB_ROOT_REQUIRED");await startLabEnrollment(process.argv[index+1]);}
}
