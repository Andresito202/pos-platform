import { describe, expect, it } from "vitest";
import { derivePkceS256Challenge, matchesPkceS256Challenge, validateNativeClientRegistration } from "../src/native-authorization-constraints.js";

const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

describe("native authorization constraints — no transport or token issuance", () => {
  it("matches the RFC 7636 S256 test vector", () => {
    expect(derivePkceS256Challenge(verifier)).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    expect(matchesPkceS256Challenge(verifier, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")).toBe(true);
  });
  it("rejects incorrect, malformed and plain-method challenges", () => {
    for (const challenge of [verifier, "A".repeat(43), "bad", "", "!", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM="]) {
      expect(matchesPkceS256Challenge(verifier, challenge)).toBe(false);
    }
    for (const candidate of ["short", "x".repeat(129), "ü".repeat(43), "x".repeat(42) + "=", "x".repeat(42) + " "]) {
      expect(() => derivePkceS256Challenge(candidate)).toThrow("PKCE_VERIFIER_INVALID");
    }
  });
  it("requires exact, loopback-only registration and an external HTTPS origin", () => {
    const registration = {
      clientId: "camacho-desktop",
      redirectUri: "http://127.0.0.1:42133/callback",
      authorizationOrigin: "https://login.example.com",
    };
    expect(validateNativeClientRegistration(registration)).toEqual(registration);
    for (const redirectUri of [
      "http://localhost:42133/callback", "http://0.0.0.0:42133/callback",
      "https://127.0.0.1:42133/callback", "http://127.0.0.1/callback",
      "http://127.0.0.1:42133/evil", "http://127.0.0.1:42133/callback?code=x",
      "http://127.0.0.1:42133/callback#fragment",
      "http://127.0.0.1:42133@evil.example/callback",
    ]) {
      expect(() => validateNativeClientRegistration({ ...registration, redirectUri })).toThrow("NATIVE_CLIENT_REGISTRATION_INVALID");
    }
    for (const authorizationOrigin of ["http://login.example.com", "https://localhost", "https://127.0.0.1", "https://login.example.com/path", "https://login.example.com/", "https://login.example.com?x=1"]) {
      expect(() => validateNativeClientRegistration({ ...registration, authorizationOrigin })).toThrow("NATIVE_AUTHORIZATION_ORIGIN_INVALID");
    }
  });
});
