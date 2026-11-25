import { BUSINESS_API, BusinessContextsSchema, CashRegisterPageSchema, CashRegisterMasterRowSchema,
  BusinessScopeSchema, type CashRegisterMasterRow, type CashRegisterCreateRequest, uuidV7 } from "@pos-platform/contracts";
import type * as z from "zod";
import { acquireTurnstileToken } from "./turnstile-token.js";
type Scope = z.infer<typeof BusinessScopeSchema>;
const decode = (s: string) => Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/")), c => c.charCodeAt(0));
const encode = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");

export class BusinessHttpRejection extends Error {
  constructor(readonly status:number,message:string){super(message);}
  get definitive(){return [400,401,403,404,409,413,415,422,429].includes(this.status);}
}

/** Same-origin BUSINESS custody only. No local session, GLOBAL cookie, storage,
 * client-provided session ID or Electron credential is promoted to authority. */
export class BusinessClient {
  private csrf: string | null = null;
  get hasSession() { return this.csrf !== null; }
  constructor(private readonly origin = window.location.origin, private readonly transport: typeof fetch = fetch) {
    if (new URL(origin).protocol !== "https:" || new URL(origin).origin !== origin) throw Error("Abre la administración BUSINESS en Central HTTPS.");
  }
  private async post(path: string, body: unknown, signal?: AbortSignal, csrf = this.csrf): Promise<Record<string, unknown>> {
    const response = await this.transport(this.origin + BUSINESS_API + path, { method: "POST", credentials: "same-origin", redirect: "error", cache: "no-store",
      ...(signal ? { signal } : {}), headers: { "content-type": "application/json", ...(csrf ? { "x-csrf-token": csrf } : {}) }, body: JSON.stringify(body) });
    if (!response.ok) {
      if (response.status === 401) this.csrf = null;
      throw new BusinessHttpRejection(response.status, response.status === 409 ? "Conflicto de versión, código o capacidad. Actualiza la lista antes de reintentar." :
        response.status === 401 ? "La sesión BUSINESS no está vigente. Inicia sesión de nuevo." : response.status === 403 ? "Central rechazó el permiso, ámbito o licencia." : "Central no pudo completar la operación.");
    }
    return await response.json() as Record<string, unknown>;
  }
  private async loginPublicConfig(signal: AbortSignal): Promise<{ turnstileSiteKey: string | null }> {
    const response = await this.transport(this.origin + BUSINESS_API + "login/public-config", {
      method: "GET", credentials: "same-origin", redirect: "error", cache: "no-store",
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) throw new BusinessHttpRejection(response.status, "Central no publicó la configuración de login.");
    const body = await response.json() as { turnstileSiteKey?: unknown };
    const key = body.turnstileSiteKey;
    if (key === null || key === undefined) return { turnstileSiteKey: null };
    if (typeof key !== "string" || key.length < 10 || key.length > 128) throw Error("Configuración Turnstile inválida.");
    return { turnstileSiteKey: key };
  }
  async login(email: string, password: string, tenantId: string, membershipId: string, signal: AbortSignal) {
    this.csrf = null;
    const { turnstileSiteKey } = await this.loginPublicConfig(signal);
    const turnstileToken = turnstileSiteKey === null ? undefined : await acquireTurnstileToken(turnstileSiteKey, signal);
    const start = await this.post("login/begin", { email, password, ...(turnstileToken ? { turnstileToken } : {}) }, signal);
    if (typeof start.challenge !== "string" || typeof start.credentialId !== "string" || typeof start.csrfToken !== "string") throw Error("Desafío BUSINESS inválido.");
    const credential = await navigator.credentials.get({ publicKey: { challenge: decode(start.challenge), rpId: new URL(this.origin).hostname,
      allowCredentials: [{ type: "public-key", id: decode(start.credentialId) }], userVerification: "required" }, signal });
    if (!(credential instanceof PublicKeyCredential) || !(credential.response instanceof AuthenticatorAssertionResponse)) throw Error("Segundo factor no verificado.");
    const a = credential.response;
    const completed = await this.post("login/complete", { email, password, tenantId, membershipId, challenge: start.challenge,
      response: { id: credential.id, rawId: encode(credential.rawId), type: "public-key", clientExtensionResults: credential.getClientExtensionResults(),
        response: { clientDataJSON: encode(a.clientDataJSON), authenticatorData: encode(a.authenticatorData), signature: encode(a.signature), userHandle: a.userHandle ? encode(a.userHandle) : null } } }, signal, start.csrfToken);
    if (completed.authenticated !== true || completed.scope !== "BUSINESS" || typeof completed.csrfToken !== "string") throw Error("Sesión BUSINESS no confirmada.");
    this.csrf = completed.csrfToken;
  }
  async authorizeNative(request:string,signal:AbortSignal){
    if(!this.csrf||!/^[A-Za-z0-9_-]{43}$/.test(request))throw Error("Solicitud Android inválida.");
    const response=await this.transport(this.origin+"/v1/commercial/native-authorize",{method:"POST",credentials:"same-origin",redirect:"error",cache:"no-store",signal,headers:{"content-type":"application/json","x-csrf-token":this.csrf},body:JSON.stringify({request})});
    if(!response.ok)throw Error("Central rechazó la autorización Android.");
    const result=await response.json() as {callback?:unknown};
    if(typeof result.callback!=="string")throw Error("Callback Android inválido.");
    const url=new URL(result.callback);
    if(url.origin!==this.origin||url.pathname!=="/android/callback"||url.username||url.password||url.hash||Array.from(url.searchParams.keys()).sort().join(",")!=="code,state")throw Error("Callback Android inválido.");
    window.location.replace(url.toString());
  }
  async contexts() { return BusinessContextsSchema.parse(await this.post("contexts", {})); }
  async list(scope: Scope, after: string | null = null) { return CashRegisterPageSchema.parse(await this.post("cash-registers/list", { ...scope, after })); }
  async create(scope: Scope, input: Omit<CashRegisterCreateRequest,keyof Scope>) {
    return CashRegisterMasterRowSchema.parse((await this.post("cash-registers/create", { ...scope, ...input })).register);
  }
  async edit(scope: Scope, register: CashRegisterMasterRow, code: string, name: string) {
    return CashRegisterMasterRowSchema.parse((await this.post("cash-registers/edit", { ...scope, id: register.id, expectedVersion: register.version, code, name, correlationId: uuidV7() })).register);
  }
  async retire(scope: Scope, register: CashRegisterMasterRow) {
    return CashRegisterMasterRowSchema.parse((await this.post("cash-registers/retire", { ...scope, id: register.id, expectedVersion: register.version, correlationId: uuidV7() })).register);
  }
  async logout() {
    const result = await this.post("logout", {});
    if (result.closed !== true) throw Error("Central no confirmó el cierre.");
    this.csrf = null;
  }
}
