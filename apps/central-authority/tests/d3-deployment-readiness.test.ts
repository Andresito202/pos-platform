import {describe,expect,it} from "vitest";
import {inspectD3DeploymentEvidence} from "../src/d3-deployment-readiness.js";
const candidate={
  issuerOrigin:"https://auth.example.test",webauthnRpId:"auth.example.test",
  webauthnOrigin:"https://auth.example.test",
  electronClientId:"desktop",electronRedirectUri:"http://127.0.0.1:42133/callback",
  androidClientId:"android",androidRedirectUri:"https://auth.example.test/android/callback",
  androidPackageId:"co.example.camachopos",
  androidSigningCertificateSha256:Array(32).fill("AB").join(":"),
  androidAssetLinksVerified:true,centralDeviceTrustVerified:true,
  signingKeyCustodianConfirmed:true,securityPolicyApprovalReference:"D3-APPROVAL-example123",
};
describe("D3 deployment evidence — configuration validation only",()=>{
  it("fails closed without deployer evidence",()=>{
    expect(inspectD3DeploymentEvidence(null)).toEqual({
      ready:false,blockers:["D3_DEPLOYMENT_EVIDENCE_REQUIRED"]});
  });
  it("requires actual HTTPS origin and a matching WebAuthn RP",()=>{
    const result=inspectD3DeploymentEvidence({...candidate,issuerOrigin:"http://localhost:8443"});
    expect(result.ready).toBe(false);
    expect(result.blockers).toContain("D3_ISSUER_HTTPS_ORIGIN_REQUIRED");
  });
  it("rejects an unverified Android App Link even if the redirect is HTTPS",()=>{
    expect(inspectD3DeploymentEvidence({...candidate,androidAssetLinksVerified:false}).blockers)
      .toContain("D3_ANDROID_ASSET_LINKS_UNVERIFIED");
  });
  it("requires central trust, signing custody and explicit policy evidence",()=>{
    const result=inspectD3DeploymentEvidence({...candidate,
      centralDeviceTrustVerified:false,signingKeyCustodianConfirmed:false,
      securityPolicyApprovalReference:""});
    expect(result.blockers).toEqual(expect.arrayContaining([
      "D3_CENTRAL_DEVICE_TRUST_UNVERIFIED","D3_SIGNING_KEY_CUSTODY_UNCONFIRMED",
      "D3_SECURITY_POLICY_APPROVAL_REQUIRED"]));
  });
  it("requires distinct desktop and Android client registrations",()=>{
    expect(inspectD3DeploymentEvidence({...candidate,androidClientId:"desktop"}).blockers)
      .toContain("D3_DISTINCT_NATIVE_CLIENT_REGISTRATIONS_REQUIRED");
  });
  it("accepts structurally complete evidence without activating any runtime",()=>{
    expect(inspectD3DeploymentEvidence(candidate)).toEqual({ready:true,blockers:[]});
  });
});
