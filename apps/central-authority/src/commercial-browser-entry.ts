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
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#09131c;color:#e6edf3;font:17px system-ui}
main{max-width:520px;margin:24px;padding:36px;background:#15232d;border:1px solid #2c535b;border-radius:24px}
img{max-width:240px}h1{font-size:25px}label{display:block;margin-top:18px}input{box-sizing:border-box;width:100%;padding:12px;margin-top:6px;font:inherit}
button{padding:12px 20px;margin:18px 10px 0 0;font:inherit;cursor:pointer}button:disabled{cursor:wait}p{line-height:1.5}
</style><main><img alt="Camacho POS Colombia" src="data:image/png;base64,${configuration.logoPng.toString("base64")}">
<h1>Iniciar autenticación comercial</h1><p>Entorno local de integración. No habilita acceso productivo al POS.</p>
<form id="login"><label>Correo del empleado<input name="email" type="email" autocomplete="username" maxlength="320" required></label>
<label>Contraseña<input name="password" type="password" autocomplete="current-password" maxlength="1024" required></label>
<button id="start" type="submit">Iniciar autenticación</button><button id="cancel" type="button" disabled>Cancelar</button></form>
<p id="status" role="status" aria-live="polite" data-phase="IDLE">Se exigirá verificación WebAuthn.</p>
<button id="logout" type="button" hidden>Cerrar sesión central</button>
<p id="destination" hidden></p><button id="confirm" type="button" hidden>Confirmar destino y continuar al POS</button>
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
      headers:{"content-type":"application/json", ...(token ? {"x-csrf-token":token} : {})}, body:JSON.stringify(body) });
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
