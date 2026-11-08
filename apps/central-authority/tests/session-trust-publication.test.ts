import { mkdtempSync, writeFileSync,rmSync } from "node:fs";
import {generateKeyPairSync,randomUUID} from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionTrustPublication,AuthorizationTrustPublication } from "../src/session-trust-publication.js";
import {signAuthorizationTrust} from "../src/isolated-authorization-trust.js";

describe("SessionTrustPublication", () => {
  it("publishes only a bounded deployment SAS delivery from an absolute managed file",()=>{
    const directory=mkdtempSync(join(tmpdir(),"pos-sas-publication-")),path=join(directory,"sas.json"),root=generateKeyPairSync("ed25519"),key=generateKeyPairSync("ed25519");
    try{
      const bundle=signAuthorizationTrust({profile:"CAMACHO_SAS_TRUST_V1",mode:"DEPLOYMENT",schema_version:1,purpose:"AUTHORIZATION_SNAPSHOT",environment:"PREPRODUCTION",issuer:"https://central.example.test",authority_id:"SAS_PUBLICATION_TEST",generation:1,complete:true,
        recipient:{tenant_id:randomUUID(),company_id:randomUUID(),branch_id:randomUUID(),installation_id:randomUUID(),device_id:randomUUID()},issued_at:"2026-10-25T12:00:00.000Z",valid_from:"2026-10-25T12:00:00.000Z",valid_until:"2026-10-25T13:00:00.000Z",
        keys:[{key_id:"SAS_PUBLICATION_KEY",purpose:"AUTHORIZATION_SNAPSHOT",public_key_pem:key.publicKey.export({type:"spki",format:"pem"}).toString(),status:"ACTIVE",version:1,valid_from:"2026-10-25T12:00:00.000Z",valid_until:"2026-10-25T13:00:00.000Z"}]},root.privateKey);
      writeFileSync(path,JSON.stringify(bundle));expect(new AuthorizationTrustPublication(path).load()).toEqual(bundle);
      expect(()=>new AuthorizationTrustPublication(path,{issuer:"https://wrong.example.test"}).load()).toThrow("SAS_PUBLICATION_SCOPE_REJECTED");
      expect(()=>new AuthorizationTrustPublication(path,{issuer:bundle.claims.issuer,environment:"PRODUCTION"}).load()).toThrow("SAS_PUBLICATION_SCOPE_REJECTED");
      writeFileSync(path,JSON.stringify({...bundle,claims:{...bundle.claims,profile:"DEC011_LAB_CANDIDATE_1"}}));expect(()=>new AuthorizationTrustPublication(path).load()).toThrow();
      writeFileSync(path,"x".repeat(1024*1024+1));expect(()=>new AuthorizationTrustPublication(path).load()).toThrow("SAS_PUBLICATION_FILE_REJECTED");
      expect(()=>new AuthorizationTrustPublication("relative.json")).toThrow("SAS_PUBLICATION_ABSOLUTE_FILE_REQUIRED");
    }finally{rmSync(directory,{recursive:true,force:true});}
  });
  it("loads only a schema-valid signed trust bundle", () => {
    const directory = mkdtempSync(join(tmpdir(), "pos-session-trust-"));
    const path = join(directory, "bundle.json");
    writeFileSync(path, JSON.stringify({
      version: 1,
      keys: [{
        claims: {
          key_id: "ssa-ci-01",
          key_purpose: "SESSION_ASSERTION",
          environment: "production",
          public_key_pem: "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAuzra6on92WSA0WExaDPQ1GSYi2RqyUSPdbHRCtuQNH0=\n-----END PUBLIC KEY-----\n",
          status: "ACTIVE",
          valid_from: "2026-01-01T00:00:00.000Z",
          valid_until: null,
          version: 1,
        },
        signature: "1s6EFqqMHkg3UMNIFTOywsJ_JSSIwLhgwbG3W91PdXWOhOEwq1abR8LzcjkBLFWeVyTtZmTQII0yKC9xPFpoCQ",
      }],
    }));
    expect(new SessionTrustPublication(path).load().keys).toHaveLength(1);
  });

  it("fails closed on malformed publication", () => {
    const directory = mkdtempSync(join(tmpdir(), "pos-session-trust-"));
    const path = join(directory, "bundle.json");
    writeFileSync(path, JSON.stringify({ version: 1, keys: [] }));
    expect(() => new SessionTrustPublication(path).load()).toThrow();
  });
});
