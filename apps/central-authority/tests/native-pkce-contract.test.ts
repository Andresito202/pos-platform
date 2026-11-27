import { describe,it,expect } from "vitest";
import { derivePkceS256Challenge,matchesPkceS256Challenge } from "../src/native-authorization-constraints.js";
import { NativeAuthorizationCodeExchange } from "../src/native-authorization-code-exchange.js";
describe("native PKCE recovered contract",()=>{
 const verifier="dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
 const challenge="E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
 it("matches RFC 7636 and rejects a modified or short verifier",()=>{
  expect(derivePkceS256Challenge(verifier)).toBe(challenge);
  expect(matchesPkceS256Challenge(verifier,challenge)).toBe(true);
  expect(matchesPkceS256Challenge(verifier+"a",challenge)).toBe(false);
  expect(matchesPkceS256Challenge("short",challenge)).toBe(false);
 });
 it("requires an explicit durable consumer",()=>{
  expect(()=>new NativeAuthorizationCodeExchange({} as never,{} as never)).toThrow();
 });
});
