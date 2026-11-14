import { randomBytes, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {createPostgresPool,type Pool} from "@pos-platform/database-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IsolatedPostgresNativeCodeConsumer } from "../src/isolated-postgres-native-code-consumer.js";

const base = process.env.POSTGRES_TEST_URL;
const enabled = !!base;
const name = "pos_native_code_test_" + randomBytes(8).toString("hex");
const candidate = base ? new URL(base) : null;
const allowed = candidate && ["127.0.0.1","localhost"].includes(candidate.hostname) &&
  candidate.port === "55433" && candidate.pathname === "/pos_target_test";
const suite = enabled ? describe : describe.skip;

suite("native code atomic consumption — physical isolated PostgreSQL", () => {
  let admin: Pool, runtime: Pool;
  beforeAll(async () => {
    if (!base || !allowed) throw new Error("NATIVE_CODE_PHYSICAL_TEST_URL_MUST_BE_LOCAL_FIXTURE");
    admin = createPostgresPool(base);
    await admin.query(`CREATE DATABASE "${name}"`);
    const uri=new URL(base!); uri.pathname="/"+name;
    runtime=createPostgresPool(uri.href,5);
    const fixture=readFileSync(new URL("../../../tools/target-migrations/sql/postgres/native-authorization-code-isolated-fixture.sql",import.meta.url),"utf8");
    await runtime.query(fixture);
  });
  afterAll(async()=>{
    await runtime?.end();
    if(admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
      await admin.end();
    }
  });

  async function issue(code:string, expiresSeconds:number) {
    await runtime.query(`INSERT INTO identity.native_authorization_code_validation
      (code_hash,client_id,redirect_uri,code_challenge,state,trusted_binding_id,issued_at,expires_at)
      VALUES($1,'desktop','http://127.0.0.1:42133/callback',$2,$3,'trusted-fixture',
        clock_timestamp()-interval '2 minutes',clock_timestamp()+($4::int * interval '1 second'))`,[
      createHash("sha256").update(code).digest("hex"),"x".repeat(43),"s".repeat(43),expiresSeconds,
    ]);
  }
  function consumer(){
    return new IsolatedPostgresNativeCodeConsumer(runtime,async id=>({id}));
  }
  it("commits exactly one exchange under concurrent attempts",async()=>{
    const code="C".repeat(48);await issue(code,60);
    const results=await Promise.all(Array.from({length:8},()=>consumer().consume(code,()=>true)));
    expect(results.filter(Boolean)).toHaveLength(1);
    const state=await runtime.query<{consumed_at:Date|null}>("SELECT consumed_at FROM identity.native_authorization_code_validation WHERE code_hash=$1",[
      createHash("sha256").update(code).digest("hex")]);
    expect(state.rows[0]?.consumed_at).not.toBeNull();
  });
  it("burns incorrect verifier attempt without yielding a binding",async()=>{
    const code="D".repeat(48);await issue(code,60);
    expect(await consumer().consume(code,()=>false)).toBeNull();
    expect(await consumer().consume(code,()=>true)).toBeNull();
  });
  it("refuses an expired code even if the verifier is valid",async()=>{
    const code="E".repeat(48);await issue(code,-1);
    expect(await consumer().consume(code,()=>true)).toBeNull();
  });
  it("rolls back the code burn if trusted validation throws",async()=>{
    const code="F".repeat(48);await issue(code,60);
    await expect(consumer().consume(code,()=>{throw new Error("VERIFY_FAILURE")})).rejects.toThrow("VERIFY_FAILURE");
    expect(await consumer().consume(code,()=>true)).toEqual({id:"trusted-fixture"});
  });
});
