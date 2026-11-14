import assert from "node:assert/strict";
import test from "node:test";
import type {Pool} from "../../packages/database-postgres/src/index.js";
import {LAB_ADMIN_POLICY,parseLabArguments,provisionLabAdministrator} from "./windows-login-lab-business-context.mjs";

const selector={userId:"01900000-0000-7000-8000-000000000001",factorId:"01900000-0000-7000-8000-000000000002",materialId:"01900000-0000-7000-8000-000000000003"};
// Transaction double only. It cannot certify PostgreSQL locks, TLS, RLS or SQL.
class Database {
  state={tenants:0,companies:0,branches:0,memberships:0,roles:0,permissions:[] as {id:string;code:string;status:string}[],grants:[] as string[],audit:[] as {new_value:any}[]};
  snapshot=structuredClone(this.state);
  calls:{sql:string;values:unknown[]}[]=[];
  identity=true;tls=true;database="camacho_windows_login_lab";version="16.14";failAudit=false;binding=true;rollbackStuck=false;
  asPool(){return {connect:async()=>({query:(s:string,v:unknown[]=[])=>this.query(s,v),release(){}})} as unknown as Pool;}
  async query(sql:string,values:unknown[]=[]):Promise<{rows:any[]}>{
    this.calls.push({sql,values});
    if(sql==="BEGIN")this.snapshot=structuredClone(this.state);
    if(sql==="ROLLBACK"&&!this.rollbackStuck)this.state=structuredClone(this.snapshot);
    if(sql.includes("AS roles,")&&sql.includes("AS audits"))return {rows:[{roles:this.state.roles,companies:this.state.companies,memberships:this.state.memberships,audits:this.state.audit.length}]};
    if(sql.includes("current_database()"))return {rows:[{db:this.database,version:this.version,tls:this.tls}]};
    if(sql.includes("SELECT u.id FROM identity.users"))return {rows:this.identity?[{id:selector.userId}]:[]};
    if(sql.includes("SELECT new_value FROM audit.audit_events"))return {rows:structuredClone(this.state.audit)};
    if(sql.includes("AS users,"))return {rows:[{users:1,tenants:this.state.tenants,companies:this.state.companies,branches:this.state.branches,memberships:this.state.memberships,roles:this.state.roles}]};
    if(sql.includes("INSERT INTO tenancy.tenants"))this.state.tenants++;
    if(sql.includes("INSERT INTO organization.companies"))this.state.companies++;
    if(sql.includes("INSERT INTO organization.branches"))this.state.branches++;
    if(sql.includes("INSERT INTO tenancy.tenant_memberships"))this.state.memberships++;
    if(sql.includes('INSERT INTO "authorization".roles'))this.state.roles++;
    if(sql.includes('SELECT id,status FROM "authorization".permissions'))return {rows:this.state.permissions.filter(p=>p.code===values[0])};
    if(sql.includes('INSERT INTO "authorization".permissions'))this.state.permissions.push({id:String(values[0]),code:String(values[1]),status:"ACTIVE"});
    if(sql.includes('INSERT INTO "authorization".role_permission_grants'))this.state.grants.push(this.state.permissions.find(p=>p.id===values[2])!.code);
    if(sql.includes("INSERT INTO audit.audit_events")){
      if(this.failAudit)throw Error("simulated audit storage failure");
      this.state.audit.push({new_value:JSON.parse(String(values[6]))});
    }
    if(sql.includes('SELECT a.id FROM "authorization".user_role_assignments'))return {rows:this.binding?[{id:"binding"}]:[]};
    if(sql.includes('SELECT p.code FROM "authorization".role_permission_grants'))return {rows:this.state.grants.map(code=>({code}))};
    return {rows:[]};
  }
}
const run=(d:Database,verifyOnly=false)=>provisionLabAdministrator(d.asPool(),selector,{verifyOnly,lockTimeoutMs:5000,operatorSid:"S-1-5-21-111-222-333-500"});

