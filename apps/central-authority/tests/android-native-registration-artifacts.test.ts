import {describe,it,expect} from "vitest";
import {prepareAndroidNativeRegistrationArtifacts} from "../src/android-native-registration-artifacts.js";

describe("Android registration artifacts without activation",()=>{
  const candidate={platform:"ANDROID" as const,clientId:"android",authorizationOrigin:"https://business.example.test",redirectUri:"https://business.example.test/android/callback",
    androidPackageId:"co.camachopos.android",androidSigningCertificateSha256:Array(32).fill("A1").join(":")};
  it("prepares exact DAL and a constrained callback filter using supplied package and signer",()=>{
    const prepared=prepareAndroidNativeRegistrationArtifacts(candidate);
    const dal=JSON.parse(prepared.assetLinks) as {target:{package_name:string;sha256_cert_fingerprints:string[]}}[];
    expect(dal[0]!.target).toMatchObject({package_name:candidate.androidPackageId,sha256_cert_fingerprints:[candidate.androidSigningCertificateSha256]});
    expect(prepared.intentFilter).toContain('android:host="business.example.test"');
    expect(prepared.intentFilter).toContain('android:path="/android/callback"');
    expect(prepared.activation).toBe("BLOCKED_PENDING_D3_AND_PHYSICAL_VERIFICATION");
  });
  it("rejects loopback domain substitution and signing identity omissions",()=>{
    const {androidPackageId,...noPackage}=candidate;
    const {androidSigningCertificateSha256,...unsigned}=candidate;
    for(const registration of [{...candidate,redirectUri:"http://127.0.0.1:42133/callback"},noPackage,
      {...candidate,redirectUri:"https://evil.example.test/android/callback"},unsigned])expect(()=>prepareAndroidNativeRegistrationArtifacts(registration)).toThrow();
  });
});
