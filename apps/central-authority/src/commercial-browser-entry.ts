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
  destination?:{request:string;tenantName:string;companyName:string;deviceId:string;installationId:string}): void {
  const nonce = randomBytes(24).toString("base64url");
  const config = JSON.stringify({ rpId: configuration.rpId, factorId: configuration.factorId,
    tenantId: configuration.tenantId, membershipId: configuration.membershipId,destination }).replace(/</g, "\\u003c");
  const html = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Acceso — Camacho POS Colombia</title>
<style nonce="${nonce}">
/* Commercial Precision B: presentation only; nonce and authentication unchanged. */
:root{font-family:Bahnschrift,"Segoe UI",system-ui,sans-serif;color:#142b3a;background:#f3f6f8;line-height:1.5}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center}
main{display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,420px);gap:64px;width:min(1060px,100%);padding:40px;margin:0}
.access-brand{align-self:center}.access-brand img{display:block;width:min(330px,100%);margin-bottom:36px;background:#fff;border:1px solid #d6dfe6;border-radius:4px;padding:12px}
h1{font-size:34px;line-height:1.18;letter-spacing:-.6px;font-weight:600;margin:0 0 20px}h2{font-size:24px;line-height:1.25;margin:0 0 16px;font-weight:600}
.access-brand p{font-size:14px;color:#536475;max-width:360px}.access-form{min-width:0;background:#fff;border:1px solid #d6dfe6;border-top:3px solid #087052;border-radius:4px;padding:30px}
label{display:grid;gap:6px;margin-top:18px;font-size:13px;font-weight:600}
input{width:100%;min-height:44px;padding:10px 12px;font:inherit;color:#142b3a;border:1px solid #b8c6d1;border-radius:4px;background:#fff}
button{min-height:44px;padding:10px 16px;margin:20px 8px 0 0;font:inherit;font-size:14px;font-weight:600;cursor:pointer;border:1px solid #b8c6d1;border-radius:4px;background:#fff;color:#142b3a}
#start,#confirm{background:#087052;border-color:#087052;color:#fff}button:disabled{cursor:not-allowed;background:#edf0f3!important;border-color:#d6dfe6!important;color:#536475!important}
:is(button,input):focus-visible{outline:3px solid #2577b0;outline-offset:3px}p{line-height:1.5}#status{font-size:13px;padding:14px;border-left:3px solid #123d68;background:#e9f1f6;margin:24px 0 0;overflow-wrap:anywhere}
#destination{font-size:13px;padding-top:18px;border-top:1px solid #d6dfe6;overflow-wrap:anywhere}#status[data-phase="REJECTED"],#status[data-phase="LOGOUT_UNCONFIRMED"]{background:#fff2d4;color:#805500;border-left-color:#805500}
@media(max-width:700px){main{grid-template-columns:minmax(0,1fr);gap:24px;padding:24px 18px}.access-brand img{width:240px;margin-bottom:22px}h1{font-size:28px}.access-brand p{max-width:none}.access-form{padding:24px}}
@media(pointer:coarse){input,button{min-height:48px;font-size:16px}}
</style><main><section class="access-brand"><img alt="Camacho POS Colombia" src="data:image/png;base64,${configuration.logoPng.toString("base64")}">
<h1>Iniciar autenticación comercial</h1><p>Entorno local de integración. No habilita acceso productivo al POS.</p>
</section><section class="access-form" aria-label="Autenticación comercial"><h2>Verifica tu identidad</h2>
<form id="login"><label>Correo del empleado<input name="email" type="email" autocomplete="username" maxlength="320" required></label>
<label>Contraseña<input name="password" type="password" autocomplete="current-password" maxlength="1024" required></label>
<button id="start" type="submit">Iniciar autenticación</button><button id="cancel" type="button" disabled>Cancelar</button></form>
<p id="status" role="status" aria-live="polite" data-phase="IDLE">Se exigirá verificación WebAuthn.</p>
<button id="logout" type="button" hidden>Cerrar sesión central</button>
<p id="destination" hidden></p><button id="confirm" type="button" hidden>Confirmar destino y continuar al POS</button>
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
    try { await post("browser/logout", {}, undefined, csrf); csrf = null; logout.hidden = true; start.disabled = false;
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
