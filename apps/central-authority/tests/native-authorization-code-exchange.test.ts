import { describe, expect, it, vi } from "vitest";
import { NativeAuthorizationCodeExchange, type AtomicNativeCodeConsumer, type StoredNativeAuthorizationGrant } from "../src/native-authorization-code-exchange.js";
import { derivePkceS256Challenge } from "../src/native-authorization-constraints.js";

const registration = {clientId:"camacho-desktop",redirectUri:"http://127.0.0.1:42133/callback",authorizationOrigin:"https://login.example.com"};
const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", state = "s".repeat(43),code="c".repeat(48);
const grant:StoredNativeAuthorizationGrant={clientId:registration.clientId,redirectUri:registration.redirectUri,state,codeChallenge:derivePkceS256Challenge(verifier)};

describe("native authorization exchange — requires atomic trusted store",()=>{
  it("refuses missing durable code owner",()=>{
    expect(()=>new NativeAuthorizationCodeExchange(registration,undefined as never)).toThrow("NATIVE_DURABLE_CODE_CONSUMER_REQUIRED");
  });
  it("passes validated evidence to a trusted atomic consumer, returns only opaque binding",async()=>{
    const binding=Object.freeze({internal:true});
    const consume=vi.fn(async (_code:string,verify:(record:StoredNativeAuthorizationGrant)=>boolean)=>verify(grant)?binding:null);
    const exchange=new NativeAuthorizationCodeExchange(registration,{durabilityPolicyReference:"fixture-only",consume});
    expect(await exchange.exchange({code,verifier,state})).toBe(binding);
    expect(consume).toHaveBeenCalledOnce();
    expect(consume.mock.calls[0]![0]).toBe(code);
  });
  it("rejects client, redirect, state and PKCE mismatch through the injected gate",async()=>{
    const consume=vi.fn(async (_code:string,verify:(record:StoredNativeAuthorizationGrant)=>boolean)=>verify(grant)?true:null);
    const exchange=new NativeAuthorizationCodeExchange(registration,{durabilityPolicyReference:"fixture-only",consume});
    for(const bad of [
      {...grant,clientId:"other"}, {...grant,redirectUri:"http://127.0.0.1:42134/callback"},
      {...grant,state:"X".repeat(43)}, {...grant,codeChallenge:"A".repeat(43)}
    ]) {
      const badConsumer:AtomicNativeCodeConsumer<boolean>={durabilityPolicyReference:"fixture-only",consume:async (_code,verify)=>verify(bad)};
      expect(await new NativeAuthorizationCodeExchange(registration,badConsumer).exchange({code,verifier,state})).toBe(false);
    }
    expect(await exchange.exchange({code,verifier:"short",state})).toBeNull();
  });
  it("rejects malformed code or state before invoking persistence",async()=>{
    const consume=vi.fn(async()=>null);
    const exchange=new NativeAuthorizationCodeExchange(registration,{durabilityPolicyReference:"fixture-only",consume});
    for(const input of [
      {code:"short",state,verifier},{code,state:"x",verifier},{code:code+" ",state,verifier}
    ]) expect(await exchange.exchange(input)).toBeNull();
    expect(consume).not.toHaveBeenCalled();
  });
  it("propagates database refusal; cannot silently fall back to a fabricated binding",async()=>{
    const consumer:AtomicNativeCodeConsumer<object>={durabilityPolicyReference:"fixture-only",consume:async()=>{throw new Error("STORE_UNAVAILABLE")}};
    await expect(new NativeAuthorizationCodeExchange(registration,consumer).exchange({code,verifier,state})).rejects.toThrow("STORE_UNAVAILABLE");
  });
});
