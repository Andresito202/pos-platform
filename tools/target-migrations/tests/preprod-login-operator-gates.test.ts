import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {POSTGRES_005_DESCRIPTOR} from "../src/postgres-005-contract.js";
import {POSTGRES_006_DESCRIPTOR} from "../src/postgres-006-contract.js";
import {POSTGRES_007_DESCRIPTOR} from "../src/postgres-007-contract.js";
import {COMMERCIAL_MIGRATIONS} from "../src/postgres-commercial-runner.js";
import {readArtifact,sha256} from "../src/shared.js";
import {PREPROD_BUSINESS_LOGIN_SQL_SHA256,assertPinnedPreprodLoginArtifact,verifyPreprodLoginArtifactLock} from "../src/preprod-login-sql-lock.js";

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
  it("pins every canonical 005–016 SQL byte sequence and stops on any drift",async()=>{
    const selected=[POSTGRES_005_DESCRIPTOR,POSTGRES_006_DESCRIPTOR,
      POSTGRES_007_DESCRIPTOR,...COMMERCIAL_MIGRATIONS];
    const actual=await Promise.all(selected.map(async descriptor=>({
      id:descriptor.migrationId,
      hash:sha256(await readArtifact(descriptor.upArtifact)).toString("hex"),
    })));
    expect(Object.keys(PREPROD_BUSINESS_LOGIN_SQL_SHA256)).toEqual(actual.map(d=>d.id));
    expect(()=>verifyPreprodLoginArtifactLock(actual)).not.toThrow();
    expect(()=>assertPinnedPreprodLoginArtifact(actual[0]!.id,"0".repeat(64))).toThrow("LOGIN_SQL_PINNED_ARTIFACT_CHANGED_STOP");
    expect(()=>assertPinnedPreprodLoginArtifact("999_unapproved","0".repeat(64))).toThrow("LOGIN_SQL_PINNED_ARTIFACT_CHANGED_STOP");
    expect(()=>verifyPreprodLoginArtifactLock([...actual].reverse())).toThrow("LOGIN_SQL_PINNED_CANONICAL_ORDER_DRIFT");
    for(const file of ["preprod-login-schema-gate.ts","preprod-login-authentication-apply.ts"])
      expect(source(file)).toContain("verifyPreprodLoginArtifactLock(");
    expect(source("preprod-login-foundation-apply.ts")).toContain("assertPinnedPreprodLoginArtifact(");
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

  it("does not stamp 006/007 as smoke-verified before true four-role queries",()=>{
    for(const suffix of ["006","007"]){
      const runner=source("postgres-"+suffix+"-runner.ts");
      const smokeIndex=runner.indexOf("await runPostgres"+suffix+"Smoke(");
      const stampIndex=runner.lastIndexOf("smoke_verified_at=clock_timestamp()");
      expect(smokeIndex).toBeGreaterThan(-1);
      expect(stampIndex).toBeGreaterThan(smokeIndex);
      expect(runner).toContain("body_committed_at=clock_timestamp()");
      expect(runner).toContain("AND body_committed_at IS NOT NULL");
      expect(runner).not.toContain("SET body_committed_at=clock_timestamp(),smoke_verified_at=clock_timestamp()");
    }
    const smoke=source("postgres-006-007-smoke.ts");
    expect(smoke).toContain("pos_app");
    expect(smoke).toContain("pos_worker");
    expect(smoke).toContain("pos_platform_app");
    expect(smoke).toContain("pos_platform_admin");
    expect(smoke).toContain("SELECT 1 FROM ");
    expect(smoke).toContain('"42501"');
    expect(smoke).not.toMatch(/(?:INSERT INTO|UPDATE .+ SET|DELETE FROM|DROP DATABASE)\b/i);
    const wrapper=source("preprod-login-foundation-apply.ts");
    expect(wrapper).toContain("LOGIN_FOUNDATION_006_ROLE_ACL_ASSERTIONS");
    expect(wrapper).toContain("LOGIN_FOUNDATION_007_ROLE_ACL_ASSERTIONS");
    expect(wrapper).toContain("role_acl_assertions_006");
    expect(wrapper).toContain("role_acl_assertions_007");
  });
  it("requires an independent 244-assertion four-role private BUSINESS ACL smoke",()=>{
    const audit=source("postgres-commercial-auth-smoke.ts");
    expect(audit).toContain("authorization.platform_role_assignments");
    expect(audit).toContain("identity.native_authorization_codes");
    expect(audit).toContain("identity.webauthn_challenges");
    expect(audit).toContain('assertions===244');
    expect(audit).toContain("pos_platform_admin");
    expect(audit).toContain('"42501"');
    expect(audit).not.toMatch(/(?:INSERT INTO|UPDATE .+ SET|DELETE FROM|DROP DATABASE)\b/i);
    const wrapper=source("preprod-login-authentication-apply.ts");
    expect(wrapper).toContain("await runBusinessSchemaAclSmoke(");
    expect(wrapper).toContain("LOGIN_AUTHENTICATION_ROLE_ACL_SMOKE_ASSERTIONS");
    expect(wrapper).toContain("role_acl_smoke_assertions:realRoleAssertions");
    expect(wrapper.indexOf("await runBusinessSchemaAclSmoke("))
      .toBeLessThan(wrapper.indexOf('open(output,"wx")'));
  });


  it("provides a read-only, operator-safe partial 006–016 reconciliation inspector",()=>{
    const inspector=source("preprod-login-stage-status.ts");
    expect(inspector).toContain("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    expect(inspector).toContain('client.query("ROLLBACK")');
    expect(inspector).toContain("REQUIRES_MANUAL_RECONCILIATION");
    expect(inspector).toContain("PARTIALLY_APPLIED");
    expect(inspector).toContain("LOGIN_STAGE_NO_MUTATIONS_PERFORMED");
    expect(inspector).not.toMatch(/await applyPostgres00[67]\(/);
    expect(inspector).not.toMatch(/await applyCommercialMigrations\(/);
    expect(inspector).not.toMatch(/\b(?:INSERT INTO|UPDATE platform\.|DELETE FROM|DROP DATABASE)\b/i);
  });

});
