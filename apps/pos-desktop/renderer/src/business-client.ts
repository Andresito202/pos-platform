import { BUSINESS_API, BusinessContextsSchema, CashRegisterPageSchema, CashRegisterMasterRowSchema,
  BusinessScopeSchema, type CashRegisterMasterRow, type CashRegisterCreateRequest, uuidV7 } from "@pos-platform/contracts";
import type * as z from "zod";
type Scope = z.infer<typeof BusinessScopeSchema>;
const decode = (s: string) => Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/")), c => c.charCodeAt(0));
const encode = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");

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
      throw Error(response.status === 409 ? "Conflicto de versión, código o capacidad. Actualiza la lista antes de reintentar." :
        response.status === 401 ? "La sesión BUSINESS no está vigente. Inicia sesión de nuevo." : response.status === 403 ? "Central rechazó el permiso, ámbito o licencia." : "Central no pudo completar la operación.");
    }
    return await response.json() as Record<string, unknown>;
  }
  async login(email: string, password: string, tenantId: string, membershipId: string, signal: AbortSignal) {
    this.csrf = null;
    const start = await this.post("login/begin", { email, password }, signal);
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
