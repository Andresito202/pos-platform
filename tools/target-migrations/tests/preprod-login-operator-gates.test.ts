import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {POSTGRES_005_DESCRIPTOR} from "../src/postgres-005-contract.js";
import {POSTGRES_006_DESCRIPTOR} from "../src/postgres-006-contract.js";
import {POSTGRES_007_DESCRIPTOR} from "../src/postgres-007-contract.js";
import {COMMERCIAL_MIGRATIONS} from "../src/postgres-commercial-runner.js";
import {readArtifact,sha256} from "../src/shared.js";

const here=resolve(import.meta.dirname,"..","src");
function source(name:string){
  return readFileSync(resolve(here,name),"utf8");
}
describe("P0 login Windows operator tools (static, non-executing gates)",()=>{
  it("requires exact 005→006→007→008..016 original dependency chain",()=>{
    const selected=[POSTGRES_005_DESCRIPTOR,POSTGRES_006_DESCRIPTOR,
      POSTGRES_007_DESCRIPTOR,...COMMERCIAL_MIGRATIONS];
    const expected=["005_onboarding_bootstrap_hardening","006_licensing_foundation",
      "007_password_recovery","008_platform_role_assignments",
      "009_webauthn_challenges","010_webauthn_credential_material",
      "011_session_assertion_sequences","012_device_request_proof_replays",
      "013_business_browser_sessions","014_commercial_refresh_binding",
      "015_authorization_snapshot_sequences","016_native_business_authorization"];
    expect(selected.map(s=>s.migrationId)).toEqual(expected);
    for(let i=1;i<selected.length;i++){
      expect(selected[i]!.dependencies).toContain(selected[i-1]!.migrationId);
    }
    expect(COMMERCIAL_MIGRATIONS.every(d=>!d.migrationId.includes("factus")&&
      !d.migrationId.includes("licens")&&!d.migrationId.includes("payment"))).toBe(true);
  });
  it("retains physically reviewed PostgreSQL 005 bytes",async()=>{
    const data=await readArtifact(POSTGRES_005_DESCRIPTOR.upArtifact);
    expect(sha256(data).toString("hex"))
      .toBe("4cc95c0fd293c75305c672d2b7b5e958d80a687fc5e0b736d5233272665f8387");
  });
  it("keeps offline read-only inspect and explicit apply modes separate",()=>{
    const check=source("preprod-login-schema-gate.ts");
    expect(check).toContain('mode!=="--inspect"');
    expect(check).toContain('mode!=="--manifest"');
    expect(check).toContain("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    expect(check).toContain('client.query("ROLLBACK")');
    expect(check).not.toMatch(/await applyPostgres00[67]\(/);
    expect(check).not.toMatch(/await applyCommercialMigrations\(/);
  });
  it("requires two guarded one-shot stages, no role elevation or migration reset",()=>{
    const first=source("preprod-login-foundation-apply.ts");
    const second=source("preprod-login-authentication-apply.ts");
    for(const input of [first,second]){
      expect(input).toContain("127.0.0.1:55435/camacho_pos_preprod");
      expect(input).toContain('searchParams.set("sslmode","verify-full")');
      expect(input).toContain('git(["status","--porcelain=v1"])');
      expect(input).toContain("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      expect(input).toContain('open(output,"wx")');
      expect(input).toContain("canonicalJson");
      expect(input).not.toMatch(/DROP\s+(?:DATABASE|TABLE|ROLE)/i);
      expect(input).not.toContain("NODE_TLS_REJECT_UNAUTHORIZED");
      expect(input).not.toMatch(/GRANT\s+(?:ALL|SELECT)/i);
    }
    expect(first).toContain('--apply-foundation-006-007');
    expect(second).toContain('--apply-authentication-008-016');
    expect((first.match(/await applyPostgres006\(/g)??[])).toHaveLength(1);
    expect((first.match(/await applyPostgres007\(/g)??[])).toHaveLength(1);
    expect((second.match(/await applyCommercialMigrations\(/g)??[])).toHaveLength(1);
    expect(first).toContain("LOGIN_FOUNDATION_006_007: APPLIED_VERIFIED");
    expect(second).toContain("LOGIN_AUTHENTICATION_008_016: APPLIED_WITH_SCHEMA_ACL_EVIDENCE");
  });
  it("does not represent schema smoke as human login, WebAuthn or GLOBAL success",()=>{
    expect(source("preprod-login-foundation-apply.ts")).toContain(
      "HUMAN_LOGIN_AND_BUSINESS_008_016_NOT_CERTIFIED");
    expect(source("preprod-login-authentication-apply.ts")).toContain(
      "HUMAN_LOGIN_GLOBAL_AND_SCM_NOT_CERTIFIED");
  });
});
