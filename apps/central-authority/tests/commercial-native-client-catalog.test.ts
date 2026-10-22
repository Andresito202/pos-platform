import {describe,it,expect} from "vitest";
import {CommercialNativeClientCatalog} from "../src/commercial-native-client-catalog.js";
import {inspectCommercialTokenRequest} from "../src/commercial-token-http-contract.js";

const electron={clientId:"camacho-electron",redirectUri:"http://127.0.0.1:46813/callback",
  authorizationOrigin:"https://login.example.test"};
const androidPlaceholder={clientId:"camacho-electron-secondary",redirectUri:"http://127.0.0.1:46814/callback",
  authorizationOrigin:"https://login.example.test"};

describe("server-owned native registration catalog",()=>{
  it("resolves exact registered Electron redirect without client override",()=>{
    const catalog=new CommercialNativeClientCatalog([electron,androidPlaceholder]);
    expect(catalog.requireExact(electron.clientId,electron.redirectUri)).toEqual(electron);
    expect(catalog.requireExact(electron.clientId,androidPlaceholder.redirectUri)).toBeNull();
    expect(catalog.requireExact("unregistered",electron.redirectUri)).toBeNull();
  });
  it("rejects duplicate and malformed registrations at startup",()=>{
    expect(()=>new CommercialNativeClientCatalog([electron,electron])).toThrow();
    expect(()=>new CommercialNativeClientCatalog([{...electron,redirectUri:"https://evil.example/callback"}])).toThrow();
    expect(()=>new CommercialNativeClientCatalog([])).toThrow();
  });
  it("permits request processing only after trusted catalog selection",()=>{
    const catalog=new CommercialNativeClientCatalog([electron]);
    const candidate={grant_type:"authorization_code",code:"A".repeat(64),
      code_verifier:"V".repeat(43),state:"S".repeat(48),
      client_id:electron.clientId,redirect_uri:electron.redirectUri};
    const known=catalog.requireExact(candidate.client_id,candidate.redirect_uri);
    expect(known).not.toBeNull();
    expect(inspectCommercialTokenRequest({method:"POST",contentType:"application/json",
      body:JSON.stringify(candidate),registration:known!}).status).toBe(200);
    expect(catalog.requireExact(candidate.client_id,"http://127.0.0.1:46555/callback")).toBeNull();
  });
});
