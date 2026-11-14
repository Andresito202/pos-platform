import {describe,it,expect} from "vitest";
import {inspectCommercialTokenRequest,COMMERCIAL_MAX_BODY_BYTES} from "../src/commercial-token-http-contract.js";

const registration={clientId:"electron-pos",redirectUri:"http://127.0.0.1:46231/callback",
  authorizationOrigin:"https://business.example.test"};
const valid={grant_type:"authorization_code",code:"a".repeat(64),
  code_verifier:"v".repeat(43),state:"s".repeat(48),
  client_id:registration.clientId,redirect_uri:registration.redirectUri};
const parse=(body:unknown,contentType="application/json")=>
  inspectCommercialTokenRequest({method:"POST",contentType,body:JSON.stringify(body),registration});

describe("commercial token HTTP transport boundary (not activated)",()=>{
  it("accepts a correctly shaped request for an exact server registration",()=>{
    const result=parse(valid);
    expect(result.status).toBe(200);
    if(result.status===200)expect(result.request).toEqual(valid);
  });
  it("rejects forged session, tenant, device and extra payload properties",()=>{
    for(const field of ["session_id","tenant_id","device_id","user_id","password","access_token"]){
      expect(parse({...valid,[field]:"unsafe"})).toMatchObject({status:400});
    }
  });
  it("rejects incorrect registered client or redirect",()=>{
    expect(parse({...valid,client_id:"another-client"})).toMatchObject({status:403});
    expect(parse({...valid,redirect_uri:"http://127.0.0.1:46232/callback"})).toMatchObject({status:403});
  });
  it("rejects unsupported media type and invalid PKCE input",()=>{
    expect(parse(valid,"text/plain")).toMatchObject({status:415});
    expect(parse({...valid,code_verifier:"short"})).toMatchObject({status:400});
    expect(parse({...valid,state:"short"})).toMatchObject({status:400});
  });
  it("rejects oversized payload and malformed JSON",()=>{
    expect(inspectCommercialTokenRequest({method:"POST",contentType:"application/json",
      body:" ".repeat(COMMERCIAL_MAX_BODY_BYTES+1),registration})).toMatchObject({status:413});
    expect(inspectCommercialTokenRequest({method:"POST",contentType:"application/json",
      body:"{broken",registration})).toMatchObject({status:400});
  });
  it("rejects invalid or unapproved native registration",()=>{
    expect(inspectCommercialTokenRequest({method:"POST",contentType:"application/json",
      body:JSON.stringify(valid),registration:{...registration,authorizationOrigin:"http://localhost"}}))
      .toMatchObject({status:403});
  });
});