test("publishes exactly the approved 17 grants, ADMIN membership and bounded assignment atomically",async()=>{
  const d=new Database(),r=await run(d);
  assert.equal(r.outcome,"CREATED");assert.equal(r.businessSessionIssued,false);
  assert.deepEqual([...d.state.grants].sort(),[...LAB_ADMIN_POLICY.permissions].sort());
  const membership=d.calls.find(c=>c.sql.includes("INSERT INTO tenancy.tenant_memberships"))!;
  assert.match(membership.sql,/'ADMIN','ACTIVE'/);
  assert.equal(membership.values[2],selector.userId);
  const assignment=d.calls.find(c=>c.sql.includes('INSERT INTO "authorization".user_role_assignments'))!;
  assert.equal(assignment.values[4],r.context.companyId);assert.equal(assignment.values[5],r.context.branchId);
  assert.equal(d.calls.at(-1)?.sql,"COMMIT");
  assert.ok(!d.calls.some(c=>/INSERT INTO identity\.|UPDATE |DELETE |ALTER |CREATE TABLE|GRANT /i.test(c.sql)));
});
test("verify mode rolls back grants, context and audit rather than issuing a session",async()=>{
  const d=new Database(),before=structuredClone(d.state),r=await run(d,true);
  assert.equal(r.outcome,"VERIFIED_ROLLED_BACK");assert.deepEqual(d.state,before);
  assert.ok(d.calls.some(c=>c.sql==="ROLLBACK"));
});
test("repeating the same publication does not insert another role, grant, assignment or audit",async()=>{
  const d=new Database();await run(d);const before=structuredClone(d.state);d.calls=[];
  assert.equal((await run(d)).outcome,"UNCHANGED");assert.deepEqual(d.state,before);
  assert.ok(!d.calls.some(c=>c.sql.includes("INSERT INTO")));
});
test("audit failure rolls back the entire publication",async()=>{
  const d=new Database();d.failAudit=true;const before=structuredClone(d.state);
  await assert.rejects(run(d),/audit storage failure/);assert.deepEqual(d.state,before);
  assert.equal(d.calls.at(-1)?.sql,"ROLLBACK");
});
test("verify mode cannot claim rollback when a fresh DB read still finds the inserted rows",async()=>{
  const d=new Database();d.rollbackStuck=true;
  await assert.rejects(run(d,true),/LAB_ROLLBACK_POSTCONDITION_FAILED/);
});
test("an existing exact context is verified without mutation and remains present after rollback",async()=>{
  const d=new Database();await run(d);const before=structuredClone(d.state);
  assert.equal((await run(d,true)).outcome,"VERIFIED_ROLLED_BACK");assert.deepEqual(d.state,before);
});
test("inactive or mismatched real account/factor stops before any insertion",async()=>{
  const d=new Database();d.identity=false;await assert.rejects(run(d),/LAB_ACTIVE_HUMAN_ACCOUNT_AND_FACTOR_REQUIRED/);
  assert.ok(!d.calls.some(c=>c.sql.includes("INSERT INTO")));
});
test("rejects another database, missing TLS and wrong PostgreSQL version",async()=>{
  for(const change of [(d:Database)=>{d.database="commercial";},(d:Database)=>{d.tls=false;},(d:Database)=>{d.version="16.11";}]){
    const d=new Database();change(d);await assert.rejects(run(d),/ISOLATED_TLS_POSTGRES_16_14_REQUIRED/);
    assert.ok(!d.calls.some(c=>c.sql.includes("INSERT INTO")));
  }
});
test("preserves an existing unexpected company instead of adopting or overwriting it",async()=>{
  const d=new Database();d.state.companies=1;const before=structuredClone(d.state);
  await assert.rejects(run(d),/LAB_INITIAL_CONTEXT_NOT_EMPTY_REVIEW_REQUIRED/);assert.deepEqual(d.state,before);
});
test("retired permission and bad scope cause full rollback",async()=>{
  const retired=new Database();retired.state.permissions.push({id:selector.userId,code:LAB_ADMIN_POLICY.permissions[0]!,status:"RETIRED"});
  const before=structuredClone(retired.state);await assert.rejects(run(retired),/LAB_PERMISSION_PUBLICATION_CONFLICT/);assert.deepEqual(retired.state,before);
  const scope=new Database();scope.binding=false;await assert.rejects(run(scope),/LAB_PUBLISHED_SCOPE_OR_GRANTS_MISMATCH/);assert.equal(scope.state.roles,0);
});
test("does not silently restore revoked scopes, missing grants, or unauthorized extra grants",async()=>{
  for(const change of ["scope","missing","extra"]){
    const d=new Database();await run(d);
    if(change==="scope")d.binding=false;if(change==="missing")d.state.grants.pop();if(change==="extra")d.state.grants.push("LICENSE_PLAN_MANAGE");
    const before=structuredClone(d.state);await assert.rejects(run(d),/LAB_PUBLISHED_SCOPE_OR_GRANTS_MISMATCH/);assert.deepEqual(d.state,before);
  }
});
test("conflicting audit policy or selected user is rejected without new privileges",async()=>{
  for(const field of ["policyChecksum","userId"]){const d=new Database();await run(d);
    if(field==="policyChecksum")d.state.audit[0]!.new_value.policyChecksum="wrong";else d.state.audit[0]!.new_value.context.userId=selector.factorId;
    d.calls=[];await assert.rejects(run(d),/LAB_EXISTING_PUBLICATION_CONFLICT/);assert.ok(!d.calls.some(c=>c.sql.includes("INSERT INTO")));
  }
});
test("uses conflicting table locks for all RBAC writers and an explicit finite timeout",async()=>{
  const d=new Database();await run(d);const lock=d.calls.find(c=>c.sql.includes("LOCK TABLE"))!.sql;
  for(const name of ["roles","permissions","role_permission_grants","user_role_assignments","tenant_memberships"])assert.ok(lock.includes(name));
  assert.match(lock,/SHARE ROW EXCLUSIVE MODE/);assert.deepEqual(d.calls.find(c=>c.sql.includes("lock_timeout"))!.values,["5000ms"]);
});
test("rejects arbitrary IDs, absent timeout, production paths and ambiguous CLI actions",async()=>{
  const d=new Database();await assert.rejects(provisionLabAdministrator(d.asPool(),{...selector,userId:"client-id"},{verifyOnly:false,lockTimeoutMs:5000,operatorSid:"S-1-5-21-111-222-333-500"}));
  await assert.rejects(provisionLabAdministrator(d.asPool(),selector,{verifyOnly:false,lockTimeoutMs:0,operatorSid:"S-1-5-21-111-222-333-500"}));assert.equal(d.calls.length,0);
  for(const args of [[],["--apply"],["--apply","--lab-root","C:\\Production","--lock-timeout-ms","5000"],
    ["--apply","--lab-root","C:\\CamachoPosScmLab\\"+"a".repeat(32),"--lock-timeout-ms","0"]])assert.throws(()=>parseLabArguments(args));
  assert.equal(parseLabArguments(["--verify-transaction","--lab-root","C:\\CamachoPosScmLab\\"+"a".repeat(32),"--lock-timeout-ms","5000"]).verifyOnly,true);
});
