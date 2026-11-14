import { Buffer } from "node:buffer";
import { SessionAssertionTrustBundleSchema,AuthorizationTrustDeliverySchema, type SessionAssertionTrustBundle } from "@pos-platform/contracts";

const MAX_BUNDLE_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 5_000;

/** Fetches a public, root-signed trust bundle from Central Authority. */
export class SessionTrustBundleFetcher {
  constructor(private readonly request: typeof fetch = fetch) {}

  async fetch(endpoint: string, bearerToken: string): Promise<SessionAssertionTrustBundle> {
    return SessionAssertionTrustBundleSchema.parse(await this.fetchPublicArtifact(endpoint,bearerToken,"/v1/session-trust",MAX_BUNDLE_BYTES,REQUEST_TIMEOUT_MS));
  }
  /** Same bounded system-TLS transport, fixed SAS target and explicit timeout.
   * Authentication gates publication; only the pinned root can grant trust. */
  async fetchAuthorization(endpoint:string,bearerToken:string,timeoutMs:number,signal:AbortSignal){
    return AuthorizationTrustDeliverySchema.parse(await this.fetchPublicArtifact(endpoint,bearerToken,"/v1/authorization-trust",1024*1024,timeoutMs,signal));
  }
  private async fetchPublicArtifact(endpoint:string,bearerToken:string,path:"/v1/session-trust"|"/v1/authorization-trust",maximumBytes:number,timeoutMs:number,signal?:AbortSignal):Promise<unknown>{
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.hash !== "") {
      throw new Error("SESSION_TRUST_ENDPOINT_MUST_BE_HTTPS");
    }
    if (url.pathname !== path || url.search !== "") {
      throw new Error("SESSION_TRUST_ENDPOINT_PATH_INVALID");
    }
    if(!Number.isSafeInteger(timeoutMs)||timeoutMs<=0||timeoutMs>2_147_483_647)throw Error("SESSION_TRUST_EXPLICIT_TIMEOUT_REQUIRED");
    if (bearerToken.length < 32 || bearerToken.length > 4096 || /[\r\n]/.test(bearerToken)) {
      throw new Error("SESSION_TRUST_TRANSPORT_TOKEN_INVALID");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    timeout.unref?.();
    let response:Response|undefined;
    try {
      response = await this.request(url, {
        method: "GET",
        headers: {
          authorization: `Bearer ${bearerToken}`,
          accept: "application/json",
          "cache-control": "no-store",
        },
        cache: "no-store",
        redirect: "error",
        signal:signal?AbortSignal.any([signal,controller.signal]):controller.signal,
      });
      if (response.status !== 200) throw new Error(`SESSION_TRUST_HTTP_${response.status}`);
      if(path==="/v1/authorization-trust"&&(response.headers.get("cache-control")!=="no-store"||
        response.headers.get("content-type")!=="application/json; charset=utf-8"||response.headers.has("content-encoding")||response.headers.has("location")))throw Error("SAS_TRUST_HTTP_REJECTED");
      const declaredLength = response.headers.get("content-length");
      if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maximumBytes)) {
        throw new Error("SESSION_TRUST_RESPONSE_TOO_LARGE");
      }
      if (response.body === null) throw new Error("SESSION_TRUST_RESPONSE_EMPTY");
      const reader = response.body.getReader();
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          totalBytes += value.byteLength;
          if (totalBytes > maximumBytes) {
            await reader.cancel();
            throw new Error("SESSION_TRUST_RESPONSE_TOO_LARGE");
          }
          chunks.push(Buffer.from(value));
        }
      } finally {
        reader.releaseLock();
      }
      let artifact: unknown;
      try { artifact = JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks, totalBytes))); }
      catch { throw new Error("SESSION_TRUST_RESPONSE_INVALID_JSON"); }
      signal?.throwIfAborted();return artifact;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error("SESSION_TRUST_REQUEST_TIMEOUT");
      throw error;
    } finally {
      clearTimeout(timeout);
      if(response?.body&&!response.bodyUsed)await response.body.cancel().catch(()=>undefined);
    }
  }
}
