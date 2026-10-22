import { describe, expect, it } from "vitest";
import { inspectNativeAuthorizationCallback } from "../src/native-authorization-callback.js";
const registration = Object.freeze({
  clientId: "camacho-desktop",
  redirectUri: "http://127.0.0.1:42133/callback",
  authorizationOrigin: "https://login.example.com",
});
const state = "Q".repeat(43);
const code = "q".repeat(48);
const expectation = { registration, state };
const valid = registration.redirectUri + "?code=" + code + "&state=" + state;

describe("native authorization callback — pre-exchange only", () => {
  it("validates an Android App Link separately from the Electron loopback callback",()=>{
    const android={...registration,clientId:"android",platform:"ANDROID" as const,redirectUri:registration.authorizationOrigin+"/android/callback",
      androidPackageId:"co.camachopos.android",androidSigningCertificateSha256:Array(32).fill("A1").join(":")};
    const callback=android.redirectUri+"?code="+code+"&state="+state;
    expect(inspectNativeAuthorizationCallback(callback,{registration:android,state})).toEqual({code,clientId:"android"});
    expect(inspectNativeAuthorizationCallback(valid,{registration:android,state})).toBeNull();
    expect(inspectNativeAuthorizationCallback(callback.replace("/android/callback","/callback"),{registration:android,state})).toBeNull();
  });
  it("accepts an exact bound loopback callback but does not issue access", () => {
    expect(inspectNativeAuthorizationCallback(valid, expectation))
      .toEqual({ code, clientId: registration.clientId });
  });
  it("rejects a state mismatch and missing or duplicate state/code", () => {
    for (const url of [
      valid.replace(state, "X".repeat(43)),
      valid + "&state=" + state,
      valid + "&code=" + code,
      registration.redirectUri + "?code=" + code,
      registration.redirectUri + "?state=" + state,
      registration.redirectUri + "?error=access_denied&state=" + state,
    ]) expect(inspectNativeAuthorizationCallback(url, expectation)).toBeNull();
  });
  it("rejects redirect variations, fragments, additional query arguments and credentials", () => {
    for (const url of [
      valid.replace("127.0.0.1", "localhost"),
      valid.replace("42133", "42134"),
      valid.replace("/callback", "/other"),
      valid.replace("http:", "https:"),
      valid + "#token",
      valid + "&access_token=leak",
      valid.replace("127.0.0.1", "bad.example"),
    ]) expect(inspectNativeAuthorizationCallback(url, expectation)).toBeNull();
  });
  it("requires a host-generated unguessable state policy", () => {
    expect(() => inspectNativeAuthorizationCallback(valid, {registration,state:"short"}))
      .toThrow("NATIVE_CALLBACK_STATE_POLICY_REQUIRED");
  });
  it("does not treat an empty, oversized or malformed code as valid", () => {
    for (const bad of ["", "short", "x".repeat(513), "a+b", "a/b"]) {
      expect(inspectNativeAuthorizationCallback(registration.redirectUri +
        "?code=" + encodeURIComponent(bad) + "&state=" + state, expectation)).toBeNull();
    }
  });
});
