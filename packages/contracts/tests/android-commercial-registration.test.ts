import { describe, expect, it } from "vitest";
import { validateCommercialPosRegistration } from "../src/native-client-registration.js";
const origin = "https://central.camachoposcolombia.com";
const rp = "camachoposcolombia.com";
const registration = {clientId:"android-commercial",redirectUri:origin+"/android/callback",authorizationOrigin:origin,platform:"ANDROID" as const,androidPackageId:"co.camachopos.colombia",androidSigningCertificateSha256:Array(32).fill("AB").join(":")};
describe("Android commercial registration",()=>{
  it("accepts exact HTTPS registration and RP",()=>expect(validateCommercialPosRegistration(registration,rp,origin).registration).toEqual(registration));
  it("rejects foreign callbacks, RP and certificate",()=>{
    expect(()=>validateCommercialPosRegistration({...registration,redirectUri:"https://other.invalid/android/callback"},rp,origin)).toThrow();
    expect(()=>validateCommercialPosRegistration(registration,"other.com",origin)).toThrow();
    expect(()=>validateCommercialPosRegistration({...registration,androidSigningCertificateSha256:"AB"},rp,origin)).toThrow();
  });
});
