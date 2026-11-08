import { randomBytes } from "node:crypto";
import type { ServerResponse } from "node:http";

/** Trusted host selectors, not authentication evidence. Membership/factor
 * ownership is revalidated by the canonical MFA and BUSINESS transactions. */
export interface CommercialBrowserEntryConfiguration {
  readonly rpId: string;
  readonly factorId: string;
  readonly tenantId: string;
  readonly membershipId: string;
  readonly logoPng: Buffer;
}

/** HTTPS document only. Optional central destination confirmation redirects the
 * one-use code; no device key, token minting or POS grant enters the document.
 * Mounted by the existing isolated host; production activation stays gated. */
export function sendCommercialBrowserEntry(res: ServerResponse, configuration: CommercialBrowserEntryConfiguration,
  destination?:{request:string;tenantName:string;companyName:string;deviceId:string;installationId:string},merchantAdminEnabled=false,merchantNoticeReadEnabled=false): void {
  const nonce = randomBytes(24).toString("base64url");
  const config = JSON.stringify({ rpId: configuration.rpId, factorId: configuration.factorId,
    tenantId: configuration.tenantId, membershipId: configuration.membershipId,destination,merchantAdminEnabled,merchantNoticeReadEnabled }).replace(/</g, "\\u003c");
  const html = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Acceso — Camacho POS Colombia</title>
<style nonce="${nonce}">
/* Commercial Precision B · central commercial login · presentation only. */
:root{font-family:Bahnschrift,"Segoe UI",system-ui,sans-serif;color:#142b3a;background:#edf3f4;line-height:1.5;color-scheme:light;--navy:#10283d;--ink:#142b3a;--muted:#506577;--border:#c9d6de;--green:#087052;--focus:#2577b0}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:clamp(14px,3vw,40px)}
main{display:grid;grid-template-columns:minmax(0,1fr) minmax(350px,460px);width:min(1110px,100%);min-width:0;min-height:610px;overflow:hidden;background:#fff;border:1px solid #cfdae0;border-radius:16px;box-shadow:0 14px 46px rgb(16 40 61 / 9%)}
.access-brand{display:flex;flex-direction:column;justify-content:center;align-items:flex-start;min-width:0;padding:clamp(36px,5vw,72px);background:var(--navy);color:#fff}
.access-brand img{display:block;width:min(320px,100%);max-height:200px;object-fit:contain;padding:16px;margin:0 0 42px;background:#fff;border:1px solid #dce6ec;border-radius:10px}
h1{margin:0 0 18px;max-width:430px;font-size:clamp(30px,3.4vw,40px);line-height:1.15;letter-spacing:-.035em;font-weight:650}
.access-brand p{margin:0;max-width:400px;font-size:15px;color:#c9d9e4;line-height:1.65}
.access-form{align-self:center;min-width:0;width:100%;padding:clamp(28px,4.5vw,52px);background:#fff;color:var(--ink)}
h2{margin:0 0 26px;font-size:clamp(24px,2.5vw,29px);line-height:1.2;font-weight:650;letter-spacing:-.025em}
label{display:grid;gap:8px;margin-top:18px;font-size:14px;font-weight:600;color:#304658}
input{display:block;width:100%;min-height:48px;padding:11px 14px;font:inherit;font-size:16px;color:var(--ink);background:#fff;border:1px solid #aebfca;border-radius:7px}
input:hover{border-color:#7891a1}input:focus{border-color:var(--focus)}
button{display:inline-flex;align-items:center;justify-content:center;min-height:46px;padding:11px 16px;margin:12px 8px 0 0;font:inherit;font-size:14px;font-weight:600;line-height:1.3;border:1px solid var(--border);border-radius:7px;color:var(--ink);background:#fff;cursor:pointer}
button:not(:disabled):hover{border-color:var(--focus);background:#f2f7fa}
#start,#confirm{display:flex;width:100%;margin:25px 0 0;min-height:48px;color:#fff;background:var(--green);border-color:var(--green)}
#start:not(:disabled):hover,#confirm:not(:disabled):hover{background:#075941;border-color:#075941}
#cancel{display:flex;width:100%;margin:10px 0 0}#logout{width:100%;margin:18px 0 0}
button:disabled{cursor:not-allowed;background:#eff2f4!important;border-color:#d6dfe6!important;color:#536475!important}
:is(button,input):focus-visible{outline:3px solid var(--focus);outline-offset:3px}
#status{margin:25px 0 0;padding:14px 15px;font-size:13px;line-height:1.55;color:#294e6d;background:#edf4f8;border:1px solid #cddde8;border-left:4px solid #2577b0;border-radius:6px;overflow-wrap:anywhere}
#status[data-phase="BUSINESS_VERIFIED"],#status[data-phase="SIGNED_OUT"]{background:#e9f5ef;border-color:#b9ddcd;border-left-color:#087052;color:#175b42}
#status[data-phase="REJECTED"],#status[data-phase="LOGOUT_UNCONFIRMED"]{background:#fff5e1;border-color:#e8d2a1;border-left-color:#9b6300;color:#674500}
#qr001{margin-top:25px;padding-top:20px;border-top:1px solid var(--border)}
#qr001 h3{font-size:19px;margin:0 0 10px}#qr001 p{font-size:13px;color:var(--muted)}
#qr001 label{margin-top:12px}#qr001 select{display:block;width:100%;min-height:46px;padding:10px;border:1px solid #aebfca;border-radius:7px;background:#fff}
#qr001-list{list-style:none;padding:0;margin:12px 0}#qr001-list li{padding:10px 0;border-bottom:1px solid var(--border);font-size:13px;overflow-wrap:anywhere}
#qr001-state{font-size:13px;color:#175b42}#qr001-state[data-error="yes"]{color:#a13224}
#destination{margin:20px 0 0;padding:16px 0 0;font-size:13px;border-top:1px solid var(--border);overflow-wrap:anywhere}
[hidden]{display:none!important}
@media(max-width:800px){body{padding:18px}main{grid-template-columns:minmax(0,1fr);min-height:auto;max-width:630px}.access-brand{padding:32px 36px}.access-brand img{width:230px;max-height:130px;margin-bottom:22px;padding:10px}h1{font-size:29px;margin-bottom:8px}.access-brand p{max-width:none;font-size:13px}.access-form{padding:34px 36px}}
@media(max-width:480px){body{padding:0;display:block}main{min-height:100vh;border:0;border-radius:0;box-shadow:none}.access-brand{padding:24px 22px}.access-brand img{width:190px;max-height:110px;margin-bottom:18px}h1{font-size:25px}.access-form{padding:26px 22px 36px}h2{font-size:24px}}
@media(pointer:coarse){input,button{min-height:48px;font-size:16px}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}

</style><main><section class="access-brand"><img alt="Camacho POS Colombia" src="data:image/png;base64,${configuration.logoPng.toString("base64")}">
<h1>Iniciar autenticación comercial</h1><p>Entorno local de integración. No habilita acceso productivo al POS.</p>
</section><section class="access-form" aria-label="Autenticación comercial"><h2>Verifica tu identidad</h2>
<form id="login"><label>Correo del empleado<input name="email" type="email" autocomplete="username" maxlength="320" required></label>
<label>Contraseña<input name="password" type="password" autocomplete="current-password" maxlength="1024" required></label>
<button id="start" type="submit">Iniciar autenticación</button><button id="cancel" type="button" disabled>Cancelar</button></form>
<p id="status" role="status" aria-live="polite" data-phase="IDLE">Se exigirá verificación WebAuthn.</p>
<button id="logout" type="button" hidden>Cerrar sesión central</button>
<p id="destination" hidden></p><button id="confirm" type="button" hidden>Confirmar destino y continuar al POS</button>
<section id="qr001" hidden aria-label="Administración de cobros Nequi y Bre-B">
<h3>Cobros sin pasarela · Nequi / Bre-B</h3>
<p>Los datos pertenecen exclusivamente a este negocio. Caja solo podrá consultarlos; no puede modificarlos. Los pagos requieren verificación independiente.</p>
<label>Método<select id="qr001-kind"><option value="NEQUI_BUSINESS_QR">QR original Nequi (personal o Negocios)</option><option value="BREB_KEY">Llave Bre-B</option><option value="NEQUI_NUMBER">Número Nequi</option></select></label>
<label>Nombre visible en Caja<input id="qr001-label" maxlength="80" value="Cobro del negocio"></label>
<label>Referencia del destino: Nequi o llave Bre-B<input id="qr001-reference" maxlength="160" autocomplete="off" placeholder="QR Nequi, número o llave exacta del comercio"></label>
<label>Imagen PNG del QR original Nequi o Bre-B (opcional si solo se usa la llave)<input id="qr001-file" type="file" accept="image/png"></label>
<button id="qr001-upload" type="button">Verificar y cargar QR</button>
<button id="qr001-create" type="button">Guardar borrador</button>
<button id="qr001-refresh" type="button">Actualizar lista</button>
<p id="qr001-state" role="status" aria-live="polite">Verifica tu permiso administrativo.</p>
<ul id="qr001-list"></ul>
<section id="qr002" hidden aria-label="Avisos de transferencias no verificados">
<h3>Avisos Nequi Negocios — sin verificar</h3>
<p>Un SMS no confirma un abono. Compara cada aviso con los movimientos de la cuenta antes de confirmar una venta.</p>
<button id="qr002-refresh" type="button">Consultar avisos</button>
<p id="qr002-state" role="status" aria-live="polite">No se han consultado avisos.</p>
<ul id="qr002-list"></ul>
</section>
</section>

</section>
<script nonce="${nonce}">
"use strict";
(() => {
  const config = ${config};
  const form = document.getElementById("login"), status = document.getElementById("status");
  const start = document.getElementById("start"), cancel = document.getElementById("cancel"), logout = document.getElementById("logout");
  let controller = null, csrf = null;
  const target=document.getElementById("destination"),confirm=document.getElementById("confirm");
  if(config.destination){target.hidden=false;target.textContent="Destino: "+config.destination.tenantName+" / "+config.destination.companyName+
    " · Dispositivo "+config.destination.deviceId+" · Instalación "+config.destination.installationId;}
  const show = (phase, text) => { status.dataset.phase = phase; status.textContent = text; };
  const decode = value => Uint8Array.from(atob(value.replace(/-/g,"+").replace(/_/g,"/")), c => c.charCodeAt(0));
  const encode = value => btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=+$/,"");
  async function post(path, body, signal, token) {
    const response = await fetch("/v1/commercial/" + path, { method:"POST", credentials:"same-origin", cache:"no-store", redirect:"error", signal,
      headers:{"content-type":"application/json", ...(token ? {"x-csrf-token":token} : {}),...(config.destination?{"x-commercial-native-request":config.destination.request}:{})}, body:JSON.stringify(body) });
    if (!response.ok) throw new Error(response.status === 401 ? "CREDENTIALS_REJECTED" : response.status === 429 ? "THROTTLED" : "AUTHENTICATION_UNAVAILABLE");
    return response.json();
  }
  const qrPanel=document.getElementById("qr001"),qrState=document.getElementById("qr001-state"),qrList=document.getElementById("qr001-list");
  let qrAsset=null;
  const qrInfo=(message,error=false)=>{qrState.textContent=message;qrState.dataset.error=error?"yes":"no";};
  async function qrReload(){
    const reply=await post("merchant-destinations/list",{},undefined,csrf);
    if(!reply.result||!Array.isArray(reply.result.destinations))throw Error("LIST_INVALID");
    qrList.replaceChildren();
    for(const item of reply.result.destinations){
      const li=document.createElement("li");
      const title=document.createElement("strong");
      title.textContent=String(item.label)+" · "+String(item.kind)+" · "+String(item.status)+" · v"+String(item.version);
      li.appendChild(title);
      const reference=document.createElement("p");
      reference.textContent=String(item.destination_reference);
      li.appendChild(reference);
      if(item.status==="DRAFT"||item.status==="PUBLISHED"){
        const action=document.createElement("button");
        const verb=item.status==="DRAFT"?"publish":"revoke";
        action.type="button";action.textContent=verb==="publish"?"Publicar para las cajas":"Revocar en las cajas";
        action.addEventListener("click",async()=>{
          if(!csrf||!window.confirm(verb==="publish"?"¿Publicar este destino de cobro?":"¿Revocar este destino?"))return;
          action.disabled=true;
          try{await post("merchant-destinations/"+verb,{id:item.id,expected_version:item.version},undefined,csrf);
            qrInfo("Cambio registrado por Central; la actualización de cajas requiere sincronización verificada.");await qrReload();}
          catch{qrInfo("Central rechazó el cambio. Verifica versión, permisos y conexión.",true);}
          finally{action.disabled=false;}
        });
        li.appendChild(action);
      }
      qrList.appendChild(li);
    }
    qrInfo("Configuración de cobros de tu empresa. Solo los destinos publicados son visibles para caja.");
  }
  const noticePanel=document.getElementById("qr002");
  const noticeList=document.getElementById("qr002-list");
  const noticeState=document.getElementById("qr002-state");
  async function reloadNotices(){
    if(!csrf||!config.merchantNoticeReadEnabled) return;
    const reply=await post("merchant-destinations/notices",{},undefined,csrf);
    if(!reply.result||!Array.isArray(reply.result.notices))throw Error("QR002_LIST_INVALID");
    noticeList.replaceChildren();
    for(const notice of reply.result.notices){
      if(notice.status!=="UNVERIFIED"||notice.bank_confirmed!==false||notice.sale_confirmed!==false)
        throw Error("QR002_UNTRUSTED_NOTICE_STATE");
      const li=document.createElement("li");
      const heading=document.createElement("strong");
      heading.textContent="Aviso NO verificado · "+new Date(notice.received_at).toLocaleString("es-CO");
      const sender=document.createElement("p");
      sender.textContent="Origen comunicado: "+String(notice.sender_label);
      li.append(heading,sender);
      noticeList.appendChild(li);
    }
    noticeState.textContent=reply.result.notices.length
      ?"Consulta de avisos: se requiere conciliación bancaria independiente."
      :"No hay avisos registrados para esta empresa.";
  }
  document.getElementById("qr002-refresh").addEventListener("click",()=>{
    void reloadNotices().catch(()=>{
      noticeList.replaceChildren();
      noticeState.textContent="No se pudieron verificar los avisos de esta empresa.";
    });
  });
  document.getElementById("qr001-kind").addEventListener("change",()=>{
    qrAsset=null;
    document.getElementById("qr001-file").value="";
    qrInfo("Método cambiado: carga su QR oficial correspondiente, si aplica.");
  });
  document.getElementById("qr001-file").addEventListener("change",()=>{qrAsset=null;});
  document.getElementById("qr001-refresh").addEventListener("click",()=>{void qrReload().catch(()=>qrInfo("No se pudo actualizar la configuración.",true));});
  document.getElementById("qr001-upload").addEventListener("click",async()=>{
    const file=document.getElementById("qr001-file").files[0];
    if(!csrf||!file||file.type!=="image/png"||file.size>1048576||file.size<57){qrInfo("Selecciona un PNG oficial menor o igual a 1 MiB.",true);return;}
    const action=document.getElementById("qr001-upload");action.disabled=true;qrAsset=null;
    try{
      const bytes=new Uint8Array(await file.arrayBuffer());
      let binary="";for(let offset=0;offset<bytes.length;offset+=8192)
        binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
      const result=(await post("merchant-destinations/upload",{png_base64:btoa(binary)},undefined,csrf)).result;
      if(!result||typeof result.id!=="string"||typeof result.sha256!=="string")throw Error("INVALID_RESPONSE");
      qrAsset=result;qrInfo("Imagen PNG aceptada y almacenada. Verifica que el QR y su beneficiario sean correctos antes de publicar.");
    }catch{qrInfo("No fue posible guardar el PNG. Verifica la imagen oficial.",true);}
    finally{action.disabled=false;}
  });
  document.getElementById("qr001-create").addEventListener("click",async()=>{
    if(!csrf)return;
    const kind=document.getElementById("qr001-kind").value;
    const selectedAsset=qrAsset;
    const label=document.getElementById("qr001-label").value.trim();
    const value=document.getElementById("qr001-reference").value.trim();
    if(kind==="NEQUI_BUSINESS_QR"&&!selectedAsset){qrInfo("Primero carga la imagen QR oficial.",true);return;}
    const draft={kind,label,destination_reference:value,
      qr_asset_id:kind!=="NEQUI_NUMBER"&&selectedAsset?selectedAsset.id:null,
      qr_sha256:kind!=="NEQUI_NUMBER"&&selectedAsset?selectedAsset.sha256:null};
    const action=document.getElementById("qr001-create");action.disabled=true;
    try{await post("merchant-destinations/create",{draft},undefined,csrf);qrInfo("Borrador guardado; publícalo para habilitar su lectura.");await qrReload();}
    catch{qrInfo("No se pudo guardar. Revisa que el destino sea correcto y no esté duplicado.",true);}
    finally{action.disabled=false;}
  });

  cancel.addEventListener("click", () => { controller?.abort(); });
  form.addEventListener("submit", async event => {
    event.preventDefault(); if (controller || csrf) return;
    controller = new AbortController(); const signal = controller.signal;
    let password = form.elements.password.value;
    const email = form.elements.email.value;
    start.disabled = true; cancel.disabled = false;
    form.elements.password.value = "";
    try {
      show("AUTHENTICATING", "Validando credenciales con la autoridad central…");
      const challenge = await post("login", { phase:"begin", email, password, factorId:config.factorId }, signal);
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      if (!window.isSecureContext || !navigator.credentials || challenge.userVerification !== "required") throw new Error("WEBAUTHN_UNAVAILABLE");
      show("MFA_REQUIRED", "Completa la verificación de tu autenticador.");
      const credential = await navigator.credentials.get({ signal, publicKey:{ challenge:decode(challenge.challenge), rpId:config.rpId,
        userVerification:"required", allowCredentials:[{type:"public-key",id:decode(challenge.credentialId)}] } });
      if (signal.aborted || !credential || credential.type !== "public-key") throw new DOMException("Cancelled", "AbortError");
      const response = credential.response;
      const assertion = {id:credential.id,rawId:encode(credential.rawId),type:"public-key",clientExtensionResults:credential.getClientExtensionResults(),
        response:{clientDataJSON:encode(response.clientDataJSON),authenticatorData:encode(response.authenticatorData),signature:encode(response.signature),
          userHandle:response.userHandle ? encode(response.userHandle) : null}};
      // Completion is not locally abortable: its transaction may commit. Retain
      // its CSRF result so explicit logout can revoke the actual central session.
      cancel.disabled = true; show("VERIFYING_MFA", "Verificando MFA y membresía…");
      const issued = await post("login", {phase:"complete",email,password,challenge:challenge.challenge,response:assertion,
        tenantId:config.tenantId,membershipId:config.membershipId});
      csrf = issued.csrfToken;
      if (typeof csrf !== "string") throw new Error("AUTHENTICATION_UNAVAILABLE");
      logout.hidden = false;
      await post("browser/session", {}, undefined, csrf);
      show("BUSINESS_VERIFIED", config.destination ? "Identidad y MFA verificados. Comprueba el destino antes de continuar." :
        "Identidad, MFA y sesión BUSINESS verificados. La entrega al dispositivo sigue bloqueada hasta aprobar su binding. El POS no ha recibido permisos.");
      confirm.hidden=!config.destination;
      if(config.merchantAdminEnabled){
        try{await qrReload();qrPanel.hidden=false;noticePanel.hidden=!config.merchantNoticeReadEnabled;}
        catch{qrPanel.hidden=true;}
      }
    } catch (error) {
      show(error.name === "AbortError" || error.name === "NotAllowedError" ? "CANCELLED" : "REJECTED",
        error.name === "AbortError" || error.name === "NotAllowedError" ? "Autenticación cancelada. Inicia un intento nuevo." : "No se pudo verificar la autenticación. Comprueba las credenciales, el autenticador y la conexión.");
    } finally {
      password = ""; form.elements.password.value = ""; controller = null; start.disabled = Boolean(csrf); cancel.disabled = true;
    }
  });
  confirm.addEventListener("click",async()=>{
    if(!csrf||!config.destination)return;confirm.disabled=true;
    try{const grant=await post("authorize",{request:config.destination.request,confirmed:true},undefined,csrf);
      const callback=new URL(grant.redirectUri);callback.search=new URLSearchParams({code:grant.code,state:grant.state}).toString();
      show("NATIVE_REDIRECT","Destino confirmado. Continuando en el cliente nativo…");location.assign(callback.href);
    }catch{show("REJECTED","Solicitud vencida o rechazada. Inicia un intento nuevo desde el POS.");}
  });
  logout.addEventListener("click", async () => {
    logout.disabled = true;
    try { await post("browser/logout", {}, undefined, csrf); csrf = null; logout.hidden = true; start.disabled = false; qrPanel.hidden=true;noticePanel.hidden=true;noticeList.replaceChildren();qrAsset=null;qrList.replaceChildren();
      show("SIGNED_OUT", "La autoridad central confirmó el cierre de sesión.");
    } catch { show("LOGOUT_UNCONFIRMED", "La autoridad central no confirmó el cierre. Reintenta cuando haya conexión."); }
    finally { logout.disabled = false; }
  });
})();
</script></main></html>`;
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": Buffer.byteLength(html),
    "cache-control": "no-store", "pragma": "no-cache", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff",
    "cross-origin-resource-policy": "same-origin", "permissions-policy": "publickey-credentials-get=(self)",
    "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'` });
  res.end(html);
}
