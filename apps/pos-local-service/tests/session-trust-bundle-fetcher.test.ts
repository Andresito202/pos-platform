import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  SessionAssertionOperationalKeyClaimsSchema,
  SessionAssertionTrustBundleSchema,
  unsignedSessionAssertionOperationalKeyBytes,
  unsignedAuthorizationTrustBytes,type AuthorizationTrustClaims,
} from "@pos-platform/contracts";
import { SessionTrustBundleFetcher } from "../src/security/session-trust-bundle-fetcher.js";

function validBundle(): unknown {
  const root = generateKeyPairSync("ed25519");
  const operational = generateKeyPairSync("ed25519");
  const claims = SessionAssertionOperationalKeyClaimsSchema.parse({
    key_id: "ssa-fetch-test",
    key_purpose: "SESSION_ASSERTION",
    environment: "production",
    public_key_pem: operational.publicKey.export({ type: "spki", format: "pem" }),
    status: "ACTIVE",
    valid_from: "2026-01-01T00:00:00.000Z",
    valid_until: null,
    version: 1,
  });
  return SessionAssertionTrustBundleSchema.parse({
    version: 1,
    keys: [{ claims, signature: sign(null, unsignedSessionAssertionOperationalKeyBytes(claims), root.privateKey).toString("base64url") }],
  });
}

const endpoint = "https://authority.example/v1/session-trust";
const token = "t".repeat(48);

describe("SessionTrustBundleFetcher", () => {
  it("requests the central endpoint over HTTPS without redirects or caching", async () => {
    const bundle = validBundle();
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(bundle), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    await expect(new SessionTrustBundleFetcher(request).fetch(endpoint, token)).resolves.toEqual(bundle);
    expect(request).toHaveBeenCalledOnce();
    const init = request.mock.calls[0]?.[1];
    expect(init?.method).toBe("GET");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${token}`);
    expect(init?.redirect).toBe("error");
    expect(init?.cache).toBe("no-store");
  });

  it("rejects a path other than the exact central trust endpoint", async () => {
    const request = vi.fn<typeof fetch>();
    await expect(new SessionTrustBundleFetcher(request).fetch("https://authority.example/other/v1/session-trust", token))
      .rejects.toThrow("SESSION_TRUST_ENDPOINT_PATH_INVALID");
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects malformed bearer tokens before making a request", async () => {
    const request = vi.fn<typeof fetch>();
    await expect(new SessionTrustBundleFetcher(request).fetch(endpoint, "short"))
      .rejects.toThrow("SESSION_TRUST_TRANSPORT_TOKEN_INVALID");
    await expect(new SessionTrustBundleFetcher(request).fetch(endpoint, `${token}\n`))
      .rejects.toThrow("SESSION_TRUST_TRANSPORT_TOKEN_INVALID");
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects non-HTTPS endpoints before making a request", async () => {
    const request = vi.fn<typeof fetch>();
    await expect(new SessionTrustBundleFetcher(request).fetch("http://authority.example/v1/session-trust", token))
      .rejects.toThrow("SESSION_TRUST_ENDPOINT_MUST_BE_HTTPS");
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects non-success HTTP responses", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("denied", { status: 401 }));
    await expect(new SessionTrustBundleFetcher(request).fetch(endpoint, token)).rejects.toThrow("SESSION_TRUST_HTTP_401");
  });

  it("rejects oversized payloads and malformed JSON", async () => {
    const oversized = vi.fn<typeof fetch>().mockResolvedValue(new Response("x".repeat(65 * 1024), { status: 200 }));
    await expect(new SessionTrustBundleFetcher(oversized).fetch(endpoint, token)).rejects.toThrow("SESSION_TRUST_RESPONSE_TOO_LARGE");
    const malformed = vi.fn<typeof fetch>().mockResolvedValue(new Response("{", { status: 200 }));
    await expect(new SessionTrustBundleFetcher(malformed).fetch(endpoint, token)).rejects.toThrow("SESSION_TRUST_RESPONSE_INVALID_JSON");
  });
});

function sasDelivery(){
  const root=generateKeyPairSync("ed25519"),key=generateKeyPairSync("ed25519"),claims:AuthorizationTrustClaims={profile:"CAMACHO_SAS_TRUST_V1",mode:"DEPLOYMENT",schema_version:1,purpose:"AUTHORIZATION_SNAPSHOT",environment:"PREPRODUCTION",issuer:"https://authority.example",authority_id:"SAS_FETCH_TEST",
    recipient:{tenant_id:crypto.randomUUID(),company_id:crypto.randomUUID(),branch_id:crypto.randomUUID(),installation_id:crypto.randomUUID(),device_id:crypto.randomUUID()},generation:1,complete:true,
    issued_at:"2026-10-25T12:00:00.000Z",valid_from:"2026-10-25T12:00:00.000Z",valid_until:"2026-10-25T13:00:00.000Z",
    keys:[{key_id:"SAS_FETCH_KEY",purpose:"AUTHORIZATION_SNAPSHOT",public_key_pem:key.publicKey.export({type:"spki",format:"pem"}).toString(),status:"ACTIVE",version:1,valid_from:"2026-10-25T12:00:00.000Z",valid_until:"2026-10-25T13:00:00.000Z"}]};
  return {claims,signature:sign(null,unsignedAuthorizationTrustBytes(claims),root.privateKey).toString("base64url")};
}
const sasHeaders={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
it("SAS remote fetch: fixed route bearer and strict delivery use existing no-redirect transport",async()=>{
  const artifact=sasDelivery(),request=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(artifact),{status:200,headers:sasHeaders}));
  expect(await new SessionTrustBundleFetcher(request).fetchAuthorization("https://authority.example/v1/authorization-trust",token,1000,new AbortController().signal)).toEqual(artifact);
  const init=request.mock.calls[0]![1]!;expect(init.redirect).toBe("error");expect(init.cache).toBe("no-store");expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${token}`);
});
it.each(["cache","content-type","encoding","oversize","utf8","status"])("SAS remote fetch: rejects %s delivery",async target=>{
  const headers:Record<string,string>={...sasHeaders};let body:BodyInit=JSON.stringify(sasDelivery());
  if(target==="cache")headers["cache-control"]="public";if(target==="content-type")headers["content-type"]="text/html";if(target==="encoding")headers["content-encoding"]="gzip";
  if(target==="oversize")body="x".repeat(1024*1024+1);if(target==="utf8")body=new Uint8Array([0xff]);
  const request=vi.fn<typeof fetch>().mockResolvedValue(new Response(body,{status:target==="status"?401:200,headers}));
  await expect(new SessionTrustBundleFetcher(request).fetchAuthorization("https://authority.example/v1/authorization-trust",token,1000,new AbortController().signal)).rejects.toThrow();
});
it("SAS remote fetch: deadline and lifecycle cancellation abort the request",async()=>{
  const request=vi.fn<typeof fetch>().mockImplementation(async(_url,init)=>new Promise((_resolve,reject)=>{
    const signal=init!.signal!;if(signal.aborted)reject(new DOMException("aborted","AbortError"));else signal.addEventListener("abort",()=>reject(new DOMException("aborted","AbortError")),{once:true});
  }));
  const fetcher=new SessionTrustBundleFetcher(request);
  await expect(fetcher.fetchAuthorization("https://authority.example/v1/authorization-trust",token,25,new AbortController().signal)).rejects.toThrow("TIMEOUT");
  const controller=new AbortController();controller.abort();await expect(fetcher.fetchAuthorization("https://authority.example/v1/authorization-trust",token,1000,controller.signal)).rejects.toThrow();
});
